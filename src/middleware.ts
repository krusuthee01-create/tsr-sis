import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Next เติม basePath (/sis) หน้า matcher ให้เอง — ที่นี่จึงเขียนแบบไม่มี /sis
  // "/" = หน้าแรก /sis (แบบที่สองต้องมี / ตามหลัง /sis จึงไม่ครอบหน้าแรก)
  matcher: ["/", "/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js|.*\\.(?:png|svg|jpg|webp|ico)$).*)"],
};
