import Link from "next/link";
import { CaretRight } from "@phosphor-icons/react/dist/ssr";
import { can, getProfile, getSettings, supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { Badge, Card, EmptyState, LinkTabs } from "@/components/ui";
import { ExportButton, PrintButton } from "@/components/export-button";
import { classroomName, fullName, gradeSort } from "@/lib/domain";
import { formatThaiDate, todayISO, addDays } from "@/lib/thai-date";
import { DOMAINS, LEVELS, INFORMANTS } from "@/lib/care";
import { ScreeningSheet, type SuggestionRow } from "./screening-sheet";

export const metadata = { title: "ดูแลช่วยเหลือนักเรียน" };
type SP = { tab?: string; c?: string; t?: string };

export default async function CarePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const sb = await supabaseServer();
  const [profile, settings] = await Promise.all([getProfile(), getSettings()]);
  const year = settings?.current_year ?? 0;
  const leader = can(profile, "admin", "executive", "guidance");
  const myRooms = (profile?.homerooms ?? []).filter((h) => h.kind === "homeroom").map((h) => h.classroom_id);
  const { data: classData } = await sb.from("classrooms").select("id, grade, room").eq("year", year);
  const classrooms = ((classData ?? []) as { id: number; grade: string; room: number }[])
    .filter((c) => leader || myRooms.includes(c.id))
    .sort((a, b) => gradeSort(a.grade) - gradeSort(b.grade) || a.room - b.room);
  const header = <PageHeader title="ดูแลช่วยเหลือนักเรียน" module="care" help="care" subtitle={`ปีการศึกษา ${year || "-"} · คัดกรอง เยี่ยมบ้าน SDQ/EQ การช่วยเหลือ`} />;
  if (!classrooms.length) {
    return <div className="mx-auto max-w-4xl">{header}<EmptyState title="หน้านี้สำหรับครูที่ปรึกษา งานแนะแนว ผู้บริหาร และผู้ดูแลระบบ">ข้อมูลการดูแลช่วยเหลือเป็นข้อมูลอ่อนไหว ครูพี่เลี้ยงและครูประจำวิชาจึงไม่เห็นหน้านี้ (ตาม PDPA)</EmptyState></div>;
  }

  const classroom = classrooms.find((c) => String(c.id) === sp.c) ?? classrooms.find((c) => myRooms.includes(c.id)) ?? classrooms[0];
  const tab = ["screening", "assess", "visits", "followup"].includes(sp.tab ?? "") ? sp.tab! : leader ? "overview" : "screening";
  const term = sp.t === "2" ? 2 : 1;
  const q = (t: string) => `/care?tab=${t}&c=${classroom.id}`;
  const tabs = [
    ...(leader ? [{ id: "overview", label: "ภาพรวมโรงเรียน", href: "/care" }] : []),
    { id: "screening", label: "คัดกรอง", href: q("screening") },
    { id: "assess", label: "SDQ / EQ", href: q("assess") },
    { id: "visits", label: "เยี่ยมบ้าน", href: q("visits") },
    { id: "followup", label: "ติดตาม/ช่วยเหลือ", href: q("followup") },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      {header}
      <div className="mb-3"><LinkTabs tabs={tabs} current={tab} /></div>
      {tab !== "overview" && classrooms.length > 1 && (
        <nav className="no-print -mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="เลือกห้อง">
          {classrooms.map((c) => (
            <Link key={c.id} href={`/care?tab=${tab}&c=${c.id}`} aria-current={c.id === classroom.id ? "page" : undefined}
              className={`shrink-0 rounded-xl px-3.5 py-2 text-sm font-bold ${c.id === classroom.id ? "bg-pink-600 text-white" : "border-[1.5px] border-slate-300 bg-white text-slate-700"}`}>{classroomName(c)}</Link>
          ))}
        </nav>
      )}
      {tab === "overview" && <Overview />}
      {tab === "screening" && <Screening classroomId={classroom.id} room={classroomName(classroom)} canEdit={can(profile, "admin", "guidance") || myRooms.includes(classroom.id)} />}
      {tab === "assess" && <Assess classroomId={classroom.id} year={year} term={term} />}
      {tab === "visits" && <Visits classroomId={classroom.id} year={year} />}
      {tab === "followup" && <Followup classroomId={classroom.id} days={Number(settings?.screening_rules?.followup_days ?? 14)} />}
    </div>
  );
}

type O = { classroom_id: number; grade: string; room: number; students: number; screened: number; risk: number; problem: number; visited: number; sdq_done: number; needs_action: number };

async function Overview() {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("care_overview");
  if (error) return <EmptyState title="ดูภาพรวมไม่ได้">{error.message}</EmptyState>;
  const rows = (data ?? []) as O[];
  const sum = (k: keyof O) => rows.reduce((a, r) => a + Number(r[k]), 0);
  const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "-");
  const grid = [["ห้อง", "นักเรียน", "คัดกรองแล้ว", "เสี่ยง", "มีปัญหา", "เยี่ยมบ้านแล้ว", "SDQ ครูแล้ว", "ยังไม่มีการช่วยเหลือ"],
    ...rows.map((r) => [classroomName(r), r.students, r.screened, r.risk, r.problem, r.visited, r.sdq_done, r.needs_action])];
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {[["คัดกรองแล้ว", pct(sum("screened"), sum("students")), "bg-slate-100 text-slate-900"], ["กลุ่มเสี่ยง", sum("risk"), "bg-amber-100 text-amber-950"],
          ["กลุ่มมีปัญหา", sum("problem"), "bg-red-100 text-red-900"], ["เยี่ยมบ้านแล้ว", pct(sum("visited"), sum("students")), "bg-sky-100 text-sky-950"],
          ["รอการช่วยเหลือ", sum("needs_action"), "bg-pink-100 text-pink-950"]].map(([l, v, c]) => (
          <div key={String(l)} className={`rounded-2xl px-3 py-2.5 ${c}`}><p className="font-display text-2xl font-bold">{v}</p><p className="text-sm">{l}</p></div>
        ))}
      </div>
      <Card className="p-0 md:p-0">
        <div className="no-print flex justify-end gap-2 border-b border-line px-4 py-3">
          <ExportButton filename="ภาพรวมการดูแลช่วยเหลือ" sheets={[{ name: "ภาพรวม", rows: grid }]} />
          <PrintButton />
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr>{grid[0].map((h) => <th key={String(h)}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.classroom_id}>
                  <td className="font-semibold"><Link className="hover:underline" href={`/care?tab=screening&c=${r.classroom_id}`}>{classroomName(r)}</Link></td>
                  <td>{r.students}</td>
                  <td>{r.screened < r.students ? <Badge tone="amber">{r.screened}</Badge> : r.screened}</td>
                  <td>{r.risk}</td><td className={r.problem ? "font-bold text-red-700" : ""}>{r.problem}</td>
                  <td>{r.visited}</td><td>{r.sdq_done}</td>
                  <td>{r.needs_action ? <Link href={`/care?tab=followup&c=${r.classroom_id}`}><Badge tone="pink">{r.needs_action} คน</Badge></Link> : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

async function Screening({ classroomId, room, canEdit }: { classroomId: number; room: string; canEdit: boolean }) {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("screening_suggestions", { p_classroom: classroomId });
  if (error) return <EmptyState title="ดูข้อมูลห้องนี้ไม่ได้">{error.message}</EmptyState>;
  return <ScreeningSheet classroomId={classroomId} room={room} rows={(data ?? []) as SuggestionRow[]} canEdit={canEdit} />;
}

function LevelBadge({ v }: { v: number | null | undefined }) {
  if (!v) return <span className="text-slate-400">-</span>;
  return <span className="whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: LEVELS[v].bg, color: LEVELS[v].fg }}>{LEVELS[v].label}</span>;
}

async function roster(classroomId: number) {
  const sb = await supabaseServer();
  const { data } = await sb.rpc("roster", { p_classroom: classroomId });
  return (data ?? []) as { student_id: string; number: number | null; prefix: string | null; first_name: string; last_name: string }[];
}

async function Assess({ classroomId, year, term }: { classroomId: number; year: number; term: number }) {
  const sb = await supabaseServer();
  const [students, { data: sdq }, { data: eq }] = await Promise.all([
    roster(classroomId),
    sb.from("sdq_results").select("student_id, informant, total, level").eq("year", year).eq("term", term).eq("classroom_id", classroomId),
    sb.from("eq_results").select("student_id, version, good, smart, happy").eq("year", year).eq("term", term).eq("classroom_id", classroomId),
  ]);
  const get = (id: string, inf: string) => (sdq ?? []).find((r) => r.student_id === id && r.informant === inf);
  return (
    <Card className="p-0 md:p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <p className="flex-1 font-semibold">ภาคเรียนที่ {term} · SDQ ฉบับครู {students.filter((s) => get(s.student_id, "teacher")).length}/{students.length} คน</p>
        <Link href={`/care?tab=assess&c=${classroomId}&t=1`} className={`rounded-full px-3 py-1.5 text-sm font-bold ${term === 1 ? "bg-pink-600 text-white" : "bg-slate-100"}`}>ภาค 1</Link>
        <Link href={`/care?tab=assess&c=${classroomId}&t=2`} className={`rounded-full px-3 py-1.5 text-sm font-bold ${term === 2 ? "bg-pink-600 text-white" : "bg-slate-100"}`}>ภาค 2</Link>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>เลขที่</th><th>ชื่อ-สกุล</th>{Object.values(INFORMANTS).map((l) => <th key={l}>SDQ {l}</th>)}<th>EQ</th></tr></thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.student_id}>
                <td>{s.number ?? "-"}</td>
                <td className="whitespace-nowrap font-semibold">{fullName(s, true)}</td>
                {Object.keys(INFORMANTS).map((inf) => {
                  const r = get(s.student_id, inf);
                  return (
                    <td key={inf}>
                      <Link href={`/care/sdq/${s.student_id}?informant=${inf}&term=${term}`} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-pink-50">
                        {r ? <><LevelBadge v={r.level} /><span className="text-xs text-muted">{r.total}</span></> : <span className={`text-sm ${inf === "teacher" ? "font-semibold text-pink-700" : "text-muted"}`}>+ บันทึก</span>}
                      </Link>
                    </td>
                  );
                })}
                <td>
                  <Link href={`/care/eq/${s.student_id}?term=${term}`} className="rounded-lg px-2 py-1 text-sm hover:bg-pink-50">
                    {(eq ?? []).some((e) => e.student_id === s.student_id) ? "บันทึกแล้ว" : <span className="text-muted">+ บันทึก</span>}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

async function Visits({ classroomId, year }: { classroomId: number; year: number }) {
  const sb = await supabaseServer();
  const [students, { data: visits }] = await Promise.all([
    roster(classroomId),
    sb.from("home_visits").select("id, student_id, visit_date, safety_risk, photos").eq("year", year).eq("classroom_id", classroomId).order("visit_date", { ascending: false }),
  ]);
  const latest = new Map<string, { id: string; visit_date: string; safety_risk: boolean; photos: string[] }>();
  for (const v of visits ?? []) if (!latest.has(v.student_id)) latest.set(v.student_id, v);
  const done = students.filter((s) => latest.has(s.student_id)).length;
  return (
    <Card className="p-0 md:p-0">
      <div className="border-b border-line px-4 py-3">
        <p className="font-semibold">เยี่ยมบ้านแล้ว {done}/{students.length} คน</p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-pink-500" style={{ width: `${students.length ? (done / students.length) * 100 : 0}%` }} /></div>
      </div>
      <ul className="divide-y divide-slate-100">
        {students.map((s) => {
          const v = latest.get(s.student_id);
          return (
            <li key={s.student_id}>
              <Link href={`/care/visit/${s.student_id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-pink-50">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-pink-100 font-semibold text-pink-900">{s.number ?? "-"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{fullName(s, true)}</span>
                  <span className="text-sm text-muted">{v ? `เยี่ยมแล้ว ${formatThaiDate(v.visit_date)}${v.photos.length ? ` · รูป ${v.photos.length}` : ""}` : "ยังไม่ได้เยี่ยมบ้าน"}</span>
                </span>
                {v?.safety_risk && <Badge tone="red">พบความเสี่ยง</Badge>}
                {!v && <Badge tone="amber">รอเยี่ยม</Badge>}
                <CaretRight size={20} className="text-slate-400" />
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

async function Followup({ classroomId, days }: { classroomId: number; days: number }) {
  const sb = await supabaseServer();
  const { data } = await sb.rpc("screening_suggestions", { p_classroom: classroomId });
  const rows = ((data ?? []) as SuggestionRow[]).filter((r) => r.confirmed_at && Math.max(r.learning ?? 1, r.health ?? 1, r.economic ?? 1, r.safety ?? 1, r.behavior ?? 1) >= 2);
  const due = addDays(todayISO(), -days);
  if (!rows.length) return <EmptyState title="ไม่มีนักเรียนกลุ่มเสี่ยงหรือมีปัญหาในห้องนี้">หรือยังไม่ได้ยืนยันผลคัดกรอง (แท็บ คัดกรอง)</EmptyState>;
  return (
    <Card className="p-0 md:p-0">
      <p className="border-b border-line px-4 py-3 font-semibold">นักเรียนที่ต้องติดตาม {rows.length} คน · ควรมีบันทึกการช่วยเหลือภายใน {days} วัน</p>
      <ul className="divide-y divide-slate-100">
        {rows.map((r) => {
          const overdue = !r.last_action || r.last_action < due;
          const worst = DOMAINS.filter((d) => (r[d.key] ?? 1) >= 2);
          return (
            <li key={r.student_id}>
              <Link href={`/students/${r.student_id}?tab=care`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-pink-50">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{fullName(r, true)}</span>
                  <span className="flex flex-wrap gap-1 pt-1">{worst.map((d) => <span key={d.key} className="rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: LEVELS[r[d.key] ?? 1].bg, color: LEVELS[r[d.key] ?? 1].fg }}>{d.label}: {LEVELS[r[d.key] ?? 1].label}</span>)}</span>
                </span>
                <span className={`text-sm font-semibold ${overdue ? "text-pink-700" : "text-green-700"}`}>{r.last_action ? `ช่วยเหลือล่าสุด ${formatThaiDate(r.last_action)}` : "ยังไม่มีบันทึกการช่วยเหลือ"}</span>
                <CaretRight size={20} className="text-slate-400" />
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
