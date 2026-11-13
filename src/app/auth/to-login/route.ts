import { relativeRedirect } from "@/lib/relative-redirect";

/** middleware ส่งผู้ที่ยังไม่เข้าสู่ระบบมาที่นี่ (rewrite) เพื่อได้ redirect แบบ relative ไปหน้าเข้าสู่ระบบ */
export function GET() {
  return relativeRedirect("/login");
}

// คำขอแบบอื่น (เช่น server action ตอน session หมดอายุ) ก็พาไปหน้าเข้าสู่ระบบเช่นเดียวกับก่อนมี /sis
export { GET as POST };
