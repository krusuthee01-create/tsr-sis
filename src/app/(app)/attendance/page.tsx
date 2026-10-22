import { can, getProfile, getSettings, supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { EmptyState, LinkButton } from "@/components/ui";
import { AttendanceSheet, type ClassOption } from "./attendance-sheet";
import { todayISO } from "@/lib/thai-date";
import { gradeSort } from "@/lib/domain";
import type { RecordKind } from "@/lib/domain";

export const metadata = { title: "เช็กชื่อ ดื่มนม แปรงฟัน" };

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ c?: string; k?: string; d?: string }> }) {
  const sp = await searchParams;
  const [profile, settings] = await Promise.all([getProfile(), getSettings()]);
  const isAdmin = can(profile, "admin");

  let options: ClassOption[] = (profile?.homerooms ?? []).map((h) => ({ id: h.classroom_id, grade: h.grade, room: h.room }));
  if (isAdmin && settings?.current_year) {
    const sb = await supabaseServer();
    const { data } = await sb.from("classrooms").select("id, grade, room").eq("year", settings.current_year);
    options = ((data ?? []) as ClassOption[]).sort((a, b) => gradeSort(a.grade) - gradeSort(b.grade) || a.room - b.room);
  }

  const kind: RecordKind = sp.k === "milk" || sp.k === "brush" ? sp.k : "line";
  const initialClass = options.find((o) => String(o.id) === sp.c)?.id ?? options[0]?.id;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="เช็กชื่อ ดื่มนม แปรงฟัน" module="attendance" help="attendance"
        subtitle="ทุกคนถูกตั้งเป็น &quot;มา&quot; ไว้แล้ว แตะเฉพาะคนที่ไม่ใช่" />
      {initialClass ? (
        <AttendanceSheet options={options} initialClass={initialClass} initialKind={kind}
          initialDate={sp.d && /^\d{4}-\d{2}-\d{2}$/.test(sp.d) ? sp.d : todayISO()}
          editWindow={isAdmin ? 3650 : settings?.edit_window_days ?? 7} />
      ) : (
        <EmptyState title="ท่านยังไม่ได้เป็นครูที่ปรึกษาของห้องใด"
          action={<LinkButton href="/attendance/subject">ไปเช็กชื่อประจำวิชา</LinkButton>}>
          หน้านี้สำหรับครูที่ปรึกษาและครูพี่เลี้ยง แจ้งผู้ดูแลระบบให้กำหนดห้องของท่าน
        </EmptyState>
      )}
    </div>
  );
}
