// Vercel Cron: แจ้งเตือนหนังสือใกล้ครบกำหนด (07:00 น. เวลาไทย) — รวมต่อคน 1 ข้อความ
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { pushToStaff } from "@/lib/saraban/push";

export const dynamic = "force-dynamic";

type Due = { staff_id: string; book_id: string; subject: string; due_date: string };

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { data, error } = await supabaseAdmin().rpc("saraban_due_reminders");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byStaff = new Map<string, Due[]>();
  for (const r of (data ?? []) as Due[]) byStaff.set(r.staff_id, [...(byStaff.get(r.staff_id) ?? []), r]);

  await Promise.all(
    [...byStaff].map(([staffId, items]) =>
      pushToStaff([staffId], {
        title: "หนังสือใกล้ครบกำหนด",
        body: `${items.length} เรื่องรอดำเนินการ: ${items[0].subject}…`,
        url: "/sis/saraban?f=todo",
      }),
    ),
  );
  return NextResponse.json({ staff: byStaff.size });
}
