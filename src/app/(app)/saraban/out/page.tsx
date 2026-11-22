import { getProfile, getSettings, supabaseServer } from "@/lib/supabase/server";
import { PageHeader, PrintHeader } from "@/components/page-header";
import { LinkTabs } from "@/components/ui";
import { todayISO } from "@/lib/thai-date";
import { OUT_SERIES, OUT_SERIES_LABEL, outRegistryHead, outRegistryRow, type OutRow, type OutSeries } from "@/lib/saraban/outgoing";
import { OutList, type OutItem } from "./out-list";

export const metadata = { title: "ทะเบียนหนังสือส่ง" };

const MAX_ROWS = 3000;

/** ทะเบียนหนังสือส่ง / คำสั่ง / ประกาศ: ขอเลข แนบสำเนา ยกเลิกเลข ส่งออก Excel/พิมพ์ (เห็นตาม RLS) */
export default async function OutPage({ searchParams }: { searchParams: Promise<{ s?: string; y?: string }> }) {
  const sp = await searchParams;
  const series: OutSeries = OUT_SERIES.includes(sp.s as OutSeries) ? (sp.s as OutSeries) : "out";
  const thisYear = Number(todayISO().slice(0, 4)) + 543;
  const y = Number(sp.y);
  const year = Number.isInteger(y) && y >= 2560 && y <= thisYear + 1 ? y : thisYear;

  const [profile, settings] = await Promise.all([getProfile(), getSettings()]);
  const sb = await supabaseServer();
  const [listRes, staffRes, prefixRes] = await Promise.all([
    sb.from("saraban_outgoing").select("*, saraban_out_files(id, version)")
      .eq("series", series).eq("year", year).order("seq", { ascending: false }).limit(MAX_ROWS),
    sb.rpc("saraban_staff_options"),
    sb.from("school_settings").select("saraban_prefix").eq("id", 1).maybeSingle(),
  ]);
  if (listRes.error) console.error("saraban_outgoing", listRes.error);
  const nameOf = new Map(((staffRes.data ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]));
  const school = settings?.school_name ?? "";
  const rows = (listRes.data ?? []) as (OutRow & { saraban_out_files: { id: string; version: number }[] })[];
  const items: OutItem[] = rows.map((o) => {
    const files = [...(o.saraban_out_files ?? [])].sort((a, b) => b.version - a.version);
    const requester = nameOf.get(o.requested_by) ?? "-";
    return { ...o, requester, fileId: files[0]?.id ?? null, cells: outRegistryRow(o, requester, school) };
  });
  const role = profile?.saraban_role ?? "teacher";
  const office = role === "director" || role === "clerk";
  const label = OUT_SERIES_LABEL[series];

  return (
    <div className="mx-auto max-w-6xl">
      <style>{"@media print { @page { size: A4 landscape; margin: 1cm; } }"}</style>
      <PageHeader title="ทะเบียนหนังสือส่ง / คำสั่ง / ประกาศ" module="saraban" back="/saraban"
        subtitle={`${label} ปี ${year} · ${items.length} รายการ`} />
      <PrintHeader title={`ทะเบียน${label}`} school={school} lines={[`ปี พ.ศ. ${year}`]} />
      <div className="no-print mb-3">
        <LinkTabs current={series} tabs={OUT_SERIES.map((s) => ({ id: s, label: OUT_SERIES_LABEL[s], href: `/saraban/out?s=${s}&y=${year}` }))} />
      </div>
      <OutList series={series} year={year} thisYear={thisYear} items={items} head={outRegistryHead(series)}
        me={profile?.id ?? ""} office={office} prefix={prefixRes.data?.saraban_prefix ?? "ศธ 04109.84"}
        fileName={`ทะเบียน${label} ${year}.xlsx`} error={listRes.error ? "โหลดทะเบียนไม่สำเร็จ กรุณาลองใหม่" : null} />
    </div>
  );
}
