import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getProfile, supabaseAdmin } from "@/lib/supabase/server";
import { relativeRedirect } from "@/lib/relative-redirect";
import { clearDriveSetupCache, ensureFolder, exchangeAuthCode } from "@/lib/saraban/drive";
import { canManageDrive, DRIVE_COOKIE_PATH, DRIVE_STATE_COOKIE, driveRedirectUri } from "@/lib/saraban/drive-connect";

const done = (result: string) => {
  const res = relativeRedirect(`/saraban/settings?drive=${result}`, 303);
  res.cookies.set(DRIVE_STATE_COOKIE, "", { path: DRIVE_COOKIE_PATH, maxAge: 0 });
  return res;
};

function sameState(a: string | undefined, b: string | null): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Google ส่งกลับมาหลังผู้ดูแลกดยินยอม: ตรวจ state และสิทธิ์ แลก code เป็น refresh token
 * สร้าง/ใช้โฟลเดอร์ในไดรฟ์ของบัญชีนั้น แล้วบันทึกลง saraban_drive_config (service role)
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const store = await cookies();
  if (!sameState(store.get(DRIVE_STATE_COOKIE)?.value, url.searchParams.get("state"))) return done("state");
  const profile = await getProfile();
  if (!canManageDrive(profile)) return done("denied");
  if (url.searchParams.get("error")) return done("cancelled");
  const code = url.searchParams.get("code");
  const redirectUri = await driveRedirectUri();
  if (!code || !redirectUri) return done("failed");

  try {
    const token = await exchangeAuthCode(code, redirectUri);
    if (!token.refreshToken) return done("norefresh");

    const admin = supabaseAdmin();
    const { data: existing } = await admin.from("saraban_drive_config").select("account_email, folder_id").eq("id", 1).maybeSingle();
    const sameAccount = !existing || (existing.account_email ?? "").toLowerCase() === (token.email ?? "").toLowerCase();
    if (!sameAccount) {
      // ไฟล์เดิมเป็นของบัญชีเดิม (สิทธิ์ drive.file) — เปลี่ยนบัญชีแล้วจะเปิดไฟล์เก่าไม่ได้
      const { count } = await admin.from("saraban_files").select("id", { count: "exact", head: true });
      if ((count ?? 0) > 0) return done("otheraccount");
    }
    const folderId = await ensureFolder(token.accessToken, sameAccount ? existing?.folder_id : null);
    const { error } = await admin.from("saraban_drive_config").upsert({
      id: 1,
      account_email: token.email,
      refresh_token: token.refreshToken,
      folder_id: folderId,
      connected_by: profile!.id,
      connected_at: new Date().toISOString(),
    });
    if (error) {
      console.error("saraban_drive_config", error);
      return done("failed");
    }
    clearDriveSetupCache();
    return done("ok");
  } catch (e) {
    console.error("saraban drive callback", e);
    return done("failed");
  }
}
