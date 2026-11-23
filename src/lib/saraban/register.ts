// ตรวจข้อมูลฟอร์มลงรับหนังสือ (ใช้ทั้งฝั่งเบราว์เซอร์ก่อนส่ง และใน server action ซ้ำอีกชั้น)
import { DOC_TYPES, type DocType } from "./types.ts";

export type RegisterInput = {
  docNo: string;
  docDate: string; // YYYY-MM-DD หรือว่าง
  fromOrg: string;
  toText: string;
  subject: string;
  urgency: number;
  secret: boolean;
  dueDate: string; // YYYY-MM-DD หรือว่าง
  receiveNo?: number | null; // ว่าง = ให้ระบบออกเลขถัดไป
  docType: DocType;
  refText: string; // อ้างถึง
  detail: string; // รายละเอียด/สาระสำคัญ
};

/** วันที่รูปแบบ YYYY-MM-DD ที่มีอยู่จริง (ปี ค.ศ. 1900–2600) */
export function isIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 2600) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/**
 * แปลงข้อมูลที่ส่งมาเป็น RegisterInput โดยตรวจชนิดจริง (server action รับค่าอะไรก็ได้จากผู้เรียก)
 * ช่องข้อความที่ไม่บังคับ: undefined/null = ว่าง
 */
export function parseRegisterInput(raw: unknown): { ok: true; input: RegisterInput } | { ok: false; error: string } {
  const bad = { ok: false as const, error: "ข้อมูลไม่ถูกต้อง กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง" };
  if (!raw || typeof raw !== "object") return bad;
  const r = raw as Record<string, unknown>;
  const text = (v: unknown): string | null => (v == null ? "" : typeof v === "string" ? v : null);
  const docNo = text(r.docNo), docDate = text(r.docDate), fromOrg = text(r.fromOrg), toText = text(r.toText),
    subject = text(r.subject), dueDate = text(r.dueDate), refText = text(r.refText), detail = text(r.detail);
  if (docNo === null || docDate === null || fromOrg === null || toText === null || subject === null || dueDate === null) return bad;
  if (refText === null || detail === null) return bad;
  const docType = r.docType == null ? "external" : r.docType;
  if (typeof docType !== "string" || !DOC_TYPES.includes(docType as DocType)) return { ok: false, error: "ชนิดหนังสือไม่ถูกต้อง" };
  if (typeof r.secret !== "boolean") return bad;
  if (typeof r.urgency !== "number" || !Number.isInteger(r.urgency) || r.urgency < 0 || r.urgency > 3) {
    return { ok: false, error: "ระดับความเร่งด่วนไม่ถูกต้อง" };
  }
  let receiveNo: number | null = null;
  if (r.receiveNo != null) {
    if (typeof r.receiveNo !== "number" || !Number.isInteger(r.receiveNo) || r.receiveNo < 1 || r.receiveNo > 999_999_999) {
      return { ok: false, error: "เลขรับต้องเป็นจำนวนเต็มมากกว่า 0" };
    }
    receiveNo = r.receiveNo;
  }
  return {
    ok: true,
    input: { docNo, docDate, fromOrg, toText, subject, urgency: r.urgency, secret: r.secret, dueDate, receiveNo, docType: docType as DocType, refText, detail },
  };
}

const MAX_LEN = { docNo: 100, fromOrg: 300, toText: 300, subject: 1000, refText: 500, detail: 3000 } as const;

/** คืนข้อความผิดพลาดภาษาไทย (รายช่อง) — ว่างคือผ่าน */
export function validateRegister(input: RegisterInput): Partial<Record<keyof RegisterInput, string>> {
  const e: Partial<Record<keyof RegisterInput, string>> = {};
  if (!input.fromOrg?.trim()) e.fromOrg = "กรุณากรอกหน่วยงานที่ส่ง";
  if (!input.subject?.trim()) e.subject = "กรุณากรอกเรื่อง";
  for (const k of Object.keys(MAX_LEN) as (keyof typeof MAX_LEN)[]) {
    if (!e[k] && (input[k] ?? "").trim().length > MAX_LEN[k]) e[k] = `ยาวเกิน ${MAX_LEN[k]} ตัวอักษร`;
  }
  if (input.docDate && !isIsoDate(input.docDate)) e.docDate = "วันที่ไม่ถูกต้อง";
  if (input.dueDate && !isIsoDate(input.dueDate)) e.dueDate = "วันที่ไม่ถูกต้อง";
  if (!Number.isInteger(input.urgency) || input.urgency < 0 || input.urgency > 3) e.urgency = "ระดับความเร่งด่วนไม่ถูกต้อง";
  if (input.receiveNo != null && (!Number.isInteger(input.receiveNo) || input.receiveNo < 1 || input.receiveNo > 999_999_999)) {
    e.receiveNo = "เลขรับต้องเป็นจำนวนเต็มมากกว่า 0";
  }
  return e;
}

/** ตำแหน่งตรารับ: มุมขวาบนของหน้าแรก เว้นขอบ 18pt (พิกัด PDF นับจากมุมซ้ายล่าง) — หน้าเล็กกว่าตราจะย่อตราลงให้พอดี */
export function receiveStampBox(page: { width: number; height: number }, stamp: { width: number; height: number }, margin = 18) {
  const k = Math.min(1, (page.width - margin * 2) / stamp.width, (page.height - margin * 2) / stamp.height);
  const width = stamp.width * k, height = stamp.height * k;
  return { page: 0, x: page.width - width - margin, y: page.height - height - margin, width, height };
}
