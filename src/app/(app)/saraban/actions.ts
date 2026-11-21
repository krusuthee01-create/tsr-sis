"use server";

import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { driveFolderId, getFileMeta } from "@/lib/saraban/drive";
import { FILE_KINDS, MAX_UPLOAD_BYTES, type FileKind } from "@/lib/saraban/types";

type FileResult = { ok: true; fileId: string } | { ok: false; error: string };

/**
 * บันทึกไฟล์ที่เบราว์เซอร์อัปโหลดเข้า Drive เสร็จแล้ว
 * ยืนยันจาก metadata ของ Drive (appProperties ตั้งโดยเซิร์ฟเวอร์ตอนเปิด session เบราว์เซอร์แก้ไม่ได้):
 * อยู่ในโฟลเดอร์สารบรรณ, เป็นของเล่มนี้, ชนิดตรง, ผู้อัปโหลดคือผู้ใช้คนนี้ — กันการส่ง driveFileId ของไฟล์อื่นมาแอบผูก
 */
export async function finalizeUpload(bookId: string, kind: FileKind, driveFileId: string): Promise<FileResult> {
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
  if (error || typeof fileId !== "string") return { ok: false, error: "บันทึกไฟล์ไม่สำเร็จ: " + (error?.message ?? "") };
  return { ok: true, fileId };
}
