import { can, getProfile, getSettings, supabaseServer } from "@/lib/supabase/server";
import { PageHeader, PrintHeader, PrintSignatures } from "@/components/page-header";
import { Card, EmptyState, LinkTabs } from "@/components/ui";
import { ExportButton, PrintButton } from "@/components/export-button";
import { classroomName, fullName, gradeSort } from "@/lib/domain";
import { addDays, formatThaiDate, formatThaiDateTime, formatTime, monthRange, THAI_MONTHS, todayISO } from "@/lib/thai-date";
import { attendancePercent, buildPp5Grid, buildSummaryGrid, type SummaryRow } from "@/lib/reports";
import { ReportFilters } from "./report-filters";

export const metadata = { title: "รายงาน" };

type SP = { tab?: string; c?: string; m?: string; d?: string; from?: string; to?: string };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const profile = await getProfile();
  const leader = can(profile, "admin", "executive");
  const tab = sp.tab === "daily" || (sp.tab === "usage" && leader) ? sp.tab : "monthly";
  const tabs = [
    { id: "monthly", label: "การมาเรียนรายเดือน", href: "/reports" },
    { id: "daily", label: "ภาพรวมรายวัน", href: "/reports?tab=daily" },
    ...(leader ? [{ id: "usage", label: "การใช้งานระบบ", href: "/reports?tab=usage" }] : []),
  ];
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="รายงาน" module="reports" help="reports" />
      <div className="mb-3"><LinkTabs tabs={tabs} current={tab} /></div>
      {tab === "monthly" && <Monthly sp={sp} />}
      {tab === "daily" && <Daily sp={sp} />}
      {tab === "usage" && <Usage sp={sp} />}
    </div>
  );
}

async function Monthly({ sp }: { sp: SP }) {
  const sb = await supabaseServer();
  const [profile, settings] = await Promise.all([getProfile(), getSettings()]);
  const full = can(profile, "admin", "executive", "guidance", "health");
  const [{ data: classData }, { data: teach }] = await Promise.all([
    sb.from("classrooms").select("id, grade, room").eq("year", settings?.current_year ?? 0),
    full ? Promise.resolve({ data: [] }) : sb.from("teaching_assignments").select("classroom_id").eq("staff_id", profile?.id ?? ""),
  ]);
  const allowed = new Set([...(profile?.homerooms ?? []).map((h) => h.classroom_id), ...((teach ?? []) as { classroom_id: number }[]).map((t) => t.classroom_id)]);
  const classrooms = ((classData ?? []) as { id: number; grade: string; room: number }[]).filter((c) => full || allowed.has(c.id))
    .sort((a, b) => gradeSort(a.grade) - gradeSort(b.grade) || a.room - b.room);
  if (!classrooms.length) return <EmptyState title="ยังไม่มีห้องที่ท่านดูรายงานได้" />;

  const c = classrooms.find((x) => String(x.id) === sp.c) ?? classrooms.find((x) => allowed.has(x.id)) ?? classrooms[0];
  const ym = sp.m && /^\d{4}-\d{2}$/.test(sp.m) ? sp.m : todayISO().slice(0, 7);
  const [y, m] = ym.split("-").map(Number);
  const { from, to } = monthRange(y, m);
  const [{ data: summary }, { data: days }, { data: records }, { data: homeroom }] = await Promise.all([
    sb.rpc("attendance_summary", { p_classroom: c.id, p_from: from, p_to: to }),
    sb.rpc("school_days", { p_from: from, p_to: to }),
    sb.from("attendance_daily").select("student_id, date, status").eq("classroom_id", c.id).gte("date", from).lte("date", to),
    sb.from("homeroom_assignments").select("kind, staff(prefix, first_name, last_name)").eq("classroom_id", c.id).eq("kind", "homeroom"),
  ]);
  const schoolDays = Number(days) || 0;
  const rows: SummaryRow[] = ((summary ?? []) as (SummaryRow & { student_id: string; prefix: string | null; first_name: string; last_name: string })[])
    .map((r) => ({ ...r, name: fullName(r, true) }));
  const ids = ((summary ?? []) as { student_id: string }[]).map((r) => r.student_id);
  const allDays = Array.from({ length: Number(to.slice(8)) }, (_, i) => `${ym}-${String(i + 1).padStart(2, "0")}`);
  const pp5 = buildPp5Grid(rows.map((r, i) => ({ student_id: ids[i], number: r.number, name: r.name })), allDays, (records ?? []) as { student_id: string; date: string; status: number }[]);
  const monthLabel = `${THAI_MONTHS[m - 1]} ${y + 543}`;
  const room = classroomName(c);
  const teacher = ((homeroom ?? []) as unknown as { staff: { prefix: string | null; first_name: string; last_name: string } }[])[0]?.staff;

  return (
    <div className="flex flex-col gap-3">
      <Card className="no-print flex flex-col gap-3 lg:flex-row lg:items-end">
        <ReportFilters classrooms={classrooms.map((x) => ({ id: x.id, label: classroomName(x) }))} classroom={c.id} month={ym} />
        <div className="flex flex-wrap gap-2">
          <ExportButton filename={`สรุปการมาเรียน-${room.replace("/", "-")}-${ym}`} sheets={[{ name: "สรุป", rows: buildSummaryGrid(rows, schoolDays), widths: [6, 28, 6, 6, 8, 8, 6, 16] }]} />
          <ExportButton label="ส่งออกสำหรับโปรแกรม ปพ.5" filename={`เวลาเรียน-ปพ5-${room.replace("/", "-")}-${ym}`} sheets={[{ name: "เวลาเรียน", rows: pp5, widths: [28, 6, ...allDays.map(() => 4), 6, 6] }]} />
          <PrintButton />
        </div>
      </Card>
      <PrintHeader title="รายงานสรุปการมาเรียน" school={settings?.school_name ?? ""} lines={[`ชั้น ${room} ประจำเดือน${monthLabel} ปีการศึกษา ${settings?.current_year ?? ""}`, `จำนวนวันเรียน ${schoolDays} วัน`]} />
      <Card className="p-0 md:p-0">
        <div className="no-print border-b border-line px-4 py-3 font-semibold">{room} · {monthLabel} · วันเรียน {schoolDays} วัน</div>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>เลขที่</th><th>ชื่อ-สกุล</th><th>มา</th><th>สาย</th><th>ลาป่วย</th><th>ลากิจ</th><th>ขาด</th><th>ร้อยละ</th></tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const pct = attendancePercent(r, schoolDays);
                return (
                  <tr key={ids[i]}>
                    <td>{r.number ?? "-"}</td><td className="whitespace-nowrap font-semibold">{r.name}</td>
                    <td>{r.present}</td><td>{r.late}</td><td>{r.sick}</td><td>{r.personal}</td>
                    <td className={r.absent ? "font-bold text-red-700" : ""}>{r.absent}</td>
                    <td className={pct !== null && pct < (settings?.attendance_risk_percent ?? 80) ? "font-bold text-red-700" : ""}>{pct ?? "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="no-print px-1 text-sm text-muted">ไฟล์สำหรับโปรแกรม ปพ.5: เรียงคอลัมน์ ชื่อ-สกุล, เลขที่, วันที่ 1–{allDays.length} ช่องว่าง = มา, ส = สาย, ป = ลาป่วย, ก = ลากิจ, ข = ขาด คัดลอกช่องวันที่ไปวางในชีต &ldquo;เวลาเรียน&rdquo; เดือนเดียวกันได้ในครั้งเดียว</p>
      <PrintSignatures roles={[{ label: "ครูที่ปรึกษา", name: teacher ? `${teacher.prefix ?? ""}${teacher.first_name} ${teacher.last_name}` : null }, { label: "ผู้อำนวยการโรงเรียน", name: settings?.director_name }]} />
    </div>
  );
}

type Progress = { classroom_id: number; grade: string; room: number; students: number; line_at: string | null; milk_at: string | null; brush_at: string | null; present: number; late: number; leave: number; absent: number; homeroom: string | null };

async function Daily({ sp }: { sp: SP }) {
  const sb = await supabaseServer();
  const settings = await getSettings();
  const date = sp.d && /^\d{4}-\d{2}-\d{2}$/.test(sp.d) ? sp.d : todayISO();
  const { data } = await sb.rpc("daily_progress", { p_date: date });
  const rows = (data ?? []) as Progress[];
  const t = rows.reduce((a, r) => ({ s: a.s + r.students, p: a.p + r.present, l: a.l + r.late, v: a.v + r.leave, x: a.x + r.absent }), { s: 0, p: 0, l: 0, v: 0, x: 0 });
  const grid = [["ห้อง", "นักเรียน", "มา", "สาย", "ลา", "ขาด", "เช็กชื่อ", "ดื่มนม", "แปรงฟัน", "ครูที่ปรึกษา"],
    ...rows.map((r) => [classroomName(r), r.students, r.present, r.late, r.leave, r.absent, formatTime(r.line_at), formatTime(r.milk_at), formatTime(r.brush_at), r.homeroom ?? ""]),
    ["รวม", t.s, t.p, t.l, t.v, t.x, "", "", "", ""]];
  return (
    <div className="flex flex-col gap-3">
      <Card className="no-print flex flex-wrap items-end gap-3">
        <form className="flex items-end gap-2" action="/reports">
          <input type="hidden" name="tab" value="daily" />
          <label className="flex flex-col gap-1 text-sm font-semibold">วันที่ ({formatThaiDate(date, "weekday")})
            <input type="date" name="d" defaultValue={date} className="field-input" />
          </label>
          <button type="submit" className="min-h-[2.875rem] rounded-xl bg-navy-700 px-4 font-semibold text-white">ดู</button>
        </form>
        <div className="flex-1" />
        <ExportButton filename={`ภาพรวมการมาเรียน-${date}`} sheets={[{ name: "รายวัน", rows: grid }]} />
        <PrintButton />
      </Card>
      <PrintHeader title="รายงานการมาเรียนประจำวัน" school={settings?.school_name ?? ""} lines={[formatThaiDate(date, "long")]} />
      <Card className="p-0 md:p-0">
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr>{grid[0].map((h) => <th key={String(h)}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.classroom_id} className={!r.line_at ? "bg-amber-50" : ""}>
                  <td className="font-semibold">{classroomName(r)}</td><td>{r.students}</td><td>{r.present}</td><td>{r.late}</td><td>{r.leave}</td>
                  <td className={r.absent ? "font-bold text-red-700" : ""}>{r.absent}</td>
                  <td>{r.line_at ? formatTime(r.line_at) : <span className="font-semibold text-amber-800">ยังไม่เช็ก</span>}</td>
                  <td>{formatTime(r.milk_at) || "-"}</td><td>{formatTime(r.brush_at) || "-"}</td><td className="text-sm">{r.homeroom ?? "-"}</td>
                </tr>
              ))}
              <tr className="font-bold"><td>รวม</td><td>{t.s}</td><td>{t.p}</td><td>{t.l}</td><td>{t.v}</td><td>{t.x}</td><td colSpan={4} /></tr>
            </tbody>
          </table>
        </div>
      </Card>
      <PrintSignatures roles={[{ label: "ผู้รายงาน" }, { label: "ผู้อำนวยการโรงเรียน", name: settings?.director_name }]} />
    </div>
  );
}

async function Usage({ sp }: { sp: SP }) {
  const sb = await supabaseServer();
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : todayISO();
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : addDays(to, -30);
  const { data, error } = await sb.rpc("usage_report", { p_from: from, p_to: to });
  const rows = (data ?? []) as { staff_id: string; name: string; last_seen_at: string | null; sessions: number; edits: number }[];
  return (
    <div className="flex flex-col gap-3">
      <Card className="no-print">
        <form className="flex flex-wrap items-end gap-2" action="/reports">
          <input type="hidden" name="tab" value="usage" />
          <label className="flex flex-col gap-1 text-sm font-semibold">ตั้งแต่<input type="date" name="from" defaultValue={from} className="field-input" /></label>
          <label className="flex flex-col gap-1 text-sm font-semibold">ถึง<input type="date" name="to" defaultValue={to} className="field-input" /></label>
          <button type="submit" className="min-h-[2.875rem] rounded-xl bg-navy-700 px-4 font-semibold text-white">ดู</button>
        </form>
      </Card>
      {error && <p className="rounded-xl bg-red-50 p-3 text-red-800">{error.message}</p>}
      <Card className="p-0 md:p-0">
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>ครู</th><th>ใช้งานล่าสุด</th><th>บันทึกประจำวัน (ครั้ง)</th><th>การแก้ไขข้อมูล</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.staff_id} className={!r.last_seen_at ? "bg-amber-50" : ""}>
                  <td className="font-semibold">{r.name}</td><td>{r.last_seen_at ? formatThaiDateTime(r.last_seen_at) : "ยังไม่เคยใช้งาน"}</td><td>{r.sessions}</td><td>{r.edits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
