import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { createUploadSession, DriveSetupError } from "@/lib/saraban/drive";
import { FILE_KINDS, MAX_UPLOAD_BYTES, type FileKind } from "@/lib/saraban/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * เปิด resumable upload session ของ Google Drive ให้เบราว์เซอร์อัปโหลด PDF ตรง (ไม่ผ่านขีดจำกัด 4.5MB ของ Vercel)
 * body: {bookId, kind, name, size} → {uploadUrl}
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { bookId?: unknown; kind?: unknown; name?: unknown; size?: unknown } | null;
  const bookId = typeof body?.bookId === "string" ? body.bookId : "";
  const kind = body?.kind as FileKind;
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 200) : "";
  const size = typeof body?.size === "number" ? body.size : NaN;
  if (!UUID.test(bookId) || !FILE_KINDS.includes(kind) || !name || !Number.isInteger(size) || size <= 0) {
    return NextResponse.json({ error: "ข้อมูลไฟล์ไม่ถูกต้อง" }, { status: 400 });
  }
  if (size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "ไฟล์ใหญ่เกิน 30 MB" }, { status: 413 });

  // ตรวจสิทธิ์ด้วย client ของผู้ใช้ (บทบาทมาจาก auth.uid() ในฐานข้อมูล)
  const sb = await supabaseServer();
  const [{ data: allowed }, { data: staffId }] = await Promise.all([
    sb.rpc("saraban_can_upload", { p_book: bookId, p_kind: kind }),
    sb.rpc("my_staff_id"),
  ]);
  if (allowed !== true || typeof staffId !== "string") {
    return NextResponse.json({ error: "ไม่มีสิทธิ์อัปโหลดไฟล์ของหนังสือนี้" }, { status: 403 });
  }

  // origin ของเบราว์เซอร์ (หลัง Caddy คือ gotime.anubantep.ac.th) — Google ต้องอนุญาต CORS ให้ origin นี้
  const origin = req.headers.get("origin") || new URL(req.url).origin;
  try {
    const uploadUrl = await createUploadSession({
      name,
      size,
      mime: "application/pdf",
      origin,
      appProperties: { bookId, kind, uploader: staffId },
    });
    return NextResponse.json({ uploadUrl });
  } catch (e) {
    console.error("saraban upload-session", e);
    // ยังไม่เชื่อมต่อ/การเชื่อมต่อหมดอายุ: ข้อความภาษาไทยบอกว่าต้องทำอะไร
    if (e instanceof DriveSetupError) return NextResponse.json({ error: e.message }, { status: 503 });
    return NextResponse.json({ error: "เปิดการอัปโหลดไม่สำเร็จ กรุณาลองใหม่" }, { status: 502 });
  }
}
