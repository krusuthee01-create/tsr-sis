import { notFound } from "next/navigation";
import { getSettings, supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { classroomName, fullName } from "@/lib/domain";
import { INFORMANTS } from "@/lib/care";
import { careStudent } from "../../student-header";
import { SdqForm } from "./sdq-form";

export const metadata = { title: "แบบประเมิน SDQ" };

export default async function SdqPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ informant?: string; term?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const s = await careStudent(id);
  if (!s || !s.enrollment) notFound();
  const informant = sp.informant && sp.informant in INFORMANTS ? sp.informant : "teacher";
  const term = sp.term === "2" ? 2 : 1;
  const sb = await supabaseServer();
  const settings = await getSettings();
  const { data: existing } = await sb.from("sdq_results").select("answers, recorded_at")
    .eq("student_id", id).eq("year", s.year).eq("term", term).eq("informant", informant).maybeSingle();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={`SDQ ${INFORMANTS[informant]}`} module="care" help="sdq" back={`/care?tab=assess&c=${s.enrollment.classroom_id}&t=${term}`}
        subtitle={`${fullName(s)} · ${classroomName(s.enrollment.classrooms)} · ภาคเรียนที่ ${term}/${s.year}`} />
      <SdqForm studentId={id} term={term} informant={informant} initial={(existing?.answers as number[] | undefined) ?? null}
        cutoffs={settings?.sdq_cutoffs?.[informant]} backHref={`/care?tab=assess&c=${s.enrollment.classroom_id}&t=${term}`} />
    </div>
  );
}
