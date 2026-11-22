// ทะเบียนหนังสือส่ง / คำสั่ง / ประกาศ: ชนิด ป้าย ตรวจข้อมูล และแถวส่งออก (ทดสอบด้วย node ได้)
import { formatThaiDate } from "../thai-date.ts";
import { isIsoDate } from "./register.ts";

export type OutKind = "letter" | "circular" | "order" | "announce" | "memo";
export type OutSeries = "out" | "order" | "announce" | "memo";
/** ชนิดที่ขอเลขได้จากหน้าทะเบียน (บันทึกข้อความออกเลขจากหน้าเขียนบันทึกข้อความ) */
export const OUT_KINDS: readonly OutKind[] = ["letter", "circular", "order", "announce"];
export const OUT_SERIES: readonly OutSeries[] = ["out", "order", "announce", "memo"];

export const OUT_KIND_LABEL: Record<OutKind, string> = {
  letter: "หนังสือส่ง",
  circular: "หนังสือเวียน",
  order: "คำสั่ง",
  announce: "ประกาศ",
  memo: "บันทึกข้อความ",
};
export const OUT_SERIES_LABEL: Record<OutSeries, string> = { out: "หนังสือส่ง", order: "คำสั่ง", announce: "ประกาศ", memo: "บันทึกข้อความ" };
/** ชนิดที่เลือกได้ในแต่ละชุดเลข */
export const SERIES_KINDS: Record<OutSeries, OutKind[]> = { out: ["letter", "circular"], order: ["order"], announce: ["announce"], memo: ["memo"] };

export type OutRow = {
  id: string; kind: OutKind; series: OutSeries; year: number; seq: number; doc_no: string; doc_date: string;
  to_text: string | null; subject: string; secret: boolean; note: string | null; requested_by: string; book_id?: string | null;
  deleted_at: string | null; deleted_reason: string | null; created_at: string;
};

export type OutInput = { kind: OutKind; docDate: string; toText: string; subject: string; secret: boolean; note: string };

/** ตรวจข้อมูลจาก server action ตามชนิดจริง — คืนข้อความภาษาไทยเมื่อไม่ถูกต้อง */
export function parseOutInput(raw: unknown): { ok: true; input: OutInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  const r = raw as Record<string, unknown>;
  const text = (v: unknown, max: number): string | null => (v == null ? "" : typeof v === "string" && v.length <= max ? v : null);
  const toText = text(r.toText, 300), subject = text(r.subject, 1000), note = text(r.note, 1000), docDate = text(r.docDate, 10);
  if (toText === null || subject === null || note === null || docDate === null) return { ok: false, error: "ข้อมูลไม่ถูกต้องหรือยาวเกินไป" };
  if (!OUT_KINDS.includes(r.kind as OutKind)) return { ok: false, error: "ชนิดหนังสือไม่ถูกต้อง" };
  if (typeof r.secret !== "boolean") return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  if (!subject.trim()) return { ok: false, error: "กรุณากรอกเรื่อง" };
  if (docDate && !isIsoDate(docDate)) return { ok: false, error: "วันที่ไม่ถูกต้อง" };
  return { ok: true, input: { kind: r.kind as OutKind, docDate, toText, subject, secret: r.secret, note } };
}

/** หัวตารางตามแบบทะเบียนในระเบียบงานสารบรรณ */
export function outRegistryHead(series: OutSeries): string[] {
  return series === "out"
    ? ["เลขทะเบียนส่ง", "ที่", "ลงวันที่", "จาก", "ถึง", "เรื่อง", "การปฏิบัติ", "หมายเหตุ"]
    : ["ที่", "ลงวันที่", "เรื่อง", "ผู้ขอ", "หมายเหตุ"];
}

/** แถวของทะเบียน (หน้าจอ/Excel/พิมพ์): เลขที่ยกเลิกยังอยู่พร้อมเหตุผล */
export function outRegistryRow(o: OutRow, requester: string, schoolName: string): string[] {
  const remark = [o.deleted_at ? `ยกเลิก: ${o.deleted_reason ?? ""}` : "", o.secret ? "ลับ" : "", o.kind === "circular" ? "หนังสือเวียน" : "", o.note ?? ""]
    .filter(Boolean).join(" · ");
  const date = formatThaiDate(o.doc_date);
  return o.series === "out"
    ? [String(o.seq), o.doc_no, date, schoolName, o.to_text ?? "", o.subject, `ขอเลขโดย ${requester}`, remark]
    : [o.doc_no, date, o.subject, requester, remark];
}
