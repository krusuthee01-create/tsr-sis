// Web Push รายบุคคล (ฝั่งเซิร์ฟเวอร์เท่านั้น)
import webpush from "web-push";
import { supabaseAdmin } from "../supabase/server";

export type PushPayload = { title: string; body: string; url: string };

/** ส่ง push ให้ครูตาม staff_id ทุกอุปกรณ์ที่สมัครไว้ และลบ subscription ที่หมดอายุ (404/410) */
export async function pushToStaff(staffIds: string[], payload: PushPayload): Promise<void> {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv || staffIds.length === 0) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@anubantep.ac.th", pub, priv);

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("push_subscriptions")
    .select("endpoint,p256dh,auth")
    .in("staff_id", staffIds);
  if (error) throw new Error(`อ่าน push_subscriptions ไม่ได้: ${error.message}`);
  const body = JSON.stringify(payload);
  const dead: string[] = [];
  await Promise.all(
    (data ?? []).map(async (s: { endpoint: string; p256dh: string; auth: string }) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body);
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) dead.push(s.endpoint);
      }
    }),
  );
  if (dead.length > 0) await sb.from("push_subscriptions").delete().in("endpoint", dead);
}
