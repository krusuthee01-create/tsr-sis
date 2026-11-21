import { NextResponse } from "next/server";
import { isFakeDrive, writeFakeUpload } from "@/lib/saraban/drive";
import { MAX_UPLOAD_BYTES } from "@/lib/saraban/types";

/**
 * ปลายทางอัปโหลดในโหมดจำลอง (ทดสอบ/e2e) แทน resumable URL ของ Google Drive
 * ปิด (404) เมื่อไม่ได้ตั้ง SARABAN_DRIVE_FAKE_DIR หรือรันบน production ของ Vercel — บนเซิร์ฟเวอร์จริงจึงใช้ไม่ได้
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isFakeDrive()) return NextResponse.json({ error: "ไม่พบ" }, { status: 404 });
  const { id } = await params;
  const data = new Uint8Array(await req.arrayBuffer());
  if (data.byteLength > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "ไฟล์ใหญ่เกิน 30 MB" }, { status: 413 });
  const meta = await writeFakeUpload(id, data).catch(() => null);
  if (!meta) return NextResponse.json({ error: "ไม่พบ" }, { status: 404 });
  // ตอบแบบเดียวกับ Drive (เบราว์เซอร์อ่าน id จาก JSON)
  return NextResponse.json({ id: meta.id, name: meta.name });
}
