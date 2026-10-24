import Link from "next/link";
import { can, getProfile, getSettings, supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/ui";
import { classroomName, gradeSort } from "@/lib/domain";
import { NumberEditor, type NumRow } from "./number-editor";

export const metadata = { title: "จัดเลขที่นักเรียน" };

export default async function NumbersPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const sp = await searchParams;
  const [profile, settings] = await Promise.all([getProfile(), getSettings()]);
  const year = settings?.current_year ?? 0;
  const sb = await supabaseServer();
  const admin = can(profile, "admin");
  const own = (profile?.homerooms ?? []).filter((h) => h.kind === "homeroom" && h.year === year).map((h) => h.classroom_id);
  const { data } = await sb.from("classrooms").select("id, grade, room").eq("year", year);
  const rooms = ((data ?? []) as { id: number; grade: string; room: number }[])
    .filter((c) => admin || own.includes(c.id))
    .sort((a, b) => gradeSort(a.grade) - gradeSort(b.grade) || a.room - b.room);
  const header = (sub?: string) => <PageHeader title="จัดเลขที่นักเรียน" module="registry" help="students" back="/students" subtitle={sub ?? `ปีการศึกษา ${year}`} />;
  if (!rooms.length) {
    return <div className="mx-auto max-w-3xl">{header()}<EmptyState title="หน้านี้สำหรับครูที่ปรึกษา">ครูที่ปรึกษากำหนดเลขที่ได้เฉพาะห้องของตนเองในปีการศึกษาปัจจุบัน ถ้าท่านเป็นครูที่ปรึกษา แจ้งผู้ดูแลระบบให้กำหนดห้องที่หน้า &ldquo;ห้องเรียน&rdquo;</EmptyState></div>;
  }
  const room = rooms.find((c) => String(c.id) === sp.c) ?? rooms.find((c) => own.includes(c.id)) ?? rooms[0];
  const { data: roster } = await sb.rpc("roster", { p_classroom: room.id, p_only_active: false });
  return (
    <div className="mx-auto max-w-3xl">
      {header(`${classroomName(room)} · ปีการศึกษา ${year}`)}
      {rooms.length > 1 && (
        <nav className="no-print -mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="เลือกห้อง">
          {rooms.map((c) => (
            <Link key={c.id} href={`/students/numbers?c=${c.id}`} aria-current={c.id === room.id ? "page" : undefined}
              className={`shrink-0 rounded-xl px-3.5 py-2 text-sm font-bold ${c.id === room.id ? "bg-sky-600 text-white" : "border-[1.5px] border-slate-300 bg-white text-slate-700"}`}>{classroomName(c)}</Link>
          ))}
        </nav>
      )}
      <NumberEditor key={room.id} classroomId={room.id} roster={(roster ?? []) as NumRow[]} />
    </div>
  );
}
