import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { streamFile } from "@/lib/saraban/drive";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ส่ง PDF ตามสิทธิ์: อ่านแถว saraban_files ด้วย client ของผู้ใช้ (RLS ตาม can_view_book)
 * ไม่เห็นแถว = 404 (ไม่บอกว่ามีไฟล์อยู่) — เห็นแล้วจึงส่งต่อจาก Drive
 * แต่ละเวอร์ชันไม่เปลี่ยนเนื้อหา จึง cache แบบ immutable (private: เฉพาะเบราว์เซอร์ของผู้ใช้)
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "ไม่พบไฟล์" }, { status: 404 });
  const sb = await supabaseServer();
  const { data: file } = await sb.from("saraban_files").select("drive_file_id, name").eq("id", id).maybeSingle();
  if (!file) return NextResponse.json({ error: "ไม่พบไฟล์" }, { status: 404 });

  const upstream = await streamFile(file.drive_file_id).catch((e) => {
    console.error("saraban file", e);
    return null;
  });
  if (!upstream?.ok || !upstream.body) {
    // ปล่อย connection ไปยัง Drive (ไม่อ่าน body ที่ไม่ใช้)
    await upstream?.body?.cancel().catch(() => {});
    return NextResponse.json({ error: "เปิดไฟล์จาก Google Drive ไม่สำเร็จ" }, { status: 502 });
  }

  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Cache-Control": "private, max-age=31536000, immutable",
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    "X-Content-Type-Options": "nosniff",
  });
  // fetch คลายการบีบอัดให้แล้ว: content-length ของต้นทางเป็นขนาดก่อนคลาย จึงคัดลอกเฉพาะเมื่อไม่ได้บีบอัด
  const len = upstream.headers.get("content-length");
  if (len && !upstream.headers.get("content-encoding")) headers.set("Content-Length", len);
  return new Response(upstream.body, { status: 200, headers });
}
