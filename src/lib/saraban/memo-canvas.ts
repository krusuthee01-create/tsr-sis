// วาดบันทึกข้อความลง canvas แล้วรวมเป็น PDF (เฉพาะเบราว์เซอร์) — ใช้ภาพเพื่อให้สระ/วรรณยุกต์ไทยถูกต้องเหมือนตราประทับ
import { PDFDocument } from "pdf-lib";
import { layoutMemo, MEMO_FONT, MEMO_PAGE, type MemoInput, type MemoOp } from "./memo.ts";

const PX = 2.5; // พิกเซลต่อ point (~180 dpi) คมพอสำหรับพิมพ์ ไฟล์ไม่ใหญ่
const FALLBACK = '"Sarabun", "TH Sarabun New", sans-serif';

function family(): string {
  const v = getComputedStyle(document.body).getPropertyValue("--font-sarabun").trim();
  return v ? `${v}, ${FALLBACK}` : FALLBACK;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("โหลดภาพไม่สำเร็จ"));
    i.src = src;
  });
}

export type MemoDoc = MemoInput & { docNo: string; date: string; signerName: string };

/** วาดทุกหน้า คืน canvas ต่อหน้า (ใช้ทั้งพรีวิวและสร้าง PDF) */
export async function renderMemo(m: MemoDoc, opts: { garudaUrl: string; signature?: ImageBitmap | null }): Promise<HTMLCanvasElement[]> {
  const fam = family();
  const sample = [m.unit, m.subject, m.to, m.cause, m.intent, m.closing, m.signerName, m.position, "บันทึกข้อความ ๐๑๒๓๔๕๖๗๘๙"].join(" ");
  await Promise.all([`400 ${MEMO_FONT.body}px ${fam}`, `700 ${MEMO_FONT.body}px ${fam}`, `700 ${MEMO_FONT.title}px ${fam}`]
    .map((f) => document.fonts.load(f, sample).catch(() => [])));
  await document.fonts.ready;
  const mctx = document.createElement("canvas").getContext("2d")!;
  const measure = (text: string, size: number, bold: boolean) => {
    mctx.font = `${bold ? 700 : 400} ${size}px ${fam}`;
    return mctx.measureText(text).width;
  };
  const garuda = await loadImage(opts.garudaUrl).catch(() => null);
  const pages = layoutMemo({ ...m, hasSignature: !!opts.signature }, measure);
  return pages.map((ops) => draw(ops, fam, garuda, opts.signature ?? null));
}

function draw(ops: MemoOp[], fam: string, garuda: HTMLImageElement | null, signature: ImageBitmap | null): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.round(MEMO_PAGE.width * PX);
  c.height = Math.round(MEMO_PAGE.height * PX);
  const ctx = c.getContext("2d")!;
  ctx.scale(PX, PX);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, MEMO_PAGE.width, MEMO_PAGE.height);
  ctx.fillStyle = "#000";
  ctx.strokeStyle = "#000";
  ctx.textBaseline = "middle";
  for (const op of ops) {
    if (op.t === "text") {
      ctx.font = `${op.bold ? 700 : 400} ${op.size}px ${fam}`;
      ctx.textAlign = op.align === "center" ? "center" : "left";
      ctx.fillText(op.text, op.x, op.y + MEMO_FONT.line / 2);
    } else if (op.t === "line") {
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(op.x1, op.y);
      ctx.lineTo(op.x2, op.y);
      ctx.stroke();
    } else if (op.key === "garuda" && garuda) {
      ctx.drawImage(garuda, op.x, op.y, op.w, op.h);
    } else if (op.key === "signature" && signature) {
      // ย่อลายเซ็นตามสัดส่วนให้อยู่ในกรอบ
      const k = Math.min(op.w / signature.width, op.h / signature.height);
      const w = signature.width * k, h = signature.height * k;
      ctx.drawImage(signature, op.x + (op.w - w) / 2, op.y + (op.h - h) / 2, w, h);
    }
  }
  return c;
}

/** รวมหน้าเป็นไฟล์ PDF (A4 ทุกหน้า) */
export async function memoPdf(pages: HTMLCanvasElement[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const c of pages) {
    const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("สร้างภาพไม่สำเร็จ"))), "image/png"));
    const img = await doc.embedPng(new Uint8Array(await blob.arrayBuffer()));
    const page = doc.addPage([MEMO_PAGE.width, MEMO_PAGE.height]);
    page.drawImage(img, { x: 0, y: 0, width: MEMO_PAGE.width, height: MEMO_PAGE.height });
  }
  doc.setTitle("บันทึกข้อความ");
  return doc.save();
}
