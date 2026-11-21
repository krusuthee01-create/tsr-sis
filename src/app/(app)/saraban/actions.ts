"use server";

import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { driveFolderId, getFileMeta } from "@/lib/saraban/drive";
import { FILE_KINDS, MAX_UPLOAD_BYTES, type FileKind } from "@/lib/saraban/types";
import { parseRegisterInput, validateRegister, type RegisterInput } from "@/lib/saraban/register";
import type { PostgrestError } from "@supabase/supabase-js";

type FileResult = { ok: true; fileId: string } | { ok: false; error: string };

/**
 * บันทึกไฟล์ที่เบราว์เซอร์อัปโหลดเข้า Drive เสร็จแล้ว
 * ยืนยันจาก metadata ของ Drive (appProperties ตั้งโดยเซิร์ฟเวอร์ตอนเปิด session เบราว์เซอร์แก้ไม่ได้):
 * อยู่ในโฟลเดอร์สารบรรณ, เป็นของเล่มนี้, ชนิดตรง, ผู้อัปโหลดคือผู้ใช้คนนี้ — กันการส่ง driveFileId ของไฟล์อื่นมาแอบผูก
 */
export async function finalizeUpload(bookId: string, kind: FileKind, driveFileId: string): Promise<FileResult> {
  if (typeof bookId !== "string" || typeof driveFileId !== "string" || !driveFileId) return { ok: false, error: "ข้อมูลไฟล์ไม่ถูกต้อง" };
  if (!FILE_KINDS.includes(kind)) return { ok: false, error: "ชนิดไฟล์ไม่ถูกต้อง" };
  const sb = await supabaseServer();
  const [{ data: staffId }, { data: allowed }] = await Promise.all([
    sb.rpc("my_staff_id"),
    // ตรวจสิทธิ์ซ้ำ ณ ตอนบันทึก (สถานะเล่มอาจเปลี่ยนระหว่างอัปโหลด)
    sb.rpc("saraban_can_upload", { p_book: bookId, p_kind: kind }),
  ]);
  if (typeof staffId !== "string") return { ok: false, error: "กรุณาเข้าสู่ระบบ" };
  if (allowed !== true) return { ok: false, error: "ไม่มีสิทธิ์อัปโหลดไฟล์ของหนังสือนี้" };

  let meta;
  try {
    meta = await getFileMeta(driveFileId);
  } catch {
    return { ok: false, error: "ไม่พบไฟล์ที่อัปโหลด กรุณาอัปโหลดใหม่" };
  }
  const p = meta.appProperties;
  if (!meta.parents.includes(driveFolderId()) || p.bookId !== bookId || p.kind !== kind || p.uploader !== staffId) {
    return { ok: false, error: "ไฟล์ไม่ตรงกับหนังสือนี้ กรุณาอัปโหลดใหม่" };
  }
  if (meta.size <= 0 || meta.size > MAX_UPLOAD_BYTES) return { ok: false, error: "ขนาดไฟล์ไม่ถูกต้อง (ต้องไม่เกิน 30 MB)" };

  const admin = supabaseAdmin();
  // ไฟล์เดียวกันบันทึกซ้ำไม่ได้ (กดซ้ำ/ส่งซ้ำ)
  const { data: dup } = await admin.from("saraban_files").select("id").eq("drive_file_id", meta.id).limit(1);
  if (dup?.length) return { ok: false, error: "ไฟล์นี้บันทึกไว้แล้ว" };

  const { data: fileId, error } = await admin.rpc("saraban_add_file", {
    p_book: bookId,
    p_kind: kind,
    p_drive_file_id: meta.id,
    p_name: meta.name,
    p_size: meta.size,
    p_actor: staffId,
  });
  if (error || typeof fileId !== "string") {
    console.error("saraban_add_file", error);
    return { ok: false, error: "บันทึกไฟล์ไม่สำเร็จ กรุณาลองใหม่" };
  }
  return { ok: true, fileId };
}

type RegisterResult =
  | { ok: true; id: string; receiveNo: number; year: number; receivedAt: string }
  | { ok: false; error: string };

/** แปลงข้อผิดพลาดจาก RPC เป็นภาษาไทย: ข้อความจาก raise exception (P0001) เป็นภาษาไทยอยู่แล้ว ส่งต่อได้ */
function thaiError(error: PostgrestError, fallback: string): string {
  console.error("saraban rpc", error);
  if (error.code === "P0001" && error.message) return error.message;
  if (error.code === "23505") return "เลขรับนี้มีแล้วในปีนี้ กรุณาใช้เลขอื่น";
  if (error.code === "22P02" || error.code === "22007" || error.code === "22008") return "ข้อมูลวันที่หรือตัวเลขไม่ถูกต้อง";
  return fallback;
}

/** ลงรับหนังสือ (ผอ./ธุรการ) — RPC ตรวจสิทธิ์และออกเลขรับ */
export async function registerBook(raw: RegisterInput): Promise<RegisterResult> {
  // ตรวจชนิดข้อมูลจริง (เรียก server action ตรงได้โดยไม่ผ่านฟอร์ม)
  const parsed = parseRegisterInput(raw);
  if (!parsed.ok) return parsed;
  const input = parsed.input;
  const errors = validateRegister(input);
  const first = Object.values(errors)[0];
  if (first) return { ok: false, error: first };

  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("saraban_register", {
    p: {
      doc_no: input.docNo.trim(),
      doc_date: input.docDate || null,
      from_org: input.fromOrg.trim(),
      to_text: input.toText.trim(),
      subject: input.subject.trim(),
      urgency: input.urgency,
      secret: !!input.secret,
      due_date: input.dueDate || null,
      receive_no: input.receiveNo ?? null,
    },
  });
  if (error) return { ok: false, error: thaiError(error, "ลงรับไม่สำเร็จ กรุณาลองใหม่") };
  const r = data as { id: string; year: number; receive_no: number };
  // เวลาลงรับจริงจากฐานข้อมูล (ใช้พิมพ์บนตรารับ)
  const { data: book } = await sb.from("saraban_books").select("received_at").eq("id", r.id).maybeSingle();
  return { ok: true, id: r.id, receiveNo: r.receive_no, year: r.year, receivedAt: book?.received_at ?? new Date().toISOString() };
}

export type DuplicateBook = { id: string; receive_no: number; subject: string; received_at: string };

/** หนังสือปีนี้ที่เลขที่หนังสือซ้ำ (ใช้เตือนใต้ช่องเลขที่หนังสือ) */
export async function findDuplicates(docNo: string, fromOrg: string): Promise<DuplicateBook[]> {
  if (typeof docNo !== "string" || !docNo.trim()) return [];
  if (fromOrg != null && typeof fromOrg !== "string") return [];
  fromOrg = fromOrg ?? "";
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("saraban_find_duplicates", { p_doc_no: docNo.slice(0, 100), p_from_org: fromOrg.slice(0, 300) });
  if (error) {
    console.error("saraban_find_duplicates", error);
    return [];
  }
  return (data ?? []) as DuplicateBook[];
}

/** รายชื่อหน่วยงานที่เคยส่งหนังสือ (เติมช่อง "จาก" อัตโนมัติ) */
export async function orgSuggestions(q: string): Promise<string[]> {
  if (typeof q !== "string") return [];
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("saraban_org_suggestions", { p_q: q.slice(0, 100) });
  if (error) {
    console.error("saraban_org_suggestions", error);
    return [];
  }
  return (data ?? []) as string[];
}

export type InboxRow = {
  id: string; year: number; receive_no: number; doc_no: string | null; subject: string; from_org: string;
  urgency: number; secret: boolean; due_date: string | null; status: string; received_at: string;
  holder_name: string | null; unread: boolean; total: number;
};

/** รายการหนังสือหน้าถัดไป (ปุ่ม "โหลดเพิ่ม") */
export async function loadInbox(q: string, filter: "all" | "todo" | "unread", offset: number): Promise<{ ok: true; rows: InboxRow[] } | { ok: false; error: string }> {
  if (typeof q !== "string" || !["all", "todo", "unread"].includes(filter) || typeof offset !== "number") {
    return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  }
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("saraban_inbox", { p_q: q.slice(0, 200) || null, p_filter: filter, p_offset: Math.max(0, Math.floor(offset) || 0) });
  if (error) return { ok: false, error: thaiError(error, "โหลดรายการไม่สำเร็จ") };
  return { ok: true, rows: (data ?? []) as InboxRow[] };
}
