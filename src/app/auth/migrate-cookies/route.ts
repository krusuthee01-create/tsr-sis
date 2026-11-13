import type { NextRequest } from "next/server";
import { relativeRedirect } from "@/lib/relative-redirect";
import {
  AUTH_COOKIE_OPTIONS, COOKIE_MAX_AGE, MIGRATED_COOKIE, MIGRATE_NEXT_HEADER, authStorageKey, clearRootCookieHeader, planCookieMigration,
} from "@/lib/supabase/cookies";

/**
 * ย้ายคุกกี้เข้าสู่ระบบรุ่นก่อน /sis (path "/") มาที่ path /sis แล้วพากลับหน้าเดิม — ครั้งเดียวต่อเครื่อง
 * middleware rewrite มาที่นี่ (ต้องทำใน route handler: middleware ของ Next รวม Set-Cookie ชื่อซ้ำเหลือตัวเดียว
 * จึงเขียน "ค่าเดิมที่ /sis" กับ "ลบตัวที่ /" ในคำตอบเดียวกันไม่ได้)
 */
export function GET(request: NextRequest) {
  const raw = request.headers.get(MIGRATE_NEXT_HEADER) ?? "/";
  // กันพาออกนอกระบบ: ต้องเป็น path ภายใน (ไม่ใช่ //host หรือ /\host)
  const next = raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\") ? raw : "/";
  const res = relativeRedirect(next);
  const plan = planCookieMigration(request.cookies.getAll(), authStorageKey(process.env.NEXT_PUBLIC_SUPABASE_URL!));
  const attrs = `Path=${AUTH_COOKIE_OPTIONS.path}; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax`;
  for (const c of plan.copy) res.headers.append("Set-Cookie", `${c.name}=${encodeURIComponent(c.value)}; ${attrs}`);
  for (const name of plan.clear) res.headers.append("Set-Cookie", clearRootCookieHeader(name));
  res.headers.append("Set-Cookie", `${MIGRATED_COOKIE}=1; ${attrs}; HttpOnly`);
  return res;
}
