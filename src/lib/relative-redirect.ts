import { NextResponse } from "next/server";
import { withBase } from "@/lib/base-path";

/**
 * redirect แบบ relative (Location: /sis/...) — เบราว์เซอร์ต่อกับที่อยู่ที่เปิดอยู่
 * (gotime.anubantep.ac.th หรือ sis.anubantep.ac.th) จึงไม่หลุดไป tsr-sis.vercel.app
 * หลัง Caddy ของระบบลงเวลา Host ที่ Vercel เห็นคือ tsr-sis.vercel.app — ห้ามใช้ request.nextUrl.origin สร้างที่อยู่
 * ใช้ได้ใน route handler เท่านั้น (middleware ของ Next บังคับ Location เป็น URL เต็ม ดู lib/supabase/middleware.ts)
 */
export function relativeRedirect(path: string, status: 302 | 303 | 307 = 307): NextResponse {
  return new NextResponse(null, { status, headers: { Location: withBase(path), "Cache-Control": "no-store" } });
}
