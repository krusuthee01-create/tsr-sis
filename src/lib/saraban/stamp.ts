// ตรารับและคำเกษียนหนังสือ: จัดข้อความ + ฝัง PNG ลง PDF (ไม่ใช้โค้ดเฉพาะเบราว์เซอร์ เพื่อให้ทดสอบด้วย node ได้)
import { PDFDocument } from "pdf-lib";
import { formatThaiDate, formatTime } from "../thai-date.ts";

/** ตัวคูณความละเอียดของ canvas */
export const STAMP_SCALE = 3;

export function receiveStampLines(s: { schoolName: string; receiveNo: number; year: number; receivedAt: string }): string[] {
  // เวลาไทย (UTC+7) เป็นรูปแบบ HH.mm
  const th = new Date(new Date(s.receivedAt).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
  return [
    s.schoolName,
    `รับที่ ${s.receiveNo}/${s.year}`,
    `วันที่ ${formatThaiDate(th, "long")}`,
    `เวลา ${formatTime(s.receivedAt).replace(":", ".")} น.`,
  ];
}

// สระบน/ล่าง วรรณยุกต์ และเครื่องหมายผสม ห้ามขึ้นต้นบรรทัด
const COMBINING = /^[ัิ-ฺ็-๎]/;

/** ตัดคำที่ไม่มีช่องว่างและยาวเกิน maxChars (นับตาม code point) โดยไม่ให้บรรทัดใหม่ขึ้นต้นด้วยอักขระผสม */
function hardBreak(word: string, maxChars: number): string[] {
  const cps = [...word];
  const out: string[] = [];
  let i = 0;
  while (cps.length - i > maxChars) {
    let end = i + maxChars;
    // ถอยไปก่อนตัวฐานหากตัวถัดไปเป็นอักขระผสม
    while (end > i + 1 && COMBINING.test(cps[end])) end--;
    out.push(cps.slice(i, end).join(""));
    i = end;
  }
  out.push(cps.slice(i).join(""));
  return out;
}

export function endorsementLines(
  e: { note: string; signerName: string; position: string; date: string },
  maxChars = 48,
): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const para of e.note.split(/\r?\n/)) {
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const parts = [...word].length > maxChars ? hardBreak(word, maxChars) : [word];
      for (const part of parts) {
        const joined = cur ? `${cur} ${part}` : part;
        if ([...joined].length <= maxChars) {
          cur = joined;
        } else {
          if (cur) lines.push(cur);
          cur = part;
        }
      }
    }
    if (cur) lines.push(cur);
    cur = "";
  }
  return [...lines, `(${e.signerName})`, e.position, formatThaiDate(e.date, "short")];
}

/** ฝัง PNG ลงหน้า PDF (หน่วย point นับจากมุมซ้ายล่าง, page เริ่มที่ 0) */
export async function embedPng(
  pdf: Uint8Array,
  png: Uint8Array,
  box: { page: number; x: number; y: number; width: number; height: number },
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf);
  const img = await doc.embedPng(png);
  const page = doc.getPage(box.page);
  page.drawImage(img, { x: box.x, y: box.y, width: box.width, height: box.height });
  return doc.save();
}
