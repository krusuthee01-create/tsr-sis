import Link from "next/link";
import { redirect } from "next/navigation";
import { can, getProfile, getSettings, supabaseServer } from "@/lib/supabase/server";
import { PageHeader, PrintHeader } from "@/components/page-header";
import { Card, SectionTitle } from "@/components/ui";
import { ExportButton, PrintButton } from "@/components/export-button";
import { NationalTests, TargetsEditor, type Metric, type NationalRow } from "./sar-forms";

export const metadata = { title: "ข้อมูลสำหรับ SAR" };

export default async function SarPage({ searchParams }: { searchParams: Promise<{ y?: string }> }) {
  const sp = await searchParams;
  const [profile, settings] = await Promise.all([getProfile(), getSettings()]);
  if (!can(profile, "admin", "executive", "academic")) redirect("/");
  const editable = can(profile, "admin", "academic");
  const sb = await supabaseServer();
  const { data: years } = await sb.from("academic_years").select("year").order("year", { ascending: false });
  const year = Number(sp.y) || settings?.current_year || 0;
  const [{ data: m, error }, { data: prevM }, { data: tests }] = await Promise.all([
    sb.rpc("sar_summary", { p_year: year }),
    sb.rpc("sar_summary", { p_year: year - 1 }),
    sb.from("national_tests").select("id, year, test, subject, school_avg, province_avg, national_avg, students").in("year", [year, year - 1]).order("test").order("subject"),
  ]);
  const metrics = (m ?? []) as Metric[];
  const prev = new Map(((prevM ?? []) as Metric[]).map((x) => [x.key, x.value]));
  const sections = [...new Set(metrics.map((x) => x.section))];
  const nat = (tests ?? []) as NationalRow[];
  const title = `ข้อมูลสำหรับรายงานการประเมินตนเอง (SAR) ปีการศึกษา ${year}`;
  const excel = [
    ["ด้าน", "ตัวชี้วัด", `ปี ${year}`, "หน่วย", "จำนวนฐาน", "ค่าเป้าหมาย", "ผลเทียบเป้าหมาย", `ปี ${year - 1}`],
    ...metrics.map((x) => [x.section, x.label, x.value, x.unit, x.base, x.target, x.value === null || x.target === null ? "" : Number(x.value) >= Number(x.target) ? "บรรลุ" : "ไม่บรรลุ", prev.get(x.key) ?? null]),
  ];
  const natExcel = [["ปี", "การทดสอบ", "วิชา/ด้าน", "ค่าเฉลี่ยโรงเรียน", "จังหวัด", "ประเทศ", "จำนวนผู้เข้าสอบ"],
    ...nat.map((n) => [n.year, n.test, n.subject, n.school_avg, n.province_avg, n.national_avg, n.students])];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="ข้อมูลสำหรับ SAR" module="sar" help="sar" subtitle={`ปีการศึกษา ${year} · ตัวเลขคำนวณอัตโนมัติจากทุกระบบ`} />
      <PrintHeader title={title} school={settings?.school_name ?? ""} />
      <div className="no-print mb-3 flex flex-wrap items-center gap-2">
        {(years ?? []).slice(0, 5).map((y) => (
          <Link key={y.year} href={`/sar?y=${y.year}`} className={`rounded-full px-3.5 py-1.5 text-sm font-bold ${y.year === year ? "bg-violet-700 text-white" : "bg-white ring-1 ring-slate-300"}`}>{y.year}</Link>
        ))}
        <span className="flex-1" />
        <ExportButton filename={`${title}.xlsx`} sheets={[{ name: "ตัวชี้วัด", rows: excel, widths: [22, 60, 10, 8, 10, 12, 14, 10] }, { name: "ผลสอบระดับชาติ", rows: natExcel }]} />
        <PrintButton />
      </div>
      {error && <Card className="mb-3 bg-red-50 text-red-900">{error.message}</Card>}
      <p className="no-print mb-3 rounded-2xl bg-violet-50 px-4 py-3 text-sm text-violet-950">
        ผลการเรียนใช้ผลทั้งปี (ถ้ายังไม่มีใช้ภาคเรียนล่าสุด) · โภชนาการใช้การชั่งครั้งล่าสุดของปี · {editable ? "แตะช่องค่าเป้าหมายเพื่อแก้ไข แล้วกดบันทึก" : "ค่าเป้าหมายตั้งโดยงานวิชาการ"}
      </p>
      <TargetsEditor year={year} sections={sections} metrics={metrics} prev={Object.fromEntries(prev)} editable={editable} />
      <Card className="mt-3">
        <SectionTitle>ผลการทดสอบระดับชาติ (RT ป.1 · NT ป.3 · O-NET ป.6)</SectionTitle>
        <NationalTests year={year} rows={nat} editable={editable} />
      </Card>
    </div>
  );
}
