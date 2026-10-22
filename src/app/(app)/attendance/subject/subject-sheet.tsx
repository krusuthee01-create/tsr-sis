"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { enqueue, flushQueue } from "@/lib/offline-queue";
import { ATTENDANCE_STATUSES, fullName, nextAttendanceStatus } from "@/lib/domain";
import { addDays, formatThaiDate, isWeekend } from "@/lib/thai-date";
import { Spinner, Stat, Field } from "@/components/ui";
import { useToast } from "@/components/toast";

export type SubjectOption = { classroom_id: number; subject_id: number; grade: string; room: number; subject: string };
type Period = { no: number; start_time: string; end_time: string };
type Student = { student_id: string; number: number | null; prefix: string | null; first_name: string; last_name: string };

function currentPeriod(periods: Period[]): number {
  const th = new Date(Date.now() + 7 * 3600_000).toISOString().slice(11, 16);
  return periods.find((p) => th >= p.start_time.slice(0, 5) && th < p.end_time.slice(0, 5))?.no ?? periods[0]?.no ?? 1;
}

export function SubjectSheet({ options, periods, today, editWindow, labels }: {
  options: SubjectOption[]; periods: Period[]; today: string; editWindow: number; labels: Record<string, string>;
}) {
  const toast = useToast();
  const [pick, setPick] = useState(`${options[0].classroom_id}:${options[0].subject_id}`);
  const [date, setDate] = useState(today);
  const [period, setPeriod] = useState(() => currentPeriod(periods));
  const [students, setStudents] = useState<Student[] | null>(null);
  const [status, setStatus] = useState<Record<string, number>>({});
  const [morning, setMorning] = useState<Record<string, number>>({});
  const [existing, setExisting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [classroom, subject] = pick.split(":").map(Number);

  const load = useCallback(async () => {
    setStudents(null);
    const sb = supabaseBrowser();
    const [roster, daily, subj] = await Promise.all([
      sb.rpc("roster", { p_classroom: classroom }),
      sb.from("attendance_daily").select("student_id, status").eq("classroom_id", classroom).eq("date", date),
      sb.from("attendance_subject").select("student_id, status").eq("classroom_id", classroom).eq("date", date).eq("period", period),
    ]);
    if (roster.error) {
      toast(roster.error.message, "error");
      setStudents([]);
      return;
    }
    const m: Record<string, number> = {};
    for (const r of daily.data ?? []) m[r.student_id] = r.status;
    const s: Record<string, number> = {};
    if (subj.data?.length) {
      for (const r of subj.data) s[r.student_id] = r.status;
    } else {
      // ดึงคนที่ลาหรือขาดตอนเช้ามาใส่ให้ก่อน (คนที่สายตอนเช้าถือว่าเข้าเรียนคาบนี้)
      for (const [id, st] of Object.entries(m)) if (st >= 2) s[id] = st;
    }
    setMorning(m);
    setExisting(!!subj.data?.length);
    setStatus(s);
    setStudents((roster.data ?? []) as Student[]);
  }, [classroom, date, period, toast]);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const c = [0, 0, 0, 0, 0];
    for (const s of students ?? []) c[status[s.student_id] ?? 0] += 1;
    return c;
  }, [students, status]);

  async function save() {
    if (!students?.length) return;
    setSaving(true);
    await enqueue({
      key: `subject:${classroom}:${date}:${period}`, rpc: "save_subject_attendance",
      label: `${labels[pick]} ${formatThaiDate(date)} คาบ ${period}`,
      args: { p_classroom: classroom, p_date: date, p_period: period, p_subject: subject,
        p_entries: students.map((s) => ({ s: s.student_id, v: status[s.student_id] ?? 0 })) },
    });
    toast("บันทึกเช็กชื่อประจำวิชาแล้ว");
    setExisting(true);
    setSaving(false);
    const r = await flushQueue();
    if (r.failed.length) toast(`ระบบไม่รับข้อมูล: ${r.failed[0].error}`, "error");
  }

  const blocked = isWeekend(date) ? "วันเสาร์-อาทิตย์ ไม่ต้องบันทึก" : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 rounded-[1.25rem] bg-white p-3 shadow-sm sm:grid-cols-3">
        <Field label="ห้องและวิชา" htmlFor="sj-pick">
          <select id="sj-pick" className="field-input" value={pick} onChange={(e) => setPick(e.target.value)}>
            {options.map((o) => { const k = `${o.classroom_id}:${o.subject_id}`; return <option key={k} value={k}>{labels[k]}</option>; })}
          </select>
        </Field>
        <Field label={`วันที่ (${formatThaiDate(date)})`} htmlFor="sj-date">
          <input id="sj-date" type="date" className="field-input" value={date} min={addDays(today, -editWindow)} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </Field>
        <Field label="คาบ" htmlFor="sj-period">
          <select id="sj-period" className="field-input" value={period} onChange={(e) => setPeriod(Number(e.target.value))}>
            {periods.map((p) => <option key={p.no} value={p.no}>คาบ {p.no} ({p.start_time.slice(0, 5)}–{p.end_time.slice(0, 5)})</option>)}
          </select>
        </Field>
      </div>
      {blocked && <p className="rounded-xl bg-sky-100 px-3 py-2 text-sm font-medium text-sky-950">{blocked}</p>}
      {students === null ? <Spinner /> : (
        <>
          <div className="grid grid-cols-4 gap-2">
            <Stat label="เข้าเรียน" value={counts[0]} tone="green" />
            <Stat label="สาย" value={counts[1]} tone="amber" />
            <Stat label="ลา" value={counts[2] + counts[3]} tone="blue" />
            <Stat label="ขาด" value={counts[4]} tone="red" />
          </div>
          <p className="px-1 text-sm text-muted">{existing ? "แสดงข้อมูลที่บันทึกไว้แล้วของคาบนี้" : "ดึงคนที่ลา/ขาดจากการเช็กชื่อเข้าแถวเช้านี้มาให้แล้ว"}</p>
          <ul className="flex flex-col gap-2 pb-36 lg:pb-24">
            {students.map((s) => {
              const st = ATTENDANCE_STATUSES[status[s.student_id] ?? 0];
              const m = morning[s.student_id];
              return (
                <li key={s.student_id} className="flex items-center gap-3 rounded-2xl border border-line bg-white py-2 pl-3 pr-2">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-sm font-semibold">{s.number ?? "-"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{fullName(s, true)}</span>
                    <span className="block text-xs text-muted">{m !== undefined ? `เช้านี้: ${ATTENDANCE_STATUSES[m].label}` : "เช้านี้: ยังไม่เช็กชื่อ"}</span>
                  </span>
                  <button type="button" disabled={!!blocked} onClick={() => setStatus((x) => ({ ...x, [s.student_id]: nextAttendanceStatus(x[s.student_id] ?? 0) }))}
                    className="min-h-12 min-w-24 rounded-xl border-[1.5px] px-3 font-bold active:scale-95" style={{ background: st.bg, color: st.fg, borderColor: st.border }}
                    aria-label={`${fullName(s)} สถานะ ${st.label} แตะเพื่อเปลี่ยน`}>
                    {st.label === "มา" ? "เข้าเรียน" : st.label}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="no-print fixed inset-x-0 bottom-16 z-20 border-t border-line bg-white/95 px-3 pb-3 pt-2 backdrop-blur lg:bottom-0 lg:left-auto lg:w-[calc(100%-16rem)]">
            <div className="mx-auto max-w-3xl">
              <button type="button" onClick={save} disabled={saving || !!blocked || !students.length} className="min-h-[3.25rem] w-full rounded-xl bg-navy-700 text-base font-bold text-white disabled:bg-slate-300">
                {saving ? "กำลังบันทึก…" : `บันทึก (${students.length} คน)`}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
