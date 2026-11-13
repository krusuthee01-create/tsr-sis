// คุกกี้เข้าสู่ระบบของ TSR-SIS อยู่ที่ path /sis เท่านั้น
// เหตุผล: ใต้ gotime.anubantep.ac.th ใช้ origin ร่วมกับระบบลงเวลา — คุกกี้ของสองระบบต้องไม่ปนกัน
// (ชื่อคุกกี้ต่างกันอยู่แล้วเพราะคนละโปรเจกต์ Supabase: sb-<project-ref>-auth-token)
// ไฟล์นี้ไม่ import next เพื่อให้ทดสอบด้วย node --test ได้
import { BASE_PATH } from "../base-path.ts";

export const AUTH_COOKIE_OPTIONS = { path: BASE_PATH } as const;

// คุกกี้บอกว่าย้ายคุกกี้รุ่นเก่า (path "/") มาที่ /sis แล้ว
export const MIGRATED_COOKIE = "tsr-ck";
// middleware บอก route ย้ายคุกกี้ว่าหลังย้ายให้กลับหน้าไหน (path ไม่มี /sis)
export const MIGRATE_NEXT_HEADER = "x-tsr-migrate-next";
export const COOKIE_MAX_AGE = 400 * 24 * 60 * 60; // เท่าค่าเริ่มต้นของ @supabase/ssr

/** ชื่อคุกกี้ของ @supabase/ssr (ค่าเริ่มต้น): sb-<ส่วนแรกของ hostname>-auth-token */
export function authStorageKey(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
}

/** คุกกี้นี้เป็นของ Supabase Auth ของ TSR-SIS หรือไม่ (รวม chunk .0 .1 … และ -code-verifier) */
export function isAuthCookie(name: string, storageKey: string): boolean {
  return name === storageKey || name.startsWith(`${storageKey}.`) || name.startsWith(`${storageKey}-`);
}

export type CookiePair = { name: string; value: string };

/**
 * แผนย้ายคุกกี้รุ่นเก่า (ก่อนมี /sis คุกกี้อยู่ที่ path "/") ทำครั้งเดียวต่อเครื่อง:
 * - copy: เขียนค่าเดิมใหม่ที่ path /sis (ครูไม่ต้องเข้าสู่ระบบใหม่)
 * - clear: ลบตัวเดิมที่ path "/" — ถ้าไม่ลบ เบราว์เซอร์จะส่งคุกกี้ชื่อซ้ำสองตัว และตัวเก่า (token ที่หมดอายุแล้ว)
 *   อาจถูกอ่านแทนตัวใหม่ ทำให้หลุดจากระบบวนซ้ำ
 * มีคุกกี้ MIGRATED_COOKIE แล้ว = ย้ายแล้ว ไม่ทำอะไร
 */
export function planCookieMigration(cookies: CookiePair[], storageKey: string): { done: boolean; copy: CookiePair[]; clear: string[] } {
  if (cookies.some((c) => c.name === MIGRATED_COOKIE)) return { done: true, copy: [], clear: [] };
  const seen = new Set<string>();
  const copy: CookiePair[] = [];
  for (const c of cookies) {
    if (!isAuthCookie(c.name, storageKey) || seen.has(c.name)) continue;
    seen.add(c.name);
    copy.push(c);
  }
  return { done: false, copy, clear: copy.map((c) => c.name) };
}

/** Set-Cookie ที่ลบคุกกี้ชื่อนี้ที่ path "/" (ตัวที่ path /sis ไม่ถูกแตะ) */
export function clearRootCookieHeader(name: string): string {
  return `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
}
