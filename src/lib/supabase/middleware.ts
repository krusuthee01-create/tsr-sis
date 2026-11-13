import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE_OPTIONS, COOKIE_MAX_AGE, MIGRATED_COOKIE, MIGRATE_NEXT_HEADER, authStorageKey, planCookieMigration } from "./cookies";

// path ใน middleware ไม่มี /sis (Next ตัด basePath ออกให้แล้ว)
const PUBLIC_PATHS = ["/login", "/auth", "/offline"];

/** rewrite ภายในไปที่ route handler ใต้ /sis/auth (URL ในแถบที่อยู่ไม่เปลี่ยน) */
function rewriteTo(request: NextRequest, pathname: string, headers?: Record<string, string>) {
  const target = request.nextUrl.clone();
  target.pathname = pathname;
  target.search = "";
  if (!headers) return NextResponse.rewrite(target);
  const h = new Headers(request.headers);
  for (const [k, v] of Object.entries(headers)) h.set(k, v);
  return NextResponse.rewrite(target, { request: { headers: h } });
}

/** ต่ออายุ session ทุกคำขอ และพาไปหน้าเข้าสู่ระบบถ้ายังไม่ล็อกอิน */
export async function updateSession(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const path = request.nextUrl.pathname;
  const migration = planCookieMigration(request.cookies.getAll(), authStorageKey(url));

  // มีคุกกี้เข้าสู่ระบบรุ่นก่อน /sis → ย้ายก่อน (ครั้งเดียวต่อเครื่อง แล้วกลับหน้าเดิม) ดู app/auth/migrate-cookies
  if (migration.copy.length && request.method === "GET" && !path.startsWith("/auth/")) {
    return rewriteTo(request, "/auth/migrate-cookies", { [MIGRATE_NEXT_HEADER]: path + request.nextUrl.search });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !PUBLIC_PATHS.some((p) => path.startsWith(p))) {
    // ไม่ใช้ NextResponse.redirect: middleware ของ Next บังคับ Location เป็น URL เต็มจาก Host ของคำขอ
    // ซึ่งหลัง Caddy คือ tsr-sis.vercel.app (เบราว์เซอร์จะหลุดออกจาก gotime) — จึง rewrite ภายใน
    // ไปที่ /sis/auth/to-login ที่ตอบ Location แบบ relative (/sis/login) แทน
    return markMigrated(rewriteTo(request, "/auth/to-login"), migration.done);
  }
  return markMigrated(response, migration.done);
}

/** เครื่องที่ไม่มีคุกกี้รุ่นเก่า: จำไว้ว่าไม่ต้องย้ายอีก */
function markMigrated(response: NextResponse, done: boolean): NextResponse {
  if (!done) response.cookies.set(MIGRATED_COOKIE, "1", { ...AUTH_COOKIE_OPTIONS, sameSite: "lax", maxAge: COOKIE_MAX_AGE, httpOnly: true });
  return response;
}
