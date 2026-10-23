import { notFound } from "next/navigation";
import { getProfile, supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { classroomName, fullName } from "@/lib/domain";
import { todayISO } from "@/lib/thai-date";
import type { VisitData } from "@/lib/care";
import { careStudent } from "../../student-header";
import { VisitForm, type Visit } from "./visit-form";

export const metadata = { title: "บันทึกการเยี่ยมบ้าน" };

export default async function VisitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await careStudent(id);
  if (!s || !s.enrollment) notFound();
  const sb = await supabaseServer();
  const profile = await getProfile();
  const { data: existing } = await sb.from("home_visits")
    .select("id, visit_date, data, household_size, monthly_income, latitude, longitude, photos")
    .eq("student_id", id).eq("year", s.year).order("visit_date", { ascending: false }).limit(1).maybeSingle();

  // รูปเดิม: ขอลิงก์ชั่วคราวจาก Storage (bucket ส่วนตัว)
  const photos: { path: string; url: string }[] = [];
  for (const path of (existing?.photos as string[] | undefined) ?? []) {
    const { data } = await sb.storage.from("home-visits").createSignedUrl(path, 3600);
    if (data?.signedUrl) photos.push({ path, url: data.signedUrl });
  }

  // ครั้งแรก: เติมข้อมูลจาก DMC ให้ ครูแก้ได้
  const prefill: VisitData = {
    guardian_name: s.guardian_name ? `${s.guardian_name}${s.guardian_relation ? ` (${s.guardian_relation})` : ""}` : "",
    guardian_phone: s.guardian_phone ?? s.mother_phone ?? s.father_phone ?? "",
    address: s.address_current ?? "",
  };
  const visit: Visit = existing
    ? { id: existing.id as string, visit_date: existing.visit_date as string, data: { ...prefill, ...(existing.data as VisitData) }, household_size: existing.household_size as number | null,
        monthly_income: existing.monthly_income as number | null, latitude: existing.latitude as number | null, longitude: existing.longitude as number | null, photos }
    : { id: null, visit_date: todayISO(), data: prefill, household_size: null, monthly_income: null, latitude: null, longitude: null, photos: [] };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="บันทึกการเยี่ยมบ้าน" module="care" help="visit" back={`/care?tab=visits&c=${s.enrollment.classroom_id}`}
        subtitle={`${fullName(s)} · ${classroomName(s.enrollment.classrooms)} · ปีการศึกษา ${s.year}`} />
      <VisitForm studentId={id} classroomId={s.enrollment.classroom_id} year={s.year} visitorId={profile?.id ?? null} initial={visit}
        backHref={`/care?tab=visits&c=${s.enrollment.classroom_id}`} />
    </div>
  );
}
