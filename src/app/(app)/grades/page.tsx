import Link from "next/link";
import { FileArrowUp } from "@phosphor-icons/react/dist/ssr";
import { can, getProfile, getSettings, supabaseServer } from "@/lib/supabase/server";
import { PageHeader, PrintHeader } from "@/components/page-header";
import { Card, EmptyState, LinkButton, LinkTabs, SectionTitle } from "@/components/ui";
import { ExportButton, PrintButton } from "@/components/export-button";
import { classroomName, fullName, gradeSort, isKindergarten } from "@/lib/domain";
import { formatThaiDateTime } from "@/lib/thai-date";
import { gpa, TERM_LABEL } from "@/lib/pp5-grades";
import { KgFollowupTab, KgRoomTab, KgSchoolSection, KgStatsTab } from "./kg-tabs";

export const metadata = { title: "ผลการเรียน" };

type Room = { id: number; grade: string; room: number };
type SP = { tab?: string; c?: string; t?: string; y?: string };
type Dist = { classroom_id: number; subject_id: number; code: string; name: string; learning_area: string | null; hours: number | null;
  n: number; g4: number; g35: number; g3: number; g25: number; g2: number; g15: number; g1: number; g0: number; r: number; ms: number; pct3: number | null; avg_point: number | null };

const GRADE_COLS = [["g4", "4"], ["g35", "3.5"], ["g3", "3"], ["g25", "2.5"], ["g2", "2"], ["g15", "1.5"], ["g1", "1"], ["g0", "0"], ["r", "ร"], ["ms", "มส"]] as const;

function gradeStyle(g: string) {
  if (g === "0" || g === "ร" || g === "มส") return "bg-red-100 font-bold text-red-800";
  if (Number(g) >= 3) return "text-green-800";
  return "";
}

export default async function GradesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const sb = await supabaseServer();
  const [profile, settings] = await Promise.all([getProfile(), getSettings()]);
  const year = Number(sp.y) || settings?.current_year || 0;
  const leader = can(profile, "admin", "executive", "academic");
  const canImportAny = can(profile, "admin", "academic");
  const homeroom = (profile?.homerooms ?? []).filter((h) => h.kind === "homeroom").map((h) => h.classroom_id);

  const [{ data: classData }, { data: teach }, { data: years }] = await Promise.all([
    sb.from("classrooms").select("id, grade, room").eq("year", year),
    sb.from("teaching_assignments").select("classroom_id").eq("staff_id", profile?.id ?? ""),
    sb.from("academic_years").select("year").order("year", { ascending: false }),
  ]);
  const teachRooms = new Set((teach ?? []).map((t) => t.classroom_id));
  const classrooms = ((classData ?? []) as Room[])
    .filter((c) => (leader || homeroom.includes(c.id) || teachRooms.has(c.id)))
    .sort((a, b) => gradeSort(a.grade) - gradeSort(b.grade) || a.room - b.room);

  const header = <PageHeader title="ผลการเรียน" module="grades" help="grades" subtitle={`ปีการศึกษา ${year || "-"} · นำเข้าจากโปรแกรม ปพ.5`}
    actions={(canImportAny || homeroom.length) ? <LinkButton href="/grades/import" variant="secondary"><FileArrowUp size={20} weight="duotone" />นำเข้า ปพ.5</LinkButton> : undefined} />;
  if (!classrooms.length) {
    return <div className="mx-auto max-w-4xl">{header}<EmptyState title="ยังไม่มีห้องที่ท่านดูผลการเรียนได้">ครูที่ปรึกษาเห็นห้องของตนเอง ครูประจำวิชาเห็นวิชาที่สอน (ตามการมอบหมายการสอน) ผู้บริหารและงานวิชาการเห็นทั้งหมด</EmptyState></div>;
  }

  const classroom = classrooms.find((c) => String(c.id) === sp.c) ?? classrooms.find((c) => homeroom.includes(c.id)) ?? classrooms[0];
  // ภาคเรียนเริ่มต้น: ข้อมูลล่าสุดที่มี (ทั้งปี > ภาค 2 > ภาค 1)
  const kg = isKindergarten(classroom.grade);
  const { data: termRows } = await sb.from(kg ? "kg_development" : "grade_results").select("term").eq("year", year).eq("classroom_id", classroom.id).limit(1000);
  const terms = new Set((termRows ?? []).map((r) => r.term as number));
  const term = sp.t === "0" || sp.t === "1" || sp.t === "2" ? Number(sp.t) : terms.has(0) ? 0 : terms.has(2) ? 2 : 1;
  const tab = ["room", "stats", "followup", "school", "imports"].includes(sp.tab ?? "") && (sp.tab !== "school" || leader) ? sp.tab! : "room";
  const q = (o: Partial<SP>) => {
    const p = new URLSearchParams({ tab, c: String(classroom.id), t: String(term), y: String(year), ...o } as Record<string, string>);
    return `/grades?${p}`;
  };
  const tabs = [
    { id: "room", label: "รายห้อง", href: q({ tab: "room" }) },
    { id: "stats", label: kg ? "สถิติรายด้าน" : "สถิติรายวิชา", href: q({ tab: "stats" }) },
    { id: "followup", label: kg ? "ควรส่งเสริม" : "ติดตาม 0 ร มส", href: q({ tab: "followup" }) },
    ...(leader ? [{ id: "school", label: "ภาพรวมโรงเรียน", href: q({ tab: "school" }) }] : []),
    { id: "imports", label: "ประวัติการนำเข้า", href: q({ tab: "imports" }) },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      {header}
      <div className="mb-3"><LinkTabs tabs={tabs} current={tab} /></div>
      <div className="no-print mb-3 flex flex-col gap-2">
        {tab !== "school" && classrooms.length > 1 && (
          <nav className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="เลือกห้อง">
            {classrooms.map((c) => (
              <Link key={c.id} href={q({ c: String(c.id) })} aria-current={c.id === classroom.id ? "page" : undefined}
                className={`shrink-0 rounded-xl px-3.5 py-2 text-sm font-bold ${c.id === classroom.id ? "bg-violet-600 text-white" : "border-[1.5px] border-slate-300 bg-white text-slate-700"}`}>{classroomName(c)}</Link>
            ))}
          </nav>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {[1, 2, 0].map((t) => (
            <Link key={t} href={q({ t: String(t) })} className={`rounded-full px-3.5 py-1.5 text-sm font-bold ${term === t ? "bg-violet-600 text-white" : "bg-white text-slate-700 ring-1 ring-slate-300"}`}>
              {TERM_LABEL[t]}
            </Link>
          ))}
          {(years ?? []).length > 1 && (
            <span className="ml-auto flex gap-1.5 text-sm">
              {(years ?? []).slice(0, 4).map((y) => (
                <Link key={y.year} href={q({ y: String(y.year), c: "" })} className={`rounded-lg px-2.5 py-1 ${y.year === year ? "bg-slate-800 text-white" : "bg-slate-100"}`}>{y.year}</Link>
              ))}
            </span>
          )}
        </div>
      </div>

      {tab === "room" && (kg ? <KgRoomTab classroom={classroom} year={year} term={term} /> : <RoomTab classroom={classroom} year={year} term={term} showGpa={leader || homeroom.includes(classroom.id)} />)}
      {tab === "stats" && (kg ? <KgStatsTab classroom={classroom} year={year} term={term} /> : <StatsTab classroom={classroom} year={year} term={term} />)}
      {tab === "followup" && (kg ? <KgFollowupTab classroom={classroom} year={year} term={term} /> : <FollowupTab classroom={classroom} year={year} term={term} />)}
      {tab === "school" && <><SchoolTab year={year} term={term} /><KgSchoolSection year={year} term={term} /></>}
      {tab === "imports" && <ImportsTab classroom={classroom} year={year} />}
    </div>
  );
}

type RosterRow = { student_id: string; number: number | null; prefix: string | null; first_name: string; last_name: string; status?: string };
type GradeRow = { student_id: string; subject_id: number; grade: string; total: number | null; subjects: { code: string; name: string; hours_per_year: number | null; learning_area: string | null } };

async function roomData(classroomId: number, year: number, term: number) {
  const sb = await supabaseServer();
  const [{ data: roster }, { data: grades }] = await Promise.all([
    sb.rpc("roster", { p_classroom: classroomId, p_only_active: false }),
    sb.from("grade_results").select("student_id, subject_id, grade, total, subjects(code, name, hours_per_year, learning_area)")
      .eq("classroom_id", classroomId).eq("year", year).eq("term", term),
  ]);
  const rows = (grades ?? []) as unknown as GradeRow[];
  const subjects = [...new Map(rows.map((r) => [r.subject_id, { id: r.subject_id, ...r.subjects }])).values()].sort((a, b) => a.code.localeCompare(b.code, "th"));
  return { students: (roster ?? []) as RosterRow[], rows, subjects };
}

async function RoomTab({ classroom, year, term, showGpa }: { classroom: Room; year: number; term: number; showGpa: boolean }) {
  const { students, rows, subjects } = await roomData(classroom.id, year, term);
  if (!rows.length) return <EmptyState title={`ยังไม่มีผลการเรียน ${TERM_LABEL[term]} ของห้องนี้`}>ครูที่ปรึกษาหรืองานวิชาการนำเข้าจากไฟล์ ปพ.5 ได้ที่ปุ่ม &ldquo;นำเข้า ปพ.5&rdquo;</EmptyState>;
  const byStudent = new Map<string, Map<number, GradeRow>>();
  for (const r of rows) { if (!byStudent.has(r.student_id)) byStudent.set(r.student_id, new Map()); byStudent.get(r.student_id)!.set(r.subject_id, r); }
  const list = students.filter((s) => byStudent.has(s.student_id));
  const gpaOf = (id: string) => gpa([...(byStudent.get(id)?.values() ?? [])].map((r) => ({ grade: r.grade, hours: r.subjects.hours_per_year })));
  const gpas = list.map((s) => gpaOf(s.student_id)).filter((x): x is number => x !== null);
  const avg = gpas.length ? Math.round((gpas.reduce((a, b) => a + b, 0) / gpas.length) * 100) / 100 : null;
  const title = `ผลการเรียน ${classroomName(classroom)} ${TERM_LABEL[term]} ปีการศึกษา ${year}`;
  const excel = [["เลขที่", "ชื่อ-สกุล", ...subjects.map((s) => `${s.code} ${s.name}`), ...(showGpa ? ["GPA"] : [])],
    ...list.map((s) => [s.number, fullName(s), ...subjects.map((sub) => byStudent.get(s.student_id)?.get(sub.id)?.grade ?? ""), ...(showGpa ? [gpaOf(s.student_id)] : [])])];

  return (
    <Card className="p-0 md:p-0">
      <PrintHeader title={title} school={(await getSettings())?.school_name ?? ""} />
      <div className="no-print flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <p className="flex-1 font-semibold">{list.length} คน · {subjects.length} รายวิชา{showGpa && avg !== null ? ` · GPA เฉลี่ยของห้อง ${avg.toFixed(2)}` : ""}</p>
        <ExportButton filename={`${title}.xlsx`} sheets={[{ name: "ผลการเรียน", rows: excel }]} />
        <PrintButton />
      </div>
      <div className="table-wrap">
        <table className="data-table text-center">
          <thead>
            <tr><th>เลขที่</th><th className="text-left">ชื่อ-สกุล</th>
              {subjects.map((s) => <th key={s.id} title={s.name} className="whitespace-nowrap">{s.code}<br /><span className="text-[0.6875rem] font-normal">{s.name.slice(0, 12)}</span></th>)}
              {showGpa && <th>GPA</th>}
            </tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.student_id}>
                <td>{s.number ?? "-"}</td>
                <td className="whitespace-nowrap text-left font-semibold"><Link href={`/students/${s.student_id}?tab=grades`} className="hover:underline">{fullName(s, true)}</Link></td>
                {subjects.map((sub) => { const g = byStudent.get(s.student_id)?.get(sub.id)?.grade ?? ""; return <td key={sub.id} className={gradeStyle(g)}>{g}</td>; })}
                {showGpa && <td className="font-bold">{gpaOf(s.student_id)?.toFixed(2) ?? "-"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

async function distribution(year: number, term: number) {
  const sb = await supabaseServer();
  const { data } = await sb.rpc("grade_distribution", { p_year: year, p_term: term });
  return (data ?? []) as Dist[];
}

function DistTable({ rows, first }: { rows: (Dist & { label: string })[]; first: string }) {
  return (
    <div className="table-wrap">
      <table className="data-table text-center">
        <thead><tr><th className="text-left">{first}</th><th>จำนวน</th>{GRADE_COLS.map(([, l]) => <th key={l}>{l}</th>)}<th>เฉลี่ย</th><th>ร้อยละ 3 ขึ้นไป</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="whitespace-nowrap text-left font-semibold">{r.label}</td><td>{r.n}</td>
              {GRADE_COLS.map(([k]) => <td key={k} className={(k === "g0" || k === "r" || k === "ms") && r[k] ? "font-bold text-red-700" : ""}>{r[k] || ""}</td>)}
              <td>{r.avg_point ?? "-"}</td>
              <td>
                <div className="flex items-center gap-2">
                  <div className="h-2.5 w-16 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-violet-500" style={{ width: `${r.pct3 ?? 0}%` }} /></div>
                  <span className="font-bold">{r.pct3 ?? "-"}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function sumDist(label: string, rows: Dist[]): Dist & { label: string } {
  const z = { label, n: 0, g4: 0, g35: 0, g3: 0, g25: 0, g2: 0, g15: 0, g1: 0, g0: 0, r: 0, ms: 0 } as Dist & { label: string };
  let pts = 0, ptsN = 0;
  for (const r of rows) {
    z.n += r.n;
    for (const [k] of GRADE_COLS) z[k] += r[k];
    if (r.avg_point !== null) { const k = r.n - r.r - r.ms; pts += Number(r.avg_point) * k; ptsN += k; }
  }
  z.pct3 = z.n ? Math.round(((z.g4 + z.g35 + z.g3) / z.n) * 10000) / 100 : null;
  z.avg_point = ptsN ? Math.round((pts / ptsN) * 100) / 100 : null;
  return z;
}

async function StatsTab({ classroom, year, term }: { classroom: Room; year: number; term: number }) {
  const rows = (await distribution(year, term)).filter((r) => r.classroom_id === classroom.id).sort((a, b) => a.code.localeCompare(b.code, "th"));
  if (!rows.length) return <EmptyState title={`ยังไม่มีผลการเรียน ${TERM_LABEL[term]} ของห้องนี้`} />;
  const labeled = rows.map((r) => ({ ...r, label: `${r.code} ${r.name}` }));
  const total = sumDist("รวมทุกวิชา", rows);
  const title = `สถิติผลการเรียน ${classroomName(classroom)} ${TERM_LABEL[term]} ${year}`;
  return (
    <Card className="p-0 md:p-0">
      <PrintHeader title={title} school={(await getSettings())?.school_name ?? ""} />
      <div className="no-print flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <p className="flex-1 font-semibold">ร้อยละผลการเรียน 3 ขึ้นไป ทุกวิชา: {total.pct3 ?? "-"}</p>
        <ExportButton filename={`${title}.xlsx`} sheets={[{ name: "สถิติ", rows: [["รายวิชา", "จำนวน", ...GRADE_COLS.map(([, l]) => l), "เฉลี่ย", "ร้อยละ 3 ขึ้นไป"],
          ...[...labeled, total].map((r) => [r.label, r.n, ...GRADE_COLS.map(([k]) => r[k]), r.avg_point, r.pct3])] }]} />
        <PrintButton />
      </div>
      <DistTable rows={[...labeled, total]} first="รายวิชา" />
    </Card>
  );
}

async function FollowupTab({ classroom, year, term }: { classroom: Room; year: number; term: number }) {
  const { students, rows } = await roomData(classroom.id, year, term);
  const bad = rows.filter((r) => r.grade === "0" || r.grade === "ร" || r.grade === "มส");
  if (!bad.length) return <EmptyState title="ไม่มีนักเรียนที่ได้ 0 ร หรือ มส 🎉">{rows.length ? "" : `ยังไม่มีผลการเรียน ${TERM_LABEL[term]} ของห้องนี้`}</EmptyState>;
  const name = new Map(students.map((s) => [s.student_id, s]));
  const grouped = [...new Set(bad.map((r) => r.student_id))].map((id) => ({ s: name.get(id), items: bad.filter((r) => r.student_id === id) }));
  return (
    <Card className="p-0 md:p-0">
      <p className="border-b border-line px-4 py-3 font-semibold">ต้องแก้ไขผลการเรียน {grouped.length} คน {bad.length} รายวิชา</p>
      <ul className="divide-y divide-slate-100">
        {grouped.map(({ s, items }) => s && (
          <li key={s.student_id} className="flex flex-wrap items-center gap-2 px-4 py-3">
            <Link href={`/students/${s.student_id}?tab=grades`} className="min-w-40 flex-1 font-semibold hover:underline">{s.number ?? "-"}. {fullName(s, true)}</Link>
            {items.map((i) => <span key={i.subject_id} className="rounded-full bg-red-100 px-2.5 py-1 text-sm font-bold text-red-800">{i.subjects.code} {i.subjects.name}: {i.grade}</span>)}
          </li>
        ))}
      </ul>
    </Card>
  );
}

async function SchoolTab({ year, term }: { year: number; term: number }) {
  const sb = await supabaseServer();
  const [rows, prev, { data: rooms }] = await Promise.all([
    distribution(year, term), distribution(year - 1, term),
    sb.from("classrooms").select("id, grade, room").in("year", [year, year - 1]),
  ]);
  if (!rows.length) return <EmptyState title={`ยังไม่มีผลการเรียนชั้นประถม ${TERM_LABEL[term]} ปีการศึกษา ${year}`} />;
  const roomOf = new Map(((rooms ?? []) as Room[]).map((r) => [r.id, r]));
  const areas = [...new Set(rows.map((r) => r.learning_area ?? "อื่น ๆ"))].sort((a, b) => a.localeCompare(b, "th"));
  const byArea = areas.map((a) => {
    const cur = sumDist(a, rows.filter((r) => (r.learning_area ?? "อื่น ๆ") === a));
    const old = sumDist(a, prev.filter((r) => (r.learning_area ?? "อื่น ๆ") === a));
    return { ...cur, prevPct: old.n ? old.pct3 : null };
  });
  const grades = [...new Set(rows.map((r) => roomOf.get(r.classroom_id)?.grade ?? "?"))].sort((a, b) => gradeSort(a) - gradeSort(b));
  const byGrade = grades.map((g) => sumDist(g, rows.filter((r) => roomOf.get(r.classroom_id)?.grade === g)));
  const byRoom = [...new Set(rows.map((r) => r.classroom_id))]
    .map((id) => sumDist(roomOf.get(id) ? classroomName(roomOf.get(id)!) : String(id), rows.filter((r) => r.classroom_id === id)))
    .sort((a, b) => gradeSort(a.label.split("/")[0]) - gradeSort(b.label.split("/")[0]) || a.label.localeCompare(b.label));
  const total = sumDist("ทั้งโรงเรียน", rows);
  const title = `สรุปผลการเรียนทั้งโรงเรียน ${TERM_LABEL[term]} ปีการศึกษา ${year}`;
  const sheet = (name: string, list: (Dist & { label: string })[]) => ({ name, rows: [[name, "จำนวน", ...GRADE_COLS.map(([, l]) => l), "เฉลี่ย", "ร้อยละ 3 ขึ้นไป"],
    ...list.map((r) => [r.label, r.n, ...GRADE_COLS.map(([k]) => r[k]), r.avg_point, r.pct3])] });

  return (
    <div className="flex flex-col gap-3">
      <PrintHeader title={title} school={(await getSettings())?.school_name ?? ""} />
      <div className="no-print flex flex-wrap gap-2">
        <ExportButton filename={`${title}.xlsx`} sheets={[sheet("กลุ่มสาระ", [...byArea, total]), sheet("ระดับชั้น", byGrade), sheet("ห้องเรียน", byRoom)]} />
        <PrintButton />
      </div>
      <Card className="p-0 md:p-0">
        <div className="px-4 pt-4"><SectionTitle>รายกลุ่มสาระการเรียนรู้ (เทียบปีก่อน)</SectionTitle></div>
        <div className="table-wrap">
          <table className="data-table text-center">
            <thead><tr><th className="text-left">กลุ่มสาระ</th><th>จำนวน</th><th>เฉลี่ย</th><th>ร้อยละ 3 ขึ้นไป</th><th>ปี {year - 1}</th><th>เปลี่ยนแปลง</th><th>0 ร มส</th></tr></thead>
            <tbody>
              {[...byArea, { ...total, prevPct: sumDist("", prev).n ? sumDist("", prev).pct3 : null }].map((r) => {
                const diff = r.pct3 !== null && r.prevPct !== null ? Math.round((r.pct3 - r.prevPct) * 100) / 100 : null;
                return (
                  <tr key={r.label} className={r.label === "ทั้งโรงเรียน" ? "font-bold" : ""}>
                    <td className="text-left font-semibold">{r.label}</td><td>{r.n}</td><td>{r.avg_point ?? "-"}</td><td className="font-bold">{r.pct3 ?? "-"}</td>
                    <td>{r.prevPct ?? "-"}</td>
                    <td className={diff === null ? "" : diff >= 0 ? "text-green-700" : "text-red-700"}>{diff === null ? "-" : `${diff >= 0 ? "▲" : "▼"} ${Math.abs(diff)}`}</td>
                    <td className={r.g0 + r.r + r.ms ? "font-bold text-red-700" : ""}>{r.g0 + r.r + r.ms || ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <Card className="p-0 md:p-0"><div className="px-4 pt-4"><SectionTitle>รายระดับชั้น</SectionTitle></div><DistTable rows={byGrade} first="ชั้น" /></Card>
      <Card className="p-0 md:p-0"><div className="px-4 pt-4"><SectionTitle>รายห้อง</SectionTitle></div><DistTable rows={byRoom} first="ห้อง" /></Card>
    </div>
  );
}

async function ImportsTab({ classroom, year }: { classroom: Room; year: number }) {
  const sb = await supabaseServer();
  const { data } = await sb.from("grade_imports").select("id, term, file_name, summary, imported_at, staff(prefix, first_name, last_name)")
    .eq("classroom_id", classroom.id).eq("year", year).order("imported_at", { ascending: false }).limit(30);
  const list = (data ?? []) as unknown as { id: string; term: number | null; file_name: string | null; summary: Record<string, number>; imported_at: string; staff: { prefix: string | null; first_name: string; last_name: string } | null }[];
  if (!list.length) return <EmptyState title={`ห้อง ${classroomName(classroom)} ยังไม่เคยนำเข้าผลการเรียน`} action={<LinkButton href="/grades/import">นำเข้า ปพ.5</LinkButton>} />;
  return (
    <Card className="p-0 md:p-0">
      <ul className="divide-y divide-slate-100">
        {list.map((i) => (
          <li key={i.id} className="px-4 py-3 text-sm">
            <p className="font-semibold">{formatThaiDateTime(i.imported_at)} · {i.staff ? fullName(i.staff) : "-"}</p>
            <p className="text-muted">{i.file_name} · ไฟล์ภาคเรียนที่ {i.term ?? "-"} · เพิ่ม {i.summary.added ?? 0} แก้ไข {i.summary.changed ?? 0} ลบ {i.summary.removed ?? 0}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}
