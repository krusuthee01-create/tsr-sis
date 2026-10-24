import Link from "next/link";
import { getSettings, supabaseServer } from "@/lib/supabase/server";
import { PrintHeader } from "@/components/page-header";
import { Card, EmptyState, SectionTitle } from "@/components/ui";
import { ExportButton, PrintButton } from "@/components/export-button";
import { classroomName, fullName, gradeSort } from "@/lib/domain";
import { TERM_LABEL } from "@/lib/pp5-grades";
import { KG_DOMAINS, KG_LEVELS } from "@/lib/kg-dev";

type Room = { id: number; grade: string; room: number };
type DevRow = { student_id: string; classroom_id: number; scores: number[] | null; levels: Record<string, number | null> };
type RosterRow = { student_id: string; number: number | null; prefix: string | null; first_name: string; last_name: string };

function Level({ v }: { v: number | null | undefined }) {
  if (!v) return <span className="text-muted">-</span>;
  return <span className="whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: KG_LEVELS[v].bg, color: KG_LEVELS[v].fg }}>{KG_LEVELS[v].label}</span>;
}

async function load(classroomId: number, year: number, term: number) {
  const sb = await supabaseServer();
  const [{ data: roster }, { data }] = await Promise.all([
    sb.rpc("roster", { p_classroom: classroomId, p_only_active: false }),
    sb.from("kg_development").select("student_id, classroom_id, scores, levels").eq("classroom_id", classroomId).eq("year", year).eq("term", term),
  ]);
  const rows = new Map(((data ?? []) as DevRow[]).map((r) => [r.student_id, r]));
  return { students: ((roster ?? []) as RosterRow[]).filter((s) => rows.has(s.student_id)), rows };
}

const empty = (term: number) => <EmptyState title={`ยังไม่มีผลพัฒนาการ ${TERM_LABEL[term]} ของห้องนี้`}>นำเข้าจากสมุดบันทึกพัฒนาการ (ดาวน์โหลดจาก Google Sheets เป็น .xlsx) ที่ปุ่ม &ldquo;นำเข้า ปพ.5&rdquo;</EmptyState>;

export async function KgRoomTab({ classroom, year, term }: { classroom: Room; year: number; term: number }) {
  const { students, rows } = await load(classroom.id, year, term);
  if (!students.length) return empty(term);
  const school = (await getSettings())?.school_name ?? "";
  const title = `ผลพัฒนาการ ${classroomName(classroom)} ${TERM_LABEL[term]} ปีการศึกษา ${year}`;
  const label = (v: number | null | undefined) => (v ? KG_LEVELS[v].label : "");
  const excel = [["เลขที่", "ชื่อ-สกุล", ...KG_DOMAINS.map((d) => d.label), ...(term ? Array.from({ length: 33 }, (_, i) => `ตัวบ่งชี้ ${i + 1}`) : [])],
    ...students.map((s) => { const r = rows.get(s.student_id)!; return [s.number, fullName(s), ...KG_DOMAINS.map((d) => label(r.levels[d.key])), ...(term ? (r.scores ?? []).map((x) => x ?? "") : [])]; })];
  return (
    <Card className="p-0 md:p-0">
      <PrintHeader title={title} school={school} />
      <div className="no-print flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <p className="flex-1 font-semibold">{students.length} คน · ระดับคุณภาพ 3 ดี / 2 พอใช้ / 1 ควรส่งเสริม{term === 0 ? " (ทั้งปี = เฉลี่ย 2 ภาคเรียน)" : ""}</p>
        <ExportButton filename={`${title}.xlsx`} sheets={[{ name: "พัฒนาการ", rows: excel }]} />
        <PrintButton />
      </div>
      <div className="table-wrap">
        <table className="data-table text-center">
          <thead><tr><th>เลขที่</th><th className="text-left">ชื่อ-สกุล</th>{KG_DOMAINS.map((d) => <th key={d.key}>{d.label.replace("ด้าน", "")}</th>)}</tr></thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.student_id}>
                <td>{s.number ?? "-"}</td>
                <td className="whitespace-nowrap text-left font-semibold"><Link href={`/students/${s.student_id}?tab=grades`} className="hover:underline">{fullName(s, true)}</Link></td>
                {KG_DOMAINS.map((d) => <td key={d.key}><Level v={rows.get(s.student_id)!.levels[d.key]} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function countLevels(list: DevRow[], key: string): Record<1 | 2 | 3, number> & { n: number; pct3: number | null } {
  const c = { 1: 0, 2: 0, 3: 0 };
  for (const r of list) { const v = r.levels[key]; if (v === 1 || v === 2 || v === 3) c[v] += 1; }
  const n = c[1] + c[2] + c[3];
  return { ...c, n, pct3: n ? Math.round((c[3] / n) * 10000) / 100 : null };
}

function LevelTable({ groups }: { groups: { label: string; list: DevRow[] }[] }) {
  return (
    <div className="table-wrap">
      <table className="data-table text-center">
        <thead><tr><th className="text-left">กลุ่ม</th><th className="text-left">ด้าน</th><th>จำนวน</th><th>ดี</th><th>พอใช้</th><th>ควรส่งเสริม</th><th>ร้อยละระดับดี</th></tr></thead>
        <tbody>
          {groups.flatMap((g) => KG_DOMAINS.map((d, i) => {
            const c = countLevels(g.list, d.key);
            return (
              <tr key={g.label + d.key}>
                {i === 0 && <td rowSpan={KG_DOMAINS.length} className="text-left font-semibold">{g.label}</td>}
                <td className="text-left">{d.label}</td><td>{c.n}</td><td>{c[3] || ""}</td><td>{c[2] || ""}</td>
                <td className={c[1] ? "font-bold text-red-700" : ""}>{c[1] || ""}</td><td className="font-bold">{c.pct3 ?? "-"}</td>
              </tr>
            );
          }))}
        </tbody>
      </table>
    </div>
  );
}

export async function KgStatsTab({ classroom, year, term }: { classroom: Room; year: number; term: number }) {
  const { rows } = await load(classroom.id, year, term);
  if (!rows.size) return empty(term);
  return <Card className="p-0 md:p-0"><div className="px-4 pt-4"><SectionTitle>{classroomName(classroom)} · {TERM_LABEL[term]}</SectionTitle></div><LevelTable groups={[{ label: classroomName(classroom), list: [...rows.values()] }]} /></Card>;
}

export async function KgFollowupTab({ classroom, year, term }: { classroom: Room; year: number; term: number }) {
  const { students, rows } = await load(classroom.id, year, term);
  const need = students.filter((s) => KG_DOMAINS.some((d) => rows.get(s.student_id)!.levels[d.key] === 1));
  if (!need.length) return <EmptyState title="ไม่มีเด็กที่อยู่ในระดับควรส่งเสริม 🎉">{rows.size ? "" : `ยังไม่มีผลพัฒนาการ ${TERM_LABEL[term]} ของห้องนี้`}</EmptyState>;
  return (
    <Card className="p-0 md:p-0">
      <p className="border-b border-line px-4 py-3 font-semibold">เด็กที่ควรส่งเสริมพัฒนาการ {need.length} คน</p>
      <ul className="divide-y divide-slate-100">
        {need.map((s) => (
          <li key={s.student_id} className="flex flex-wrap items-center gap-2 px-4 py-3">
            <Link href={`/students/${s.student_id}?tab=grades`} className="min-w-40 flex-1 font-semibold hover:underline">{s.number ?? "-"}. {fullName(s, true)}</Link>
            {KG_DOMAINS.filter((d) => rows.get(s.student_id)!.levels[d.key] === 1).map((d) => <span key={d.key} className="rounded-full bg-red-100 px-2.5 py-1 text-sm font-bold text-red-800">{d.label}</span>)}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export async function KgSchoolSection({ year, term }: { year: number; term: number }) {
  const sb = await supabaseServer();
  const [{ data }, { data: rooms }] = await Promise.all([
    sb.from("kg_development").select("student_id, classroom_id, scores, levels").eq("year", year).eq("term", term),
    sb.from("classrooms").select("id, grade, room").eq("year", year),
  ]);
  const list = (data ?? []) as DevRow[];
  if (!list.length) return null;
  const roomOf = new Map(((rooms ?? []) as Room[]).map((r) => [r.id, r]));
  const grades = [...new Set(list.map((r) => roomOf.get(r.classroom_id)?.grade ?? "?"))].sort((a, b) => gradeSort(a) - gradeSort(b));
  const groups = [...grades.map((g) => ({ label: g, list: list.filter((r) => roomOf.get(r.classroom_id)?.grade === g) })), { label: "อนุบาลทั้งหมด", list }];
  const title = `สรุปพัฒนาการเด็กปฐมวัย ${TERM_LABEL[term]} ปีการศึกษา ${year}`;
  return (
    <Card className="mt-3 p-0 md:p-0">
      <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
        <span className="flex-1"><SectionTitle>พัฒนาการเด็กปฐมวัย (อนุบาล)</SectionTitle></span>
        <span className="no-print"><ExportButton filename={`${title}.xlsx`} sheets={[{ name: "พัฒนาการ", rows: [["ชั้น", "ด้าน", "จำนวน", "ดี", "พอใช้", "ควรส่งเสริม", "ร้อยละระดับดี"],
          ...groups.flatMap((g) => KG_DOMAINS.map((d) => { const c = countLevels(g.list, d.key); return [g.label, d.label, c.n, c[3], c[2], c[1], c.pct3]; }))] }]} /></span>
      </div>
      <LevelTable groups={groups} />
    </Card>
  );
}
