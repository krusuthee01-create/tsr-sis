// บันทึกข้อความภายใน: ตรวจข้อมูล และจัดหน้า A4 (ฟังก์ชันล้วน — ใช้ฟังก์ชันวัดความกว้างที่ส่งเข้ามา ทดสอบด้วย node ได้)
import { formatThaiDate, thaiDigits } from "../thai-date.ts";

export type MemoInput = {
  unit: string;      // ส่วนราชการ
  subject: string;   // เรื่อง
  to: string;        // เรียน
  cause: string;     // ภาคเหตุ
  intent: string;    // ภาคความประสงค์
  closing: string;   // ภาคสรุป
  position: string;  // ตำแหน่งผู้เขียน
};

export function parseMemoInput(raw: unknown): { ok: true; input: MemoInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  const r = raw as Record<string, unknown>;
  const lim: Record<keyof MemoInput, number> = { unit: 300, subject: 1000, to: 300, cause: 4000, intent: 4000, closing: 2000, position: 200 };
  const out = {} as MemoInput;
  for (const k of Object.keys(lim) as (keyof MemoInput)[]) {
    const v = r[k] == null ? "" : r[k];
    if (typeof v !== "string" || v.length > lim[k]) return { ok: false, error: "ข้อมูลไม่ถูกต้องหรือยาวเกินไป" };
    out[k] = v;
  }
  if (!out.subject.trim()) return { ok: false, error: "กรุณากรอกเรื่อง" };
  if (!out.cause.trim() && !out.intent.trim()) return { ok: false, error: "กรุณากรอกเนื้อหา (ภาคเหตุหรือภาคความประสงค์)" };
  return { ok: true, input: out };
}

/** หน้า A4 (point) และระยะขอบตามแบบหนังสือราชการ: ซ้าย 3 ซม. ขวา 2 ซม. */
export const MEMO_PAGE = { width: 595.28, height: 841.89, left: 85, right: 57, top: 40, bottom: 60 } as const;
export const MEMO_FONT = { body: 15, title: 27, line: 24 } as const;

export type Measure = (text: string, size: number, bold: boolean) => number;
export type MemoOp =
  | { t: "text"; x: number; y: number; text: string; size: number; bold: boolean; align?: "left" | "center" }
  | { t: "image"; key: "garuda" | "signature"; x: number; y: number; w: number; h: number }
  | { t: "line"; x1: number; x2: number; y: number };

// ห้ามขึ้นต้นบรรทัดด้วยสระบน/ล่าง วรรณยุกต์ ำ ะ า ๆ ฯ และห้ามจบบรรทัดด้วยสระหน้า
const NO_START = /^[ฯะ-ฺๅ-๎]/;
const NO_END = /[เ-ไ]$/;

function segments(text: string): string[] {
  const Seg = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  const raw = Seg ? [...new Seg("th", { granularity: "word" }).segment(text)].map((s) => s.segment) : text.split(/(\s+)/).filter(Boolean);
  const out: string[] = [];
  for (const s of raw) {
    const prev = out[out.length - 1];
    if (prev && !/^\s+$/.test(s) && !/\s$/.test(prev) && (NO_START.test(s) || NO_END.test(prev))) out[out.length - 1] = prev + s;
    else out.push(s);
  }
  return out;
}

/** ตัดข้อความหนึ่งย่อหน้าเป็นบรรทัดตามความกว้างจริง (บรรทัดแรกกว้าง firstWidth) */
export function wrapThai(text: string, width: number, measure: Measure, size: number, bold = false, firstWidth = width): string[] {
  const lines: string[] = [];
  let cur = "";
  let max = firstWidth;
  const push = () => { lines.push(cur.trimEnd()); cur = ""; max = width; };
  for (const seg of segments(text)) {
    if (cur === "" && /^\s+$/.test(seg)) continue;
    if (measure(cur + seg, size, bold) <= max) { cur += seg; continue; }
    if (cur.trim()) push();
    if (/^\s+$/.test(seg)) continue;
    // คำเดียวยาวกว่าบรรทัด: ตัดตามตัวอักษร (ไม่ให้สระ/วรรณยุกต์ขึ้นต้นบรรทัด)
    let piece = "";
    for (const ch of [...seg]) {
      if (piece && measure(piece + ch, size, bold) > max && !NO_START.test(ch)) { cur = piece; push(); piece = ""; }
      piece += ch;
    }
    cur = piece;
  }
  if (cur.trim() || lines.length === 0) lines.push(cur.trimEnd());
  return lines;
}

/**
 * จัดหน้าบันทึกข้อความ: ครุฑ + "บันทึกข้อความ" · ส่วนราชการ · ที่/วันที่ · เรื่อง · เรียน · เนื้อหา 3 ภาค · ลงชื่อ
 * ขึ้นหน้าใหม่อัตโนมัติ (หน้าถัดไปมีเลขหน้า -๒- กลางบน) · เลขและวันที่เป็นเลขไทย
 */
export function layoutMemo(
  m: MemoInput & { docNo: string; date: string; signerName: string; hasSignature: boolean },
  measure: Measure,
): MemoOp[][] {
  const P = MEMO_PAGE, F = MEMO_FONT;
  const width = P.width - P.left - P.right;
  const pages: MemoOp[][] = [[]];
  let page = pages[0];
  let y = P.top;
  const newPage = () => {
    page = [];
    pages.push(page);
    page.push({ t: "text", x: P.width / 2, y: P.top, text: `-${thaiDigits(pages.length)}-`, size: F.body, bold: false, align: "center" });
    y = P.top + F.line * 1.5;
  };
  const need = (h: number) => { if (y + h > P.height - P.bottom) newPage(); };

  // หัว: ครุฑ (สูง 1.5 ซม.) และ "บันทึกข้อความ"
  page.push({ t: "image", key: "garuda", x: P.left, y, w: 39, h: 43 });
  page.push({ t: "text", x: P.width / 2, y: y + 8, text: "บันทึกข้อความ", size: F.title, bold: true, align: "center" });
  y += 62;

  /** หัวข้อ (ตัวหนา) ตามด้วยค่าที่ตัดบรรทัดได้ */
  const labeled = (label: string, value: string, x0 = P.left, w = width) => {
    const lw = measure(label + "  ", F.body, true);
    const lines = wrapThai(value, w, measure, F.body, false, w - lw);
    lines.forEach((l, i) => {
      need(F.line);
      if (i === 0) page.push({ t: "text", x: x0, y, text: label, size: F.body, bold: true });
      page.push({ t: "text", x: i === 0 ? x0 + lw : x0, y, text: l, size: F.body, bold: false });
      y += F.line;
    });
  };
  labeled("ส่วนราชการ", m.unit.trim());
  // ที่ (ครึ่งซ้าย) / วันที่ (ครึ่งขวา) บรรทัดเดียวกัน
  const half = P.left + width * 0.5;
  const thLabel = measure("ที่  ", F.body, true);
  page.push({ t: "text", x: P.left, y, text: "ที่", size: F.body, bold: true });
  page.push({ t: "text", x: P.left + thLabel, y, text: thaiDigits(m.docNo), size: F.body, bold: false });
  const dLabel = measure("วันที่  ", F.body, true);
  page.push({ t: "text", x: half, y, text: "วันที่", size: F.body, bold: true });
  page.push({ t: "text", x: half + dLabel, y, text: thaiDigits(formatThaiDate(m.date, "long")), size: F.body, bold: false });
  y += F.line;
  labeled("เรื่อง", m.subject.trim());
  // เส้นคั่นใต้ "เรื่อง" (ใต้หางสระ/วรรณยุกต์ล่าง)
  page.push({ t: "line", x1: P.left, x2: P.width - P.right, y: y + 2 });
  y += F.line * 0.5;
  labeled("เรียน", m.to.trim());
  y += F.line * 0.3;

  // เนื้อหา 3 ภาค: ย่อหน้าละบรรทัดแรกเยื้อง 2.5 ซม. (ขึ้นบรรทัดใหม่ในช่อง = ย่อหน้าใหม่)
  const indent = 71;
  for (const part of [m.cause, m.intent, m.closing]) {
    for (const para of part.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) {
      const lines = wrapThai(para, width, measure, F.body, false, width - indent);
      lines.forEach((l, i) => {
        need(F.line);
        page.push({ t: "text", x: i === 0 ? P.left + indent : P.left, y, text: l, size: F.body, bold: false });
        y += F.line;
      });
    }
    y += F.line * 0.25;
  }

  // ลงชื่อ: กึ่งกลางค่อนขวา (ลายเซ็นเหนือชื่อ)
  const cx = P.left + width * 0.62;
  const sigH = m.hasSignature ? 40 : F.line * 1.6;
  need(sigH + F.line * 3);
  y += F.line * 0.6;
  if (m.hasSignature) page.push({ t: "image", key: "signature", x: cx - 60, y, w: 120, h: sigH });
  y += sigH;
  page.push({ t: "text", x: cx, y, text: `(${m.signerName.trim()})`, size: F.body, bold: false, align: "center" });
  y += F.line;
  if (m.position.trim()) {
    for (const l of wrapThai(m.position.trim(), width * 0.7, measure, F.body)) {
      need(F.line);
      page.push({ t: "text", x: cx, y, text: l, size: F.body, bold: false, align: "center" });
      y += F.line;
    }
  }
  return pages;
}
