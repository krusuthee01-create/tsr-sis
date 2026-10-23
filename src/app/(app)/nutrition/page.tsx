import Link from "next/link";
import { can, getProfile, getSettings, supabaseServer } from "@/lib/supabase/server";
import { PageHeader, PrintHeader, PrintSignatures } from "@/components/page-header";
import { Badge, Card, EmptyState, LinkTabs, SectionTitle } from "@/components/ui";
import { ExportButton, PrintButton } from "@/components/export-button";
import { classroomName, fullName, gradeSort } from "@/lib/domain";
import { formatThaiDate, todayISO } from "@/lib/thai-date";
import { HFA, TONE_STYLE, WFA, WFH } from "@/lib/nutrition";
import { MeasureSheet } from "./measure-sheet";
import { RoundsManager } from "./rounds-manager";

export const metadata = { title: "ภาวะโภชนาการ" };

type Round = { id: number; name: string; start_date: string; end_date: string };
type SP = { tab?: string; r?: string; c?: string };

export default async function NutritionPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const sb = await supabaseServer();
  const [profile, settings] = await Promise.all([getProfile(), getSettings()]);
  const year = settings?.current_year ?? 0;
  const seeAll = can(profile, "admin", "executive", "health", "guidance");
  const manageRounds = can(profile, "admin", "health");
  const homeroomIds = (profile?.homerooms ?? []).map((h) => h.classroom_id);

  const [{ data: roundData }, { data: classData }] = await Promise.all([
    sb.from("measurement_rounds").select("id, name, start_date, end_date").eq("year", year).order("start_date"),
    sb.from("classrooms").select("id, grade, room").eq("year", year),
  ]);
  const rounds = (roundData ?? []) as Round[];
  const classrooms = ((classData ?? []) as { id: number; grade: string; room: number }[])
    .filter((c) => seeAll || homeroomIds.includes(c.id))
    .sort((a, b) => gradeSort(a.grade) - gradeSort(b.grade) || a.room - b.room);
  const today = todayISO();
  const round = rounds.find((r) => String(r.id) === sp.r)
    ?? rounds.find((r) => today >= r.start_date && today <= r.end_date)
    ?? [...rounds].reverse().find((r) => r.start_date <= today) ?? rounds[0];
  const classroom = classrooms.find((c) => String(c.id) === sp.c) ?? classrooms.find((c) => homeroomIds.includes(c.id)) ?? classrooms[0];

  const canRecord = (c?: { id: number }) => !!c && (can(profile, "admin", "health") || homeroomIds.includes(c.id));
  const tab = sp.tab === "summary" || (sp.tab === "rounds" && manageRounds) ? sp.tab : canRecord(classroom) ? "entry" : "summary";
  const q = (t: string) => `/nutrition?tab=${t}${round ? `&r=${round.id}` : ""}${classroom ? `&c=${classroom.id}` : ""}`;
  const tabs = [
    ...(canRecord(classroom) ? [{ id: "entry", label: "บันทึกน้ำหนัก/ส่วนสูง", href: q("entry") }] : []),
    { id: "summary", label: "สรุปผล", href: q("summary") },
    ...(manageRounds ? [{ id: "rounds", label: "รอบการชั่ง", href: q("rounds") }] : []),
  ];

  const header = <PageHeader title="ภาวะโภชนาการ" module="nutrition" help="nutrition" subtitle={`ปีการศึกษา ${year || "-"} · เกณฑ์: ${settings?.growth_reference_name ?? "-"}`} />;

  if (!classrooms.length) {
    return <div className="mx-auto max-w-4xl">{header}<EmptyState title="ท่านยังไม่มีห้องที่ดูแล">หน้านี้สำหรับครูที่ปรึกษา งานอนามัย ผู้บริหาร และผู้ดูแลระบบ</EmptyState></div>;
  }

  return (
    <div className="mx-auto max-w-5xl">
      {header}
      <div className="mb-3"><LinkTabs tabs={tabs} current={tab} /></div>

      {tab !== "rounds" && (
        <Card className="no-print mb-3 flex flex-col gap-3">
          {rounds.length ? (
            <nav className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="เลือกรอบ">
              {rounds.map((r) => (
                <Link key={r.id} href={`/nutrition?tab=${tab}&r=${r.id}${classroom ? `&c=${classroom.id}` : ""}`} aria-current={r.id === round?.id ? "page" : undefined}
                  className={`shrink-0 rounded-xl px-3.5 py-2 text-sm font-bold ${r.id === round?.id ? "bg-orange-600 text-white" : "border-[1.5px] border-slate-300 bg-white text-slate-700"}`}>
                  {r.name}
                </Link>
              ))}
            </nav>
          ) : (
            <p className="text-muted">ยังไม่มีรอบการชั่งน้ำหนัก {manageRounds ? <Link className="font-semibold text-navy-700 underline" href={q("rounds")}>สร้างรอบ</Link> : "แจ้งงานอนามัยหรือผู้ดูแลระบบให้สร้างรอบ"}</p>
          )}
          {classrooms.length > 1 && (
            <nav className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="เลือกห้อง">
              {tab === "summary" && seeAll && (
                <Link href={`/nutrition?tab=summary${round ? `&r=${round.id}` : ""}&c=all`} aria-current={sp.c === "all" ? "page" : undefined}
                  className={`shrink-0 rounded-xl px-3.5 py-2 text-sm font-bold ${sp.c === "all" ? "bg-sky-600 text-white" : "border-[1.5px] border-slate-300 bg-white text-slate-700"}`}>ทั้งโรงเรียน</Link>
              )}
              {classrooms.map((c) => (
                <Link key={c.id} href={`/nutrition?tab=${tab}${round ? `&r=${round.id}` : ""}&c=${c.id}`} aria-current={c.id === classroom?.id && sp.c !== "all" ? "page" : undefined}
                  className={`shrink-0 rounded-xl px-3.5 py-2 text-sm font-bold ${c.id === classroom?.id && sp.c !== "all" ? "bg-sky-600 text-white" : "border-[1.5px] border-slate-300 bg-white text-slate-700"}`}>
                  {classroomName(c)}
                </Link>
              ))}
            </nav>
          )}
        </Card>
      )}

      {tab === "entry" && round && classroom && (
        <MeasureSheet key={`${classroom.id}:${round.id}`} classroomId={classroom.id} classroomLabel={classroomName(classroom)} round={round}
          today={today} alertKg={Number(settings?.nutrition_alert_kg ?? 5)} />
      )}
      {tab === "summary" && round && (sp.c === "all" && seeAll ? <SchoolSummary round={round} /> : classroom && <ClassSummary round={round} classroom={classroom} />)}
      {tab === "rounds" && <RoundsManager year={year} rounds={rounds} />}
    </div>
  );
}

type Row = { student_id: string; number: number | null; prefix: string | null; first_name: string; last_name: string; gender: string | null; birth_date: string | null; student_code: string | null; weight: number | null; height: number | null; measured_on: string | null; wfa: number | null; hfa: number | null; wfh: number | null };

function Chip({ map, v }: { map: Record<number, { short: string; tone: keyof typeof TONE_STYLE }>; v: number | null }) {
  if (!v) return <span className="text-slate-400">-</span>;
  const s = TONE_STYLE[map[v].tone];
  return <span className="inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: s.bg, color: s.fg }}>{map[v].short}</span>;
}

async function ClassSummary({ round, classroom }: { round: Round; classroom: { id: number; grade: string; room: number } }) {
  const sb = await supabaseServer();
  const settings = await getSettings();
  const { data, error } = await sb.rpc("nutrition_roster", { p_classroom: classroom.id, p_round: round.id });
  if (error) return <EmptyState title="ดูข้อมูลห้องนี้ไม่ได้">{error.message}</EmptyState>;
  const rows = (data ?? []) as Row[];
  const measured = rows.filter((r) => r.weight !== null || r.height !== null);
  const count = (k: "wfa" | "hfa" | "wfh", v: number) => measured.filter((r) => r[k] === v).length;
  const problems = measured.filter((r) => (r.wfa ?? 3) !== 3 || (r.hfa ?? 3) < 3 || (r.wfh ?? 3) !== 3);
  const room = classroomName(classroom);
  const label = (map: Record<number, { label: string }>, v: number | null) => (v ? map[v].label : "");
  const sheet = [["เลขที่", "รหัสนักเรียน", "ชื่อ-สกุล", "เพศ", "วันที่ชั่ง", "น้ำหนัก (กก.)", "ส่วนสูง (ซม.)", "น้ำหนักตามอายุ", "ส่วนสูงตามอายุ", "น้ำหนักตามส่วนสูง"],
    ...rows.map((r) => [r.number ?? "", r.student_code ?? "", fullName(r), r.gender ?? "", r.measured_on ? formatThaiDate(r.measured_on) : "", r.weight ?? "", r.height ?? "", label(WFA, r.wfa), label(HFA, r.hfa), label(WFH, r.wfh)])];
  const pp5 = [["ชื่อ-สกุล", "เลขที่", "น้ำหนัก", "ส่วนสูง"], ...rows.map((r) => [fullName(r), r.number ?? "", r.weight ?? "", r.height ?? ""])];
  const dmc = [["รหัสนักเรียน", "ชื่อ-สกุล", "น้ำหนัก (กก.)", "ส่วนสูง (ซม.)"], ...[...rows].sort((a, b) => (a.student_code ?? "").localeCompare(b.student_code ?? "")).map((r) => [r.student_code ?? "", fullName(r), r.weight ?? "", r.height ?? ""])];

  return (
    <div className="flex flex-col gap-3">
      <Card className="no-print flex flex-wrap items-center gap-2">
        <p className="flex-1 font-semibold">{room} · รอบ {round.name} · ชั่งแล้ว {measured.length}/{rows.length} คน</p>
        <ExportButton filename={`ภาวะโภชนาการ-${room.replace("/", "-")}-${round.name}`} sheets={[{ name: "ภาวะโภชนาการ", rows: sheet, widths: [6, 12, 28, 6, 12, 10, 10, 18, 16, 16] }]} />
        <ExportButton label="สำหรับโปรแกรม ปพ.5" filename={`น้ำหนักส่วนสูง-ปพ5-${room.replace("/", "-")}-${round.name}`} sheets={[{ name: "น้ำหนัก-ส่วนสูง", rows: pp5, widths: [28, 6, 10, 10] }]} />
        <ExportButton label="สำหรับกรอก DMC" filename={`น้ำหนักส่วนสูง-DMC-${room.replace("/", "-")}-${round.name}`} sheets={[{ name: "DMC", rows: dmc, widths: [12, 28, 12, 12] }]} />
        <PrintButton />
      </Card>
      <PrintHeader title="ผลการประเมินภาวะโภชนาการ" school={settings?.school_name ?? ""} lines={[`ชั้น ${room} รอบ ${round.name} ปีการศึกษา ${settings?.current_year ?? ""}`, `เกณฑ์: ${settings?.growth_reference_name ?? ""}`]} />
      <div className="grid gap-3 md:grid-cols-3">
        <SummaryCard title="น้ำหนักตามเกณฑ์ส่วนสูง" items={[1, 2, 3, 4, 5, 6].map((v) => ({ ...WFH[v], n: count("wfh", v) }))} total={measured.length} />
        <SummaryCard title="น้ำหนักตามเกณฑ์อายุ" items={[1, 2, 3, 4, 5].map((v) => ({ ...WFA[v], n: count("wfa", v) }))} total={measured.length} />
        <SummaryCard title="ส่วนสูงตามเกณฑ์อายุ" items={[1, 2, 3, 4, 5].map((v) => ({ ...HFA[v], n: count("hfa", v) }))} total={measured.length} />
      </div>
      <Card className="p-0 md:p-0">
        <div className="border-b border-line px-4 py-3 font-semibold">{problems.length ? `นักเรียนที่ควรติดตาม ${problems.length} คน` : "รายชื่อทั้งห้อง"}</div>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>เลขที่</th><th>ชื่อ-สกุล</th><th>น้ำหนัก</th><th>ส่วนสูง</th><th>น้ำหนัก/อายุ</th><th>ส่วนสูง/อายุ</th><th>น้ำหนัก/ส่วนสูง</th></tr></thead>
            <tbody>
              {(problems.length ? problems : rows).map((r) => (
                <tr key={r.student_id}>
                  <td>{r.number ?? "-"}</td>
                  <td className="whitespace-nowrap font-semibold"><Link href={`/students/${r.student_id}?tab=nutrition`} className="hover:underline">{fullName(r, true)}</Link></td>
                  <td>{r.weight ?? "-"}</td><td>{r.height ?? "-"}</td>
                  <td><Chip map={WFA} v={r.wfa} /></td><td><Chip map={HFA} v={r.hfa} /></td><td><Chip map={WFH} v={r.wfh} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <PrintSignatures roles={[{ label: "ครูที่ปรึกษา" }, { label: "ครูอนามัยโรงเรียน" }, { label: "ผู้อำนวยการโรงเรียน", name: settings?.director_name }]} />
    </div>
  );
}

function SummaryCard({ title, items, total }: { title: string; items: { label: string; tone: keyof typeof TONE_STYLE; n: number }[]; total: number }) {
  return (
    <Card>
      <SectionTitle>{title}</SectionTitle>
      <ul className="flex flex-col gap-1.5">
        {items.map((i) => (
          <li key={i.label} className="flex items-center gap-2">
            <span className="w-28 shrink-0 text-sm">{i.label}</span>
            <span className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100">
              <span className="block h-full rounded-full" style={{ width: total ? `${(i.n / total) * 100}%` : 0, background: TONE_STYLE[i.tone].fg }} />
            </span>
            <span className="w-16 text-right text-sm font-semibold">{i.n} {total ? `(${Math.round((i.n / total) * 100)}%)` : ""}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

type SRow = { classroom_id: number; grade: string; room: number; students: number; measured: number; wfa1: number; wfa2: number; wfa4: number; wfa5: number; hfa1: number; hfa2: number; wfh1: number; wfh2: number; wfh3: number; wfh4: number; wfh5: number; wfh6: number };

async function SchoolSummary({ round }: { round: Round }) {
  const sb = await supabaseServer();
  const settings = await getSettings();
  const { data } = await sb.rpc("nutrition_summary", { p_round: round.id });
  const rows = (data ?? []) as SRow[];
  const sum = (k: keyof SRow) => rows.reduce((a, r) => a + Number(r[k]), 0);
  const cols: [keyof SRow, string][] = [["students", "นักเรียน"], ["measured", "ชั่งแล้ว"], ["wfh3", "สมส่วน"], ["wfh1", "ผอม"], ["wfh2", "ค่อนข้างผอม"], ["wfh4", "ท้วม"], ["wfh5", "เริ่มอ้วน"], ["wfh6", "อ้วน"], ["hfa1", "เตี้ย"], ["hfa2", "ค่อนข้างเตี้ย"], ["wfa1", "น้ำหนักน้อยกว่าเกณฑ์"]];
  const grid = [["ห้อง", ...cols.map((c) => c[1])], ...rows.map((r) => [classroomName(r), ...cols.map(([k]) => Number(r[k]))]), ["รวม", ...cols.map(([k]) => sum(k))]];
  const measured = sum("measured");
  const pct = (n: number) => (measured ? `${((n / measured) * 100).toFixed(1)}%` : "-");
  return (
    <div className="flex flex-col gap-3">
      <Card className="no-print flex flex-wrap items-center gap-2">
        <p className="flex-1 font-semibold">ทั้งโรงเรียน · รอบ {round.name} · ชั่งแล้ว {measured}/{sum("students")} คน</p>
        <ExportButton filename={`ภาวะโภชนาการ-ทั้งโรงเรียน-${round.name}`} sheets={[{ name: "สรุป", rows: grid }]} />
        <PrintButton />
      </Card>
      <PrintHeader title="สรุปภาวะโภชนาการนักเรียน" school={settings?.school_name ?? ""} lines={[`รอบ ${round.name} ปีการศึกษา ${settings?.current_year ?? ""}`]} />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {([["wfh3", "สมส่วน", "green"], ["wfh1", "ผอม", "red"], ["wfh6", "อ้วน", "purple"], ["hfa1", "เตี้ย", "red"]] as const).map(([k, l, t]) => (
          <div key={k} className="rounded-2xl px-3 py-2.5" style={{ background: TONE_STYLE[t].bg, color: TONE_STYLE[t].fg }}>
            <p className="font-display text-2xl font-bold">{pct(sum(k))}</p><p className="text-sm">{l} ({sum(k)} คน)</p>
          </div>
        ))}
      </div>
      <Card className="p-0 md:p-0">
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr>{grid[0].map((h) => <th key={String(h)}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.classroom_id}>
                  <td className="font-semibold"><Link className="hover:underline" href={`/nutrition?tab=summary&r=${round.id}&c=${r.classroom_id}`}>{classroomName(r)}</Link></td>
                  {cols.map(([k]) => <td key={k}>{k === "measured" && r.measured < r.students ? <Badge tone="amber">{r.measured}</Badge> : Number(r[k])}</td>)}
                </tr>
              ))}
              <tr className="font-bold"><td>รวม</td>{cols.map(([k]) => <td key={k}>{sum(k)}</td>)}</tr>
            </tbody>
          </table>
        </div>
      </Card>
      <PrintSignatures roles={[{ label: "ครูอนามัยโรงเรียน" }, { label: "ผู้อำนวยการโรงเรียน", name: settings?.director_name }]} />
    </div>
  );
}
