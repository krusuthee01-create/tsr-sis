// ตรารับและคำเกษียนหนังสือ: จัดข้อความ + ฝัง PNG ลง PDF (ไม่ใช้โค้ดเฉพาะเบราว์เซอร์ เพื่อให้ทดสอบด้วย node ได้)
import { PDFDocument } from "pdf-lib";
import { formatThaiDate, thaiDigits } from "../thai-date.ts";

/** ตัวคูณความละเอียดของ canvas */
export const STAMP_SCALE = 3;

/** ตรารับแบบเอกสารราชการ เลขไทย: รับที่ ๑๓๑๖ / วันที่ ๒๑ พฤศจิกายน ๒๕๖๙ / เวลา ๑๕:๑๑:๔๔ (เวลาไทย UTC+7) */
export function receiveStampLines(s: { schoolName: string; receiveNo: number; year: number; receivedAt: string }): string[] {
  const th = new Date(new Date(s.receivedAt).getTime() + 7 * 3600_000).toISOString();
  return [
    s.schoolName,
    `รับที่ ${thaiDigits(s.receiveNo)}`,
    `วันที่ ${thaiDigits(formatThaiDate(th.slice(0, 10), "long"))}`,
    `เวลา ${thaiDigits(th.slice(11, 19))}`,
  ];
}

/** วันที่ท้ายคำเกษียน: ๒๒/๑๑/๒๕๖๙ */
export function endorsementDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return thaiDigits(`${d}/${m}/${y + 543}`);
}

/** จำนวนบรรทัดท้ายคำเกษียน (ชื่อ, วันที่) ที่จัดกึ่งกลางใต้ลายเซ็น */
export const ENDORSEMENT_FOOTER_LINES = 2;

// อักขระที่ห้ามขึ้นต้นบรรทัด: สระบน/ล่าง วรรณยุกต์ ำ ะ า ๅ ๆ ฯ
const NO_START = /^[\u0E2F\u0E30-\u0E3A\u0E45-\u0E4E]/;
// สระหน้า (เ แ โ ใ ไ) ห้ามอยู่ท้ายบรรทัด
const NO_END = /[\u0E40-\u0E44]$/;

/** ตัดคำที่ไม่มีช่องว่างและยาวเกิน maxChars (นับตาม code point) โดยไม่ผิดกติกาขึ้น/ท้ายบรรทัด และไม่แทรกช่องว่าง */
function hardBreak(word: string, maxChars: number): string[] {
  const cps = [...word];
  const out: string[] = [];
  let i = 0;
  while (cps.length - i > maxChars) {
    let end = i + maxChars;
    while (end > i + 1 && (NO_START.test(cps[end]) || NO_END.test(cps[end - 1]))) end--;
    out.push(cps.slice(i, end).join(""));
    i = end;
  }
  out.push(cps.slice(i).join(""));
  return out;
}

/** แยกย่อหน้าเป็นโทเคน {text, space}: ใช้ Intl.Segmenter (ไทย) ถ้ามี ไม่เช่นนั้นแยกตามช่องว่าง */
function tokenize(para: string): { text: string; space: boolean }[] {
  const raw: { text: string; space: boolean }[] = [];
  const Seg = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Seg) {
    for (const { segment } of new Seg("th", { granularity: "word" }).segment(para)) {
      raw.push({ text: segment, space: /^\s+$/.test(segment) });
    }
  } else {
    for (const part of para.split(/(\s+)/)) if (part) raw.push({ text: part, space: /^\s+$/.test(part) });
  }
  // รวมโทเคนที่ขึ้นต้นด้วยอักขระห้ามขึ้นต้นกับคำก่อนหน้า และสระหน้าท้ายคำกับคำถัดไป
  const out: { text: string; space: boolean }[] = [];
  let carry = false;
  for (const t of raw) {
    const prev = out[out.length - 1];
    if (!t.space && prev && !prev.space && (carry || NO_START.test(t.text))) prev.text += t.text;
    else out.push({ ...t });
    const last = out[out.length - 1];
    carry = !last.space && NO_END.test(last.text);
  }
  return out;
}

/**
 * บรรทัดคำเกษียน: ข้อความ (ตัดบรรทัดตามคำไทย) แล้วตามด้วยชื่อผู้ลงนามและวันที่เลขไทย (แบบระบบเดิมของโรงเรียน)
 * position ไม่แสดงบนเอกสาร (เก็บไว้ในระบบ)
 */
export function endorsementLines(
  e: { note: string; signerName: string; position?: string; date: string },
  maxChars = 48,
): string[] {
  const len = (x: string) => [...x].length;
  const lines: string[] = [];
  for (const para of e.note.split(/\r?\n/)) {
    let cur = "";
    let gap = false;
    for (const tok of tokenize(para)) {
      if (tok.space) {
        gap = cur !== "";
        continue;
      }
      const cand = cur + (gap ? " " : "") + tok.text;
      gap = false;
      if (len(cand) <= maxChars) {
        cur = cand;
        continue;
      }
      if (cur) lines.push(cur);
      if (len(tok.text) > maxChars) {
        const parts = hardBreak(tok.text, maxChars);
        cur = parts.pop() as string;
        lines.push(...parts);
      } else {
        cur = tok.text;
      }
    }
    if (cur) lines.push(cur);
  }
  return [...lines, e.signerName, endorsementDate(e.date)];
}

/** ขนาดภาพ PNG เป็น point (อ่าน IHDR แล้วหาร STAMP_SCALE) */
export function pngSizePt(png: Uint8Array): { width: number; height: number } {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: dv.getUint32(16) / STAMP_SCALE, height: dv.getUint32(20) / STAMP_SCALE };
}

/** ฝัง PNG ลงหน้า PDF (หน่วย point นับจากมุมซ้ายล่าง, page เริ่มที่ 0) */
export async function embedPng(
  pdf: Uint8Array,
  png: Uint8Array,
  box: { page: number; x: number; y: number; width: number; height: number },
): Promise<Uint8Array> {
  if (!(box.width > 0) || !(box.height > 0)) throw new Error("ขนาดตราประทับไม่ถูกต้อง");
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  if (!Number.isInteger(box.page) || box.page < 0 || box.page >= doc.getPageCount()) {
    throw new Error("ไม่พบหน้าที่ " + (box.page + 1) + " ในไฟล์ PDF");
  }
  const img = await doc.embedPng(png);
  const page = doc.getPage(box.page);
  page.drawImage(img, { x: box.x, y: box.y, width: box.width, height: box.height });
  return doc.save();
}
