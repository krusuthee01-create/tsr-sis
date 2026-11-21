// Vercel Cron: แจ้งเตือนหนังสือใกล้ครบกำหนด (07:00 น. เวลาไทย) — รวมต่อคน 1 ข้อความ
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { pushToStaff } from "@/lib/saraban/push";
import { formatReminderBody } from "@/lib/saraban/push-text";

export const dynamic = "force-dynamic";

type Due = { staff_id: string; book_id: string; subject: string; due_date: string; secret: boolean };

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { data, error } = await supabaseAdmin().rpc("saraban_due_reminders");
  if (error) {
    console.error("saraban_due_reminders", error);
    return NextResponse.json({ error: "อ่านรายการแจ้งเตือนไม่สำเร็จ" }, { status: 500 });
  }

  const byStaff = new Map<string, Due[]>();
  for (const r of (data ?? []) as Due[]) byStaff.set(r.staff_id, [...(byStaff.get(r.staff_id) ?? []), r]);

  await Promise.all(
    [...byStaff].map(([staffId, items]) =>
      pushToStaff([staffId], {
        title: "หนังสือใกล้ครบกำหนด",
        body: formatReminderBody(items),
        url: "/sis/saraban?f=todo",
      }),
    ),
  );
  return NextResponse.json({ staff: byStaff.size });
}
