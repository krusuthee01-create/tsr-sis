import { redirect } from "next/navigation";
import { getProfile, getSettings, supabaseServer } from "@/lib/supabase/server";
import { PageHeader, PrintHeader } from "@/components/page-header";
import { ExportButton, PrintButton } from "@/components/export-button";
import { Button, Card, EmptyState } from "@/components/ui";
import { addDays, formatThaiDate, todayISO } from "@/lib/thai-date";
import { isIsoDate } from "@/lib/saraban/register";
import { REGISTRY_HEAD, registryAction, registryRemark, type RegistryBook } from "@/lib/saraban/book";

export const metadata = { title: "ทะเบียนหนังสือรับ" };

const MAX_ROWS = 3000;
// สัดส่วนความกว้างคอลัมน์ (ตามลำดับ REGISTRY_HEAD) — เรื่องกว้างสุด
const COL_WIDTHS = ["10%", "11%", "9%", "14%", "12%", "23%", "13%", "8%"];

type Row = RegistryBook & { id: string; current_holder: string | null };

/**
 * ทะเบียนหนังสือรับตามแบบระเบียบงานสารบรรณ (ผอ./ธุรการ): เลือกช่วงวันที่ลงรับ › ส่งออก Excel หรือพิมพ์/บันทึกเป็น PDF
 * อ่านผ่าน RLS ของผู้ใช้ (ผอ./ธุรการเห็นทุกเล่มที่ไม่ถูกลบ รวมหนังสือลับ)
 */
export default async function RegistryPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const sp = await searchParams;
  const [profile, settings] = await Promise.all([getProfile(), getSettings()]);
  const role = profile?.saraban_role;
  if (role !== "director" && role !== "clerk") redirect("/saraban");

  const today = todayISO();
  const to = sp.to && isIsoDate(sp.to) ? sp.to : today;
  const from = sp.from && isIsoDate(sp.from) && sp.from <= to ? sp.from : `${to.slice(0, 8)}01`;

  const sb = await supabaseServer();
  // ช่วงวันที่ตามเวลาไทย
  const fromTs = `${from}T00:00:00+07:00`;
  const toTs = `${addDays(to, 1)}T00:00:00+07:00`;
  const [booksRes, recRes, staffRes] = await Promise.all([
    sb.from("saraban_books")
      .select("id, year, receive_no, doc_no, doc_date, from_org, to_text, subject, urgency, secret, status, doc_type, received_at, current_holder")
      .is("deleted_at", null).gte("received_at", fromTs).lt("received_at", toTs)
      .order("year").order("receive_no").limit(MAX_ROWS),
    sb.from("saraban_recipients").select("book_id, staff_id, assigned_at, saraban_books!inner(received_at)")
      .gte("saraban_books.received_at", fromTs).lt("saraban_books.received_at", toTs).order("assigned_at"),
    sb.rpc("saraban_staff_options"),
  ]);
  const error = booksRes.error ?? recRes.error ?? staffRes.error;
  if (error) console.error("saraban registry", error);

  const books = (booksRes.data ?? []) as Row[];
  const nameOf = new Map(((staffRes.data ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]));
  const recipients = new Map<string, string[]>();
  for (const r of (recRes.data ?? []) as { book_id: string; staff_id: string }[]) {
    const n = nameOf.get(r.staff_id);
    if (n) recipients.set(r.book_id, [...(recipients.get(r.book_id) ?? []), n]);
  }

  const rows = books.map((b) => [
    `${b.receive_no}/${b.year}`,
    b.doc_no ?? "",
    b.doc_date ? formatThaiDate(b.doc_date) : "",
    b.from_org,
    b.to_text ?? "",
    b.subject,
    registryAction(b.status, b.current_holder ? nameOf.get(b.current_holder) ?? null : null, recipients.get(b.id) ?? []),
    registryRemark(b),
  ]);
  const range = from === to ? formatThaiDate(from, "long") : `${formatThaiDate(from, "long")} – ${formatThaiDate(to, "long")}`;
  const school = settings?.school_name ?? "";
  const fileName = `ทะเบียนหนังสือรับ ${from} ถึง ${to}.xlsx`;

  return (
    <div className="mx-auto max-w-6xl">
      {/* ทะเบียนกว้าง 8 ช่อง: พิมพ์แนวนอน */}
      <style>{"@media print { @page { size: A4 landscape; margin: 1cm; } }"}</style>
      <PageHeader title="ทะเบียนหนังสือรับ" module="saraban" back="/saraban" subtitle={`ลงรับ ${range} · ${books.length} เล่ม`} />
      <PrintHeader title="ทะเบียนหนังสือรับ" school={school} lines={[`วันที่ลงรับ ${range}`]} />

      <Card className="no-print mb-3 flex flex-col gap-3">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm font-semibold">ตั้งแต่วันที่
            <input type="date" name="from" defaultValue={from} max={today} className="field-input" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">ถึงวันที่
            <input type="date" name="to" defaultValue={to} max={today} className="field-input" />
          </label>
          <Button type="submit" variant="secondary">แสดง</Button>
          <span className="flex-1" />
          <ExportButton filename={fileName} sheets={[{ name: "ทะเบียนหนังสือรับ", rows: [[...REGISTRY_HEAD], ...rows], widths: [12, 22, 14, 30, 24, 60, 36, 22] }]} />
          <PrintButton />
        </form>
        {books.length >= MAX_ROWS && <p className="text-sm text-amber-800">แสดงได้สูงสุด {MAX_ROWS} เล่ม กรุณาเลือกช่วงวันที่ให้สั้นลง</p>}
        {error && <p className="text-sm text-red-700">โหลดทะเบียนไม่สำเร็จ กรุณาลองใหม่</p>}
      </Card>

      {books.length === 0 ? (
        <EmptyState title="ไม่มีหนังสือรับในช่วงวันที่นี้" />
      ) : (
        <Card className="print-card overflow-x-auto p-0">
          <table className="data-table w-full min-w-[56rem] table-fixed border-collapse text-left text-[0.9375rem]">
            <colgroup>{COL_WIDTHS.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
            <thead>
              <tr className="bg-slate-50">
                {REGISTRY_HEAD.map((h) => <th key={h} scope="col" className="break-words border-b border-line px-2 py-2 font-semibold">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={books[i].id} className="align-top odd:bg-white even:bg-slate-50/50" style={{ breakInside: "avoid" }}>
                  {r.map((c, j) => <td key={j} className={`break-words border-b border-line px-3 py-2 ${j === 0 ? "font-semibold" : ""}`}>{c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
