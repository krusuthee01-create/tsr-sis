import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getProfile } from "@/lib/supabase/server";
import { relativeRedirect } from "@/lib/relative-redirect";
import { buildConsentUrl } from "@/lib/saraban/drive";
import { canManageDrive, DRIVE_COOKIE_PATH, DRIVE_STATE_COOKIE, driveRedirectUri } from "@/lib/saraban/drive-connect";

/** เริ่มเชื่อมต่อ Google Drive: ตรวจสิทธิ์ ตั้ง state (กัน CSRF) แล้วพาไปหน้ายินยอมของ Google */
export async function GET() {
  if (!canManageDrive(await getProfile())) return relativeRedirect("/saraban/settings?drive=denied", 303);
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const redirectUri = await driveRedirectUri();
  if (!clientId || !process.env.GOOGLE_OAUTH_CLIENT_SECRET || !redirectUri) {
    return relativeRedirect("/saraban/settings?drive=noclient", 303);
  }
  const state = randomUUID();
  const res = NextResponse.redirect(buildConsentUrl({ clientId, redirectUri, state }), 303);
  res.cookies.set(DRIVE_STATE_COOKIE, state, { httpOnly: true, secure: true, sameSite: "lax", path: DRIVE_COOKIE_PATH, maxAge: 600 });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
