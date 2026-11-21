// งาน PDF ฝั่งเบราว์เซอร์ที่ใช้ร่วมกัน: ตรวจไฟล์ แนบ+ประทับตรารับ (หน้าลงรับ / แนบไฟล์อีกครั้ง) และลงนามคำเกษียน
import { withBase } from "@/lib/base-path";
import { MAX_UPLOAD_BYTES } from "@/lib/saraban/types";
import { receiveStampBox } from "@/lib/saraban/register";
import { A4, endorsementPlacement, safeMessage, type PlaceBox } from "@/lib/saraban/book";
import { uploadPdf } from "./upload";

export type Picked = { file: File; bytes: Uint8Array; pages: number; encrypted: boolean };
export type StampInfo = { schoolName: string; receiveNo: number; year: number; receivedAt: string; bookId: string };

/** ข้อความแสดงผู้ใช้: เฉพาะข้อความภาษาไทยของระบบ ข้อความดิบจากไลบรารี/Drive บันทึกใน console เท่านั้น */
function errText(err: unknown): string {
  const msg = safeMessage(err, "ไม่ทราบสาเหตุ");
  if (msg === "ไม่ทราบสาเหตุ") console.error("saraban pdf", err);
  return msg;
}

/** ตรวจไฟล์ที่เลือก: เป็น PDF ไม่เกิน 30 MB และ pdf-lib เปิดได้ */
export async function readPdf(file: File): Promise<Picked> {
  if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) throw new Error("รองรับเฉพาะไฟล์ PDF");
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("ไฟล์ใหญ่เกิน 30 MB");
  if (file.size === 0) throw new Error("ไฟล์ว่างเปล่า");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  if (!head.includes("%PDF-")) throw new Error("ไฟล์นี้ไม่ใช่ PDF");
  const { PDFDocument } = await import("pdf-lib");
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    if (doc.getPageCount() < 1) throw new Error();
    return { file, bytes, pages: doc.getPageCount(), encrypted: doc.isEncrypted };
  } catch {
    throw new Error("เปิดไฟล์ PDF นี้ไม่ได้ (ไฟล์อาจเสีย)");
  }
}

/** วาดตรารับ + QR แล้วฝังที่มุมขวาบนของหน้าแรก */
async function stampPdf(bytes: Uint8Array, s: StampInfo) {
  // โหลดเฉพาะตอนใช้ (canvas/pdf-lib ไม่ต้องอยู่ในหน้าแรกของ bundle)
  const [{ drawReceiveStamp }, { receiveStampLines, pngSizePt, embedPng }, { PDFDocument }] = await Promise.all([
    import("@/lib/saraban/stamp-canvas"),
    import("@/lib/saraban/stamp"),
    import("pdf-lib"),
  ]);
  const lines = receiveStampLines({ schoolName: s.schoolName, receiveNo: s.receiveNo, year: s.year, receivedAt: s.receivedAt });
  const png = await drawReceiveStamp(lines, location.origin + withBase("/saraban/book/" + s.bookId));
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const box = receiveStampBox(doc.getPage(0).getSize(), pngSizePt(png));
  return embedPng(bytes, png, box);
}

export type AttachResult = { ok: true; stamped: boolean } | { ok: false; stage: "upload" | "stamp"; error: string };

/**
 * อัปโหลดต้นฉบับ แล้วประทับตรารับและอัปโหลดฉบับประทับตรา (ไฟล์ที่ล็อกไว้ข้ามการประทับตรา: stamped=false)
 * ไม่ throw — คืนขั้นที่ล้มเหลวพร้อมข้อความภาษาไทย
 */
export async function attachPdf(pdf: Picked, s: StampInfo, onStep: (text: string) => void): Promise<AttachResult> {
  try {
    onStep("กำลังอัปโหลดต้นฉบับ…");
    await uploadPdf(s.bookId, "original", pdf.file.name, pdf.file);
  } catch (err) {
    return { ok: false, stage: "upload", error: errText(err) };
  }
  if (pdf.encrypted) return { ok: true, stamped: false };
  try {
    onStep("กำลังประทับตรารับ…");
    const stamped = await stampPdf(pdf.bytes, s);
    onStep("กำลังอัปโหลดฉบับประทับตรา…");
    const name = `รับที่ ${s.receiveNo}-${s.year} ${pdf.file.name}`.slice(0, 200);
    await uploadPdf(s.bookId, "stamped", name, new Blob([stamped as BlobPart], { type: "application/pdf" }));
  } catch (err) {
    return { ok: false, stage: "stamp", error: errText(err) };
  }
  return { ok: true, stamped: true };
}

/** ข้อผิดพลาด: ไฟล์ PDF ถูกล็อก ฝังคำเกษียนไม่ได้ */
export class EncryptedPdfError extends Error {
  constructor() {
    super("ไฟล์ PDF ถูกล็อกไว้ จึงฝังคำเกษียนลงไฟล์ไม่ได้");
  }
}

/** คำเกษียนที่เตรียมแล้ว: ไฟล์ต้นทาง + ภาพคำเกษียน + ขนาดทุกหน้า (ไว้ให้ผู้ลงนามแตะเลือกตำแหน่ง) */
export type PreparedEndorsement = {
  bytes: Uint8Array;
  png: Uint8Array;
  png_pt: { width: number; height: number };
  pages: { width: number; height: number }[];
};

/**
 * เตรียมลงนาม: โหลดไฟล์ล่าสุด วาดคำเกษียน (ข้อความ ลายเซ็น ชื่อ วันที่เลขไทย)
 * ไฟล์ถูกล็อก throw EncryptedPdfError · ผิดพลาดอื่น throw Error (แสดงผู้ใช้ผ่าน signErrorText)
 */
export async function prepareEndorsement(
  fileId: string,
  e: { note: string; signerName: string; date: string },
  signature: Blob | null,
): Promise<PreparedEndorsement> {
  const [{ drawEndorsement }, { endorsementLines, pngSizePt }, { PDFDocument }] = await Promise.all([
    import("@/lib/saraban/stamp-canvas"),
    import("@/lib/saraban/stamp"),
    import("pdf-lib"),
  ]);
  const res = await fetch(withBase("/saraban/api/file/" + fileId)).catch(() => null);
  if (!res?.ok) throw new Error("โหลดไฟล์หนังสือไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่");
  const bytes = new Uint8Array(await res.arrayBuffer());
  let doc;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  } catch {
    throw new Error("เปิดไฟล์ PDF ของหนังสือไม่ได้");
  }
  if (doc.isEncrypted) throw new EncryptedPdfError();

  let bitmap: ImageBitmap | undefined;
  if (signature) bitmap = await createImageBitmap(signature).catch(() => undefined);
  const png = await drawEndorsement(endorsementLines({ note: e.note, signerName: e.signerName, date: e.date }), bitmap);
  bitmap?.close();
  return { bytes, png, png_pt: pngSizePt(png), pages: doc.getPages().map((p) => p.getSize()) };
}

/** ตำแหน่งเริ่มต้น (ก่อนผู้ลงนามแตะเลือก): มุมล่างซ้าย/ขวาของหน้าแรก หรือหน้า A4 ใหม่ท้ายไฟล์ */
export function defaultPlacement(p: PreparedEndorsement, place: { side: "left" | "right"; newPage?: boolean }) {
  return endorsementPlacement(p.pages[0], p.png_pt, p.pages.length, place);
}

/** ฝังคำเกษียนตามตำแหน่งที่เลือก (appendPage = เพิ่มหน้า A4 ท้ายไฟล์ก่อน) แล้วอัปโหลดเป็นฉบับ stamped — คืน fileId ใหม่ */
export async function uploadEndorsement(
  bookId: string,
  p: PreparedEndorsement,
  pos: { appendPage: boolean; box: PlaceBox },
  fileName: string,
): Promise<string> {
  const [{ embedPng }, { PDFDocument }] = await Promise.all([import("@/lib/saraban/stamp"), import("pdf-lib")]);
  let base: Uint8Array = p.bytes;
  if (pos.appendPage) {
    const doc = await PDFDocument.load(p.bytes, { ignoreEncryption: true });
    doc.addPage([A4.width, A4.height]);
    base = await doc.save();
  }
  const signed = await embedPng(base, p.png, pos.box);
  return uploadPdf(bookId, "stamped", fileName.slice(0, 200), new Blob([signed as BlobPart], { type: "application/pdf" }));
}

/** ข้อความผิดพลาดของการลงนามที่แสดงผู้ใช้ได้ */
export const signErrorText = errText;
