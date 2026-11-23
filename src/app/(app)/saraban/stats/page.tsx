import { redirect } from "next/navigation";
import { getProfile, getSettings, supabaseServer } from "@/lib/supabase/server";
import { PageHeader, PrintHeader } from "@/components/page-header";
import { ExportButton, PrintButton } from "@/components/export-button";
import { Button, Card, SectionTitle } from "@/components/ui";
import { THAI_MONTHS } from "@/lib/thai-date";
import { formatDuration, sarabanStats, type StatAction, type StatBook, type StatOut, type StatRecipient } from "@/lib/saraban/stats";

export const metadata = { title: "สรุปสารบรรณ" };

const PAGE = 1000;

type Sb = Awaited<ReturnType<typeof supabaseServer>>;

/** อ่านทุกแถว (PostgREST คืนครั้งละไม่เกิน 1000 แถว) */
async function all<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<{ rows: T[]; error: unknown }> {
  const rows: T[] = [];
  for (let from = 0; from < 50 * PAGE; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) return { rows, error };
    const got = (data ?? []) as T[];
    rows.push(...got);
    if (got.length < PAGE) break;
  }
  return { rows, error: null };
}

async function load(sb: Sb, year: number) {
  const [books, actions, recipients, outgoing] = await Promise.all([
    all<StatBook>((a, b) => sb.from("saraban_books").select("id, received_at, status, urgency, doc_type")
      .eq("year", year).is("deleted_at", null).order("receive_no").range(a, b)),
    all<StatAction>((a, b) => sb.from("saraban_actions").select("book_id, action, created_at, saraban_books!inner(year)")
      .eq("saraban_books.year", year).is("saraban_books.deleted_at", null).in("action", ["endorse", "close"]).order("created_at").range(a, b)),
    all<StatRecipient>((a, b) => sb.from("saraban_recipients").select("book_id, assigned_at, read_at, saraban_books!inner(year)")
      .eq("saraban_books.year", year).is("saraban_books.deleted_at", null).order("assigned_at").range(a, b)),
    all<StatOut>((a, b) => sb.from("saraban_outgoing").select("series, doc_date, deleted_at").eq("year", year).order("seq").range(a, b)),
  ]);
  const error = books.error ?? actions.error ?? recipients.error ?? outgoing.error;
  if (error) console.error("saraban stats", error);
  return { data: { books: books.rows, actions: actions.rows, recipients: recipients.rows, outgoing: outgoing.rows }, error };
}

/**
 * สรุปสารบรรณรายปี พ.ศ. (ผอ./ธุรการ): จำนวนหนังสือรับ-ส่งรายเดือน เวลาตั้งแต่ลงรับถึง ผอ. สั่งการ งานค้าง และการอ่าน
 * อ่านผ่าน RLS ของผู้ใช้ (ผอ./ธุรการเห็นทุกเล่ม)
 */
export default async function StatsPage({ searchParams }: { searchParams: Promise<{ y?: string }> }) {
  const sp = await searchParams;
  const [profile, settings] = await Promise.all([getProfile(), getSettings()]);
  const role = profile?.saraban_role;
  if (role !== "director" && role !== "clerk") redirect("/saraban");

  const thisYear = new Date(Date.now() + 7 * 3_600_000).getUTCFullYear() + 543;
  const asked = Number(sp.y);
  const year = Number.isInteger(asked) && asked >= 2560 && asked <= thisYear ? asked : thisYear;
  const years = Array.from({ length: Math.min(5, thisYear - 2568 + 1) }, (_, i) => thisYear - i);

  const sb = await supabaseServer();
  const { data, error } = await load(sb, year);
  const s = sarabanStats(data);
  const school = settings?.school_name ?? "";
  const maxReceived = Math.max(1, ...s.months.map((m) => m.received));
  const readPct = s.recipients ? Math.round((s.read / s.recipients) * 100) : null;

  const head = ["เดือน", "หนังสือรับ", "ภายใน", "ด่วน", "หนังสือส่ง", "คำสั่ง", "ประกาศ", "บันทึกข้อความ"];
  const rows = s.months.map((m) => [THAI_MONTHS[m.month - 1], m.received, m.internal, m.urgent, m.out, m.order, m.announce, m.memo]);
  const total = ["รวม", s.received, s.internal, s.months.reduce((n, m) => n + m.urgent, 0),
    ...(["out", "order", "announce", "memo"] as const).map((k) => s.months.reduce((n, m) => n + m[k], 0))];

  const cards: { label: string; value: string; note: string; warn?: boolean }[] = [
    { label: "หนังสือรับ", value: s.received.toLocaleString("th-TH"), note: `ภายใน ${s.internal} · ออกเลขส่ง/คำสั่ง/ประกาศ/บันทึก ${s.outgoing}` },
    { label: "ลงรับ ถึง ผอ. สั่งการ", value: formatDuration(s.decisionHours), note: `ค่ากลางจาก ${s.decided} เล่มที่สั่งการแล้ว` },
    { label: "รอดำเนินการตอนนี้", value: String(s.waitingClerk + s.waitingDirector), warn: s.waitingClerk + s.waitingDirector > 0,
      note: `รอเสนอ ${s.waitingClerk} · รอ ผอ. ${s.waitingDirector}${s.oldestWaitingDays ? ` · นานสุด ${s.oldestWaitingDays} วัน` : ""}` },
    { label: "ผู้รับเปิดอ่านแล้ว", value: readPct === null ? "–" : `${readPct}%`, warn: s.unreadOver2Days > 0,
      note: `${s.read}/${s.recipients} คน · อ่านภายใน ${formatDuration(s.readHours)} · ค้างเกิน 2 วัน ${s.unreadOver2Days}` },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="สรุปสารบรรณ" module="saraban" back="/saraban" subtitle={`ปี พ.ศ. ${year}`} />
      <PrintHeader title={`สรุปงานสารบรรณ ปี พ.ศ. ${year}`} school={school} lines={[]} />

      <Card className="no-print mb-3">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm font-semibold">ปี พ.ศ.
            <select name="y" defaultValue={year} className="field-input">
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <Button type="submit" variant="secondary">แสดง</Button>
          <span className="flex-1" />
          <ExportButton filename={`สรุปสารบรรณ ${year}.xlsx`} sheets={[{ name: `สรุป ${year}`, rows: [head, ...rows, total], widths: [14, 12, 10, 8, 12, 10, 10, 14] }]} />
          <PrintButton />
        </form>
        {error ? <p className="mt-2 text-sm text-red-700">โหลดข้อมูลไม่ครบ กรุณาลองใหม่</p> : null}
      </Card>

      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label} className="print-card flex flex-col gap-1">
            <span className="text-sm font-semibold text-muted">{c.label}</span>
            <span className={`text-3xl font-bold ${c.warn ? "text-amber-700" : "text-navy-700"}`}>{c.value}</span>
            <span className="text-sm text-muted">{c.note}</span>
          </Card>
        ))}
      </div>

      <Card className="print-card overflow-x-auto p-0">
        <div className="px-4 pt-4"><SectionTitle>รายเดือน</SectionTitle></div>
        <table className="data-table w-full min-w-[40rem] border-collapse text-left text-[0.9375rem]">
          <thead>
            <tr className="bg-slate-50">
              {head.map((h, i) => <th key={h} scope="col" className={`border-b border-line px-3 py-2 font-semibold ${i ? "text-right" : ""}`}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {s.months.map((m, i) => (
              <tr key={m.month} className="odd:bg-white even:bg-slate-50/50">
                <th scope="row" className="border-b border-line px-3 py-1.5 font-semibold">{THAI_MONTHS[m.month - 1]}</th>
                <td className="border-b border-line px-3 py-1.5">
                  <span className="flex items-center justify-end gap-2">
                    <span className="hidden h-2.5 rounded-full bg-navy-700/70 sm:block print:block" style={{ width: `${(m.received / maxReceived) * 6}rem` }} aria-hidden />
                    <span className="w-8 text-right tabular-nums">{m.received}</span>
                  </span>
                </td>
                {rows[i].slice(2).map((v, j) => <td key={j} className="border-b border-line px-3 py-1.5 text-right tabular-nums">{v || ""}</td>)}
              </tr>
            ))}
            <tr className="bg-slate-50 font-semibold">
              {total.map((v, i) => i === 0
                ? <th key={i} scope="row" className="px-3 py-2">{v}</th>
                : <td key={i} className="px-3 py-2 text-right tabular-nums">{v}</td>)}
            </tr>
          </tbody>
        </table>
      </Card>
      <p className="mt-2 text-sm text-muted">
        นับหนังสือรับตามเดือนที่ลงรับ (เวลาไทย) ไม่รวมเล่มที่ลบ · หนังสือส่ง/คำสั่ง/ประกาศ/บันทึกข้อความนับตามวันที่หนังสือ ไม่รวมเลขที่ยกเลิก · &quot;ด่วน&quot; = ด่วนมากขึ้นไป
      </p>
    </div>
  );
}
