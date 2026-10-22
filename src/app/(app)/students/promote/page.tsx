import { redirect } from "next/navigation";
import { can, getProfile, getSettings, supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/ui";
import { PromoteWizard, type PromoteStudent } from "./promote-wizard";

export const metadata = { title: "เลื่อนชั้นสิ้นปี" };

export default async function PromotePage() {
  const [profile, settings] = await Promise.all([getProfile(), getSettings()]);
  if (!can(profile, "admin")) redirect("/students");
  const from = settings?.current_year;
  if (!from) {
    return <div className="mx-auto max-w-4xl"><PageHeader title="เลื่อนชั้นสิ้นปีการศึกษา" module="registry" help="promote" back="/students" />
      <EmptyState title="ยังไม่ได้ตั้งปีการศึกษาปัจจุบัน">ตั้งค่าได้ที่หน้า ตั้งค่าระบบ</EmptyState></div>;
  }
  const sb = await supabaseServer();
  const [{ data }, { count: nextCount }] = await Promise.all([
    sb.from("enrollments").select("student_id, number, classrooms!inner(grade, room, year), students!inner(prefix, first_name, last_name, status)")
      .eq("year", from).eq("students.status", "studying"),
    sb.from("enrollments").select("student_id", { count: "exact", head: true }).eq("year", from + 1),
  ]);
  const students: PromoteStudent[] = ((data ?? []) as unknown as { student_id: string; number: number | null; classrooms: { grade: string; room: number }; students: { prefix: string | null; first_name: string; last_name: string } }[])
    .map((r) => ({ id: r.student_id, number: r.number, grade: r.classrooms.grade, room: r.classrooms.room, ...r.students }));
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="เลื่อนชั้นสิ้นปีการศึกษา" module="registry" help="promote" back="/students" subtitle={`จากปีการศึกษา ${from} ไป ${from + 1}`} />
      <PromoteWizard from={from} students={students} alreadyPromoted={nextCount ?? 0} />
    </div>
  );
}
