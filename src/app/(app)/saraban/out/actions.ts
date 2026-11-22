"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { isUuid } from "@/lib/saraban/book";
import { DriveSetupError, driveFolderId, getFileMeta } from "@/lib/saraban/drive";
import { MAX_UPLOAD_BYTES } from "@/lib/saraban/types";
import { parseOutInput } from "@/lib/saraban/outgoing";
import type { PostgrestError } from "@supabase/supabase-js";

type Result = { ok: true } | { ok: false; error: string };

/** ข้อความจาก raise exception (P0001) เป็นภาษาไทยอยู่แล้ว ส่งต่อได้ ข้อผิดพลาดอื่นใช้ข้อความทั่วไป */
function thaiError(error: PostgrestError, fallback: string): string {
  console.error("saraban out rpc", error);
  if (error.code === "P0001" && error.message) return error.message;
  if (error.code === "22P02" || error.code === "22007" || error.code === "22008") return "ข้อมูลวันที่ไม่ถูกต้อง";
  return fallback;
}

/** ขอเลขหนังสือส่ง/คำสั่ง/ประกาศ (บุคลากรทุกคน) — ฐานข้อมูลออกเลขถัดไป */
export async function issueOut(raw: unknown): Promise<{ ok: true; id: string; docNo: string } | { ok: false; error: string }> {
  const parsed = parseOutInput(raw);
  if (!parsed.ok) return parsed;
  const i = parsed.input;
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("saraban_out_issue", {
    p: { kind: i.kind, doc_date: i.docDate || null, to_text: i.toText.trim(), subject: i.subject.trim(), secret: i.secret, note: i.note.trim() },
  });
  if (error) return { ok: false, error: thaiError(error, "ขอเลขหนังสือไม่สำเร็จ กรุณาลองใหม่") };
  const r = data as { id: string; doc_no: string };
  revalidatePath("/saraban/out");
  return { ok: true, id: r.id, docNo: r.doc_no };
}

/** แก้รายละเอียด (ไม่เปลี่ยนเลข): ผู้ขอ หรือ ผอ./ธุรการ */
export async function updateOut(id: string, raw: unknown): Promise<Result> {
  if (!isUuid(id)) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  const parsed = parseOutInput(raw);
  if (!parsed.ok) return parsed;
  const i = parsed.input;
  const sb = await supabaseServer();
  const { error } = await sb.rpc("saraban_out_update", {
    p_out: id, p: { doc_date: i.docDate || null, to_text: i.toText.trim(), subject: i.subject.trim(), secret: i.secret, note: i.note.trim() },
  });
  if (error) return { ok: false, error: thaiError(error, "บันทึกไม่สำเร็จ กรุณาลองใหม่") };
  revalidatePath("/saraban/out");
  return { ok: true };
}

/** ยกเลิกเลข (ผอ./ธุรการ ระบุเหตุผล) */
export async function cancelOut(id: string, reason: string): Promise<Result> {
  if (!isUuid(id) || typeof reason !== "string" || reason.length > 500) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  const sb = await supabaseServer();
  const { error } = await sb.rpc("saraban_out_cancel", { p_out: id, p_reason: reason });
  if (error) return { ok: false, error: thaiError(error, "ยกเลิกเลขไม่สำเร็จ กรุณาลองใหม่") };
  revalidatePath("/saraban/out");
  return { ok: true };
}

/** ตั้งเลขที่หนังสือของโรงเรียน เช่น "ศธ 04109.84" (ผอ./ธุรการ) */
export async function setOutPrefix(prefix: string): Promise<Result> {
  if (typeof prefix !== "string") return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  const sb = await supabaseServer();
  const { error } = await sb.rpc("saraban_set_prefix", { p_prefix: prefix });
  if (error) return { ok: false, error: thaiError(error, "บันทึกไม่สำเร็จ กรุณาลองใหม่") };
  revalidatePath("/saraban/out");
  revalidatePath("/saraban/settings");
  return { ok: true };
}

/**
 * บันทึกสำเนาที่อัปโหลดเข้า Drive แล้ว — ยืนยันจาก metadata ของ Drive ที่เซิร์ฟเวอร์ตั้งตอนเปิด session
 * (อยู่ในโฟลเดอร์สารบรรณ, เป็นของรายการนี้, ชนิด outgoing, ผู้อัปโหลดคือผู้ใช้คนนี้)
 */
export async function finalizeOutUpload(outId: string, driveFileId: string): Promise<{ ok: true; fileId: string } | { ok: false; error: string }> {
  if (!isUuid(outId) || typeof driveFileId !== "string" || !driveFileId) return { ok: false, error: "ข้อมูลไฟล์ไม่ถูกต้อง" };
  const sb = await supabaseServer();
  const [{ data: staffId }, { data: allowed }] = await Promise.all([
    sb.rpc("my_staff_id"),
    sb.rpc("saraban_out_can_upload", { p_out: outId }),
  ]);
  if (typeof staffId !== "string") return { ok: false, error: "กรุณาเข้าสู่ระบบ" };
  if (allowed !== true) return { ok: false, error: "ไม่มีสิทธิ์แนบไฟล์ของรายการนี้" };

  let meta, folderId: string;
  try {
    folderId = await driveFolderId();
    meta = await getFileMeta(driveFileId);
  } catch (e) {
    if (e instanceof DriveSetupError) return { ok: false, error: e.message };
    return { ok: false, error: "ไม่พบไฟล์ที่อัปโหลด กรุณาอัปโหลดใหม่" };
  }
  const p = meta.appProperties;
  if (!meta.parents.includes(folderId) || p.bookId !== outId || p.kind !== "outgoing" || p.uploader !== staffId) {
    return { ok: false, error: "ไฟล์ไม่ตรงกับรายการนี้ กรุณาอัปโหลดใหม่" };
  }
  if (meta.size <= 0 || meta.size > MAX_UPLOAD_BYTES) return { ok: false, error: "ขนาดไฟล์ไม่ถูกต้อง (ต้องไม่เกิน 30 MB)" };

  const admin = supabaseAdmin();
  const { data: dup } = await admin.from("saraban_out_files").select("id").eq("drive_file_id", meta.id).limit(1);
  if (dup?.length) return { ok: false, error: "ไฟล์นี้บันทึกไว้แล้ว" };
  const { data: fileId, error } = await admin.rpc("saraban_out_add_file", {
    p_out: outId, p_drive_file_id: meta.id, p_name: meta.name, p_size: meta.size, p_actor: staffId,
  });
  if (error || typeof fileId !== "string") {
    console.error("saraban_out_add_file", error);
    return { ok: false, error: "บันทึกไฟล์ไม่สำเร็จ กรุณาลองใหม่" };
  }
  revalidatePath("/saraban/out");
  return { ok: true, fileId };
}
