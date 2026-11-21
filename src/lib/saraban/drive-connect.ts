// เชื่อมต่อ Google Drive ด้วยบัญชีของโรงเรียน (ฝั่งเซิร์ฟเวอร์): ใครทำได้ และที่อยู่ callback
import { headers } from "next/headers";
import type { Profile } from "@/lib/supabase/server";
import { withBase } from "@/lib/base-path";
import { siteOrigin } from "@/lib/saraban/book";

export const DRIVE_STATE_COOKIE = "saraban_drive_state";
export const DRIVE_COOKIE_PATH = withBase("/saraban/api/drive");

/** ผู้ดูแลระบบ SIS หรือผู้อำนวยการในระบบสารบรรณ */
export function canManageDrive(profile: Profile | null): boolean {
  return !!profile && profile.approved && profile.active && (profile.roles.includes("admin") || profile.saraban_role === "director");
}

/**
 * ที่อยู่ callback ต้องตรงกับที่ลงทะเบียนใน Google Cloud ทุกตัวอักษร
 * ใช้ NEXT_PUBLIC_SITE_URL ก่อน (หลัง Caddy Host ที่ Vercel เห็นไม่ใช่ที่อยู่ที่ครูเปิด)
 */
export async function driveRedirectUri(): Promise<string | null> {
  const h = await headers();
  const origin = siteOrigin(
    { origin: h.get("origin"), forwardedHost: h.get("x-forwarded-host"), forwardedProto: h.get("x-forwarded-proto") },
    process.env.NEXT_PUBLIC_SITE_URL,
  );
  return origin ? origin + withBase("/saraban/api/drive/callback") : null;
}
