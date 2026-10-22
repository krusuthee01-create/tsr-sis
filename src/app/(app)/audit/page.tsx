import Link from "next/link";
import { redirect } from "next/navigation";
import { can, getProfile, supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { Card, EmptyState } from "@/components/ui";
import { addDays, formatThaiDateTime, todayISO } from "@/lib/thai-date";

export const metadata = { title: "ประวัติการแก้ไข" };

const TABLES: Record<string, string> = {
  students: "นักเรียน", enrollments: "ห้องเรียนของนักเรียน", attendance_daily: "เช็กชื่อเข้าแถว", health_daily: "ดื่มนม/แปรงฟัน",
  attendance_subject: "เช็กชื่อประจำวิชา", staff: "ทะเบียนครู", homeroom_assignments: "ครูที่ปรึกษา", teaching_assignments: "วิชาที่สอน",
  classrooms: "ห้องเรียน", subjects: "รายวิชา", terms: "ภาคเรียน", holidays: "วันหยุด", periods: "คาบเรียน",
  academic_years: "ปีการศึกษา", school_settings: "ตั้งค่าโรงเรียน",
};
const ACTIONS: Record<string, string> = { insert: "เพิ่ม", update: "แก้ไข", delete: "ลบ", save: "บันทึก", import: "นำเข้า", promote: "เลื่อนชั้น" };
const PAGE = 50;

function show(v: unknown): string {
  if (v === null || v === undefined) return "-";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ t?: string; from?: string; to?: string; p?: string }> }) {
  const sp = await searchParams;
  const profile = await getProfile();
  if (!can(profile, "admin", "executive")) redirect("/");
  const sb = await supabaseServer();
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : todayISO();
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : addDays(to, -7);
  const page = Math.max(0, Number(sp.p) || 0);

  let q = sb.from("audit_log").select("id, at, actor_name, table_name, record_key, action, old_data, new_data, note")
    .gte("at", `${from}T00:00:00+07:00`).lte("at", `${to}T23:59:59+07:00`).order("at", { ascending: false }).range(page * PAGE, page * PAGE + PAGE);
  if (sp.t && TABLES[sp.t]) q = q.eq("table_name", sp.t);
  const { data, error } = await q;
  const rows = (data ?? []) as { id: number; at: string; actor_name: string | null; table_name: string; record_key: string | null; action: string; old_data: Record<string, unknown> | unknown[] | null; new_data: Record<string, unknown> | unknown[] | null; note: string | null }[];
  const qs = (p: number) => `/audit?${new URLSearchParams({ ...(sp.t ? { t: sp.t } : {}), from, to, p: String(p) })}`;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="ประวัติการแก้ไข" module="system" help="audit" subtitle="ใคร ทำอะไร เมื่อไร ค่าก่อนและหลัง" />
      <Card className="mb-3">
        <form className="flex flex-wrap items-end gap-2" action="/audit">
          <label className="flex flex-col gap-1 text-sm font-semibold">ประเภทข้อมูล
            <select name="t" defaultValue={sp.t ?? ""} className="field-input">
              <option value="">ทั้งหมด</option>
              {Object.entries(TABLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">ตั้งแต่<input type="date" name="from" defaultValue={from} className="field-input" /></label>
          <label className="flex flex-col gap-1 text-sm font-semibold">ถึง<input type="date" name="to" defaultValue={to} className="field-input" /></label>
          <button type="submit" className="min-h-[2.875rem] rounded-xl bg-navy-700 px-4 font-semibold text-white">กรอง</button>
        </form>
      </Card>
      {error && <p className="mb-3 rounded-xl bg-red-50 p-3 text-red-800">{error.message}</p>}
      {rows.length === 0 ? <EmptyState title="ไม่มีรายการในช่วงนี้" /> : (
        <ul className="flex flex-col gap-2">
          {rows.slice(0, PAGE).map((r) => {
            const isList = Array.isArray(r.new_data);
            const keys = !isList ? [...new Set([...Object.keys((r.old_data as Record<string, unknown>) ?? {}), ...Object.keys((r.new_data as Record<string, unknown>) ?? {})])] : [];
            return (
              <li key={r.id}>
                <details className="rounded-2xl bg-white px-4 py-3 shadow-sm">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-sm font-bold">{ACTIONS[r.action] ?? r.action}</span>
                    <span className="font-semibold">{TABLES[r.table_name] ?? r.table_name}</span>
                    {r.note && <span className="text-sm text-muted">{r.note}</span>}
                    <span className="ml-auto text-sm text-muted">{r.actor_name ?? "ระบบ"} · {formatThaiDateTime(r.at)}</span>
                  </summary>
                  <div className="mt-3 text-sm">
                    {isList ? (
                      <p className="break-all text-muted">{(r.new_data as unknown[]).length} รายการ: {show(r.new_data).slice(0, 600)}</p>
                    ) : keys.length ? (
                      <table className="data-table"><thead><tr><th>ช่อง</th><th>ก่อน</th><th>หลัง</th></tr></thead>
                        <tbody>{keys.map((k) => (
                          <tr key={k}><td>{k}</td><td className="break-all text-red-800">{show((r.old_data as Record<string, unknown> | null)?.[k])}</td><td className="break-all text-green-800">{show((r.new_data as Record<string, unknown> | null)?.[k])}</td></tr>
                        ))}</tbody></table>
                    ) : <p className="text-muted">ไม่มีรายละเอียด</p>}
                    <p className="mt-2 text-xs text-muted">รหัสรายการ: {r.record_key}</p>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-3 flex justify-between">
        {page > 0 ? <Link href={qs(page - 1)} className="rounded-xl bg-white px-4 py-2.5 font-semibold">‹ ใหม่กว่า</Link> : <span />}
        {rows.length > PAGE && <Link href={qs(page + 1)} className="rounded-xl bg-white px-4 py-2.5 font-semibold">เก่ากว่า ›</Link>}
      </div>
    </div>
  );
}
