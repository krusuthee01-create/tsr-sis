"use server";
// แยกไฟล์จาก actions.ts: เรียกจากปุ่มออกจากระบบ (โหลดแบบ dynamic import) โดยไม่ดึง action อื่นมาด้วย
import { supabaseServer } from "@/lib/supabase/server";

/** ลบ Web Push subscription ของอุปกรณ์นี้ (ตอนออกจากระบบ) — RLS ให้ลบได้เฉพาะแถวของตัวเอง; ไม่ throw */
export async function removePushSubscription(endpoint: unknown): Promise<void> {
  if (typeof endpoint !== "string" || !/^https:\/\/\S{10,2000}$/.test(endpoint)) return;
  try {
    const sb = await supabaseServer();
    const { error } = await sb.from("push_subscriptions").delete().eq("endpoint", endpoint);
    if (error) console.error("push_subscriptions delete", error);
  } catch (e) {
    console.error("push_subscriptions delete", e);
  }
}
