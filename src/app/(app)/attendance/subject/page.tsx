import { can, getProfile, getSettings, supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/ui";
import { classroomName, gradeSort, isKindergarten } from "@/lib/domain";
import { todayISO } from "@/lib/thai-date";
import { SubjectSheet, type SubjectOption } from "./subject-sheet";

export const metadata = { title: "เช็กชื่อประจำวิชา" };

export default async function SubjectAttendancePage() {
  const sb = await supabaseServer();
  const [profile, settings] = await Promise.all([getProfile(), getSettings()]);
  const today = todayISO();
  const year = settings?.current_year;

  const [{ data: terms }, { data: periods }] = await Promise.all([
    sb.from("terms").select("id, year, term, start_date, end_date").eq("year", year ?? 0).order("term"),
    sb.from("periods").select("no, start_time, end_time").order("no"),
  ]);
  const term = (terms ?? []).find((t) => today >= t.start_date && today <= t.end_date) ?? (terms ?? []).at(-1);

  let options: SubjectOption[] = [];
  if (term) {
    const { data: mine } = await sb.from("teaching_assignments")
      .select("classroom_id, subject_id, classrooms(grade, room), subjects(code, name)")
      .eq("term_id", term.id).eq("staff_id", profile?.id ?? "");
    options = ((mine ?? []) as unknown as { classroom_id: number; subject_id: number; classrooms: { grade: string; room: number }; subjects: { code: string; name: string } }[])
      .map((m) => ({ classroom_id: m.classroom_id, subject_id: m.subject_id, grade: m.classrooms.grade, room: m.classrooms.room, subject: `${m.subjects.code} ${m.subjects.name}` }));

    // ผู้ดูแลระบบและครูที่ปรึกษาเช็กได้ทุกวิชาของห้องตัวเอง
    const roomIds = can(profile, "admin") ? null : (profile?.homerooms ?? []).map((h) => h.classroom_id);
    if (roomIds === null || roomIds.length) {
      let q = sb.from("classrooms").select("id, grade, room").eq("year", year ?? 0);
      if (roomIds) q = q.in("id", roomIds);
      const [{ data: rooms }, { data: subjects }] = await Promise.all([q, sb.from("subjects").select("id, code, name, grade")]);
      for (const r of rooms ?? []) {
        if (isKindergarten(r.grade)) continue;
        for (const s of (subjects ?? []).filter((s) => !s.grade || s.grade === r.grade)) {
          if (!options.some((o) => o.classroom_id === r.id && o.subject_id === s.id)) {
            options.push({ classroom_id: r.id, subject_id: s.id, grade: r.grade, room: r.room, subject: `${s.code} ${s.name}` });
          }
        }
      }
    }
  }
  options.sort((a, b) => gradeSort(a.grade) - gradeSort(b.grade) || a.room - b.room || a.subject.localeCompare(b.subject, "th"));

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="เช็กชื่อประจำวิชา" module="attendance" help="attendance-subject" back="/attendance"
        subtitle={term ? `ภาคเรียนที่ ${term.term}/${term.year} · ป.1–ป.6` : "ยังไม่ได้ตั้งค่าภาคเรียน"} />
      {options.length ? (
        <SubjectSheet options={options} periods={periods ?? []} today={today} editWindow={can(profile, "admin") ? 3650 : settings?.edit_window_days ?? 7}
          labels={Object.fromEntries(options.map((o) => [`${o.classroom_id}:${o.subject_id}`, `${classroomName(o)} · ${o.subject}`]))} />
      ) : (
        <EmptyState title="ยังไม่พบวิชาที่ท่านสอนในภาคเรียนนี้">
          ผู้ดูแลระบบกำหนดวิชาที่สอนได้ที่หน้า &ldquo;ทะเบียนครู&rdquo; › ชื่อครู › &ldquo;วิชาที่สอน&rdquo; และต้องมีรายวิชาในหน้าตั้งค่าก่อน
        </EmptyState>
      )}
    </div>
  );
}
