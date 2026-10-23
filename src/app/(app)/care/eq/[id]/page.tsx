import { notFound } from "next/navigation";
import { getSettings, supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { classroomName, fullName } from "@/lib/domain";
import { careStudent } from "../../student-header";
import { EqForm } from "./eq-form";

export const metadata = { title: "แบบประเมิน EQ" };

export default async function EqPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ term?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const s = await careStudent(id);
  if (!s || !s.enrollment) notFound();
  const term = sp.term === "2" ? 2 : 1;
  const sb = await supabaseServer();
  const settings = await getSettings();
  const { data: existing } = await sb.from("eq_results").select("version, good, smart, happy")
    .eq("student_id", id).eq("year", s.year).eq("term", term).maybeSingle();
  // ฉบับ 3–5 ปีสำหรับอนุบาล ฉบับ 6–11 ปีสำหรับประถม (ครูเปลี่ยนได้)
  const grade = s.enrollment.classrooms.grade;
  const defaultVersion = grade.startsWith("อ") ? "3-5" : "6-11";
  const back = `/care?tab=assess&c=${s.enrollment.classroom_id}&t=${term}`;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="แบบประเมิน EQ" module="care" help="sdq" back={back}
        subtitle={`${fullName(s)} · ${classroomName(s.enrollment.classrooms)} · ภาคเรียนที่ ${term}/${s.year}`} />
      <EqForm studentId={id} term={term} backHref={back} ranges={settings?.eq_ranges ?? {}}
        initial={existing ? { version: existing.version as string, good: existing.good as number | null, smart: existing.smart as number | null, happy: existing.happy as number | null } : { version: defaultVersion, good: null, smart: null, happy: null }} />
    </div>
  );
}
