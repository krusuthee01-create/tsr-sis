import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { can, getProfile, getSettings, supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { Card, LinkTabs, SectionTitle } from "@/components/ui";
import { formatThaiDate, todayISO } from "@/lib/thai-date";
import { SchoolForm, YearsEditor, TermsEditor, HolidaysEditor, PeriodsEditor, SubjectsEditor } from "./settings-forms";

export const metadata = { title: "ตั้งค่าระบบ" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ s?: string; y?: string }> }) {
  const sp = await searchParams;
  const [profile, settings] = await Promise.all([getProfile(), getSettings()]);
  if (!can(profile, "admin")) redirect("/");
  const tab = ["school", "calendar", "periods", "subjects"].includes(sp.s ?? "") ? sp.s! : "overview";
  const year = Number(sp.y) || settings?.current_year || 0;

  const tabs = [
    { id: "overview", label: "ภาพรวม", href: "/settings" },
    { id: "school", label: "ข้อมูลโรงเรียน", href: "/settings?s=school" },
    { id: "calendar", label: "ปีการศึกษา / ปฏิทิน", href: "/settings?s=calendar" },
    { id: "periods", label: "คาบเรียน", href: "/settings?s=periods" },
    { id: "subjects", label: "รายวิชา", href: "/settings?s=subjects" },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="ตั้งค่าระบบ" module="system" help="settings" />
      <div className="mb-3"><LinkTabs tabs={tabs} current={tab} /></div>
      {tab === "overview" && <Overview />}
      {tab === "school" && settings && <Card><SchoolForm initial={settings} /></Card>}
      {tab === "calendar" && <Calendar year={year} currentYear={settings?.current_year ?? null} />}
      {tab === "periods" && <Periods />}
      {tab === "subjects" && <Subjects />}
    </div>
  );
}

async function Overview() {
  const sb = await supabaseServer();
  const settings = await getSettings();
  const year = settings?.current_year ?? 0;
  const today = todayISO();
  const [terms, holidays, classrooms, homerooms, pending, subjects, students, noAccount] = await Promise.all([
    sb.from("terms").select("term, start_date, end_date").eq("year", year).order("term"),
    sb.from("holidays").select("date", { count: "exact", head: true }).gte("date", `${Number(year) - 543}-05-01`),
    sb.from("classrooms").select("id").eq("year", year),
    sb.from("homeroom_assignments").select("classroom_id, classrooms!inner(year)").eq("kind", "homeroom").eq("classrooms.year", year),
    sb.from("staff").select("id", { count: "exact", head: true }).eq("approved", false).eq("active", true),
    sb.from("subjects").select("id", { count: "exact", head: true }),
    sb.from("enrollments").select("student_id", { count: "exact", head: true }).eq("year", year),
    sb.from("staff").select("id", { count: "exact", head: true }).is("user_id", null).eq("active", true),
  ]);
  const roomIds = new Set((classrooms.data ?? []).map((c) => c.id));
  const withHomeroom = new Set((homerooms.data ?? []).map((h) => h.classroom_id));
  const missingHomeroom = [...roomIds].filter((id) => !withHomeroom.has(id)).length;
  const inTerm = (terms.data ?? []).some((t) => today >= t.start_date && today <= t.end_date);

  const items: { ok: boolean; title: string; detail: string; href: string; optional?: boolean }[] = [
    { ok: !!year, title: "ปีการศึกษาปัจจุบัน", detail: year ? `ปีการศึกษา ${year}` : "ยังไม่ได้ตั้ง", href: "/settings?s=calendar" },
    { ok: (terms.data ?? []).length === 2, title: "วันเปิด-ปิดภาคเรียน", detail: (terms.data ?? []).map((t) => `ภาค ${t.term}: ${formatThaiDate(t.start_date)} – ${formatThaiDate(t.end_date)}`).join(" · ") || "ยังไม่ได้ตั้ง (ครูเช็กชื่อไม่ได้)", href: "/settings?s=calendar" },
    { ok: (holidays.count ?? 0) > 0, title: "วันหยุดของโรงเรียน", detail: `${holidays.count ?? 0} วัน`, href: "/settings?s=calendar" },
    { ok: (students.count ?? 0) > 0, title: "นักเรียนจาก DMC", detail: `${students.count ?? 0} คน ใน ${roomIds.size} ห้อง`, href: "/students/import" },
    { ok: roomIds.size > 0 && missingHomeroom === 0, title: "ครูที่ปรึกษาครบทุกห้อง", detail: missingHomeroom ? `ยังไม่มีครูที่ปรึกษา ${missingHomeroom} ห้อง` : "ครบแล้ว", href: "/classrooms" },
    { ok: (pending.count ?? 0) === 0, title: "บัญชีรออนุมัติ", detail: `${pending.count ?? 0} คน`, href: "/staff" },
    { ok: (subjects.count ?? 0) > 0, title: "รายวิชา (สำหรับเช็กชื่อประจำวิชา)", detail: `${subjects.count ?? 0} วิชา`, href: "/settings?s=subjects", optional: true },
    { ok: (noAccount.count ?? 0) === 0, title: "ครูที่ยังไม่มีบัญชีเข้าระบบ", detail: `${noAccount.count ?? 0} คน (ใส่อีเมล Google หรือสร้างชื่อผู้ใช้)`, href: "/staff", optional: true },
  ];

  return (
    <div className="flex flex-col gap-3">
      {!inTerm && year > 0 && <p className="rounded-2xl bg-amber-100 px-4 py-3 font-semibold text-amber-950">วันนี้ ({formatThaiDate(today)}) ไม่อยู่ในภาคเรียนใด ครูจะเช็กชื่อไม่ได้จนกว่าจะตั้งวันเปิดภาคเรียน</p>}
      <Card className="p-2 md:p-2">
        <ul className="divide-y divide-slate-100">
          {items.map((i) => (
            <li key={i.title}>
              <Link href={i.href} className="flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-slate-50">
                {i.ok ? <CheckCircle size={28} weight="fill" className="shrink-0 text-green-600" /> : <WarningCircle size={28} weight="fill" className={`shrink-0 ${i.optional ? "text-slate-400" : "text-amber-500"}`} />}
                <span className="flex-1"><span className="block font-semibold">{i.title}{i.optional && <span className="font-normal text-muted"> (ถ้ามี)</span>}</span><span className="text-sm text-muted">{i.detail}</span></span>
                <span className="text-sm font-semibold text-navy-700">{i.ok ? "ดู" : "ตั้งค่า"} ›</span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <SectionTitle>สำรองข้อมูลและความปลอดภัย</SectionTitle>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-[0.9375rem] text-muted">
          <li>ระบบสำรองฐานข้อมูลอัตโนมัติทุกสัปดาห์ผ่าน GitHub Actions (ไฟล์เข้ารหัส) ดูวิธีตั้งค่าในเอกสาร docs/SETUP.md</li>
          <li>ทุกการแก้ไขข้อมูลถูกบันทึกในหน้า &ldquo;ประวัติการแก้ไข&rdquo;</li>
        </ul>
      </Card>
    </div>
  );
}

async function Calendar({ year, currentYear }: { year: number; currentYear: number | null }) {
  const sb = await supabaseServer();
  const [{ data: years }, { data: terms }, { data: holidays }] = await Promise.all([
    sb.from("academic_years").select("year").order("year", { ascending: false }),
    sb.from("terms").select("id, term, start_date, end_date").eq("year", year).order("term"),
    sb.from("holidays").select("date, name").gte("date", `${year - 543}-04-01`).lte("date", `${year - 542}-04-30`).order("date"),
  ]);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><SectionTitle>ปีการศึกษา</SectionTitle><YearsEditor years={(years ?? []).map((y) => y.year)} current={currentYear} selected={year} /></Card>
      <Card><SectionTitle>ภาคเรียน ปี {year || "-"}</SectionTitle>{year ? <TermsEditor year={year} terms={terms ?? []} /> : <p className="text-muted">เพิ่มปีการศึกษาก่อน</p>}</Card>
      <Card className="lg:col-span-2"><SectionTitle>วันหยุดของโรงเรียน ปีการศึกษา {year || "-"}</SectionTitle><HolidaysEditor holidays={holidays ?? []} /></Card>
    </div>
  );
}

async function Periods() {
  const sb = await supabaseServer();
  const { data } = await sb.from("periods").select("no, start_time, end_time").order("no");
  return <Card><SectionTitle>คาบเรียน</SectionTitle><PeriodsEditor periods={(data ?? []).map((p) => ({ ...p, start_time: p.start_time.slice(0, 5), end_time: p.end_time.slice(0, 5) }))} /></Card>;
}

async function Subjects() {
  const sb = await supabaseServer();
  const { data } = await sb.from("subjects").select("id, code, name, grade, hours_per_year, learning_area").order("code");
  return <Card><SectionTitle>รายวิชา</SectionTitle><SubjectsEditor subjects={data ?? []} /></Card>;
}
