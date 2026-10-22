"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CaretLeft, CaretRight, CheckCircle, CloudSlash, ArrowCounterClockwise } from "@phosphor-icons/react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { enqueue, flushQueue, pendingItems, cacheGet, cachePut } from "@/lib/offline-queue";
import { ATTENDANCE_STATUSES, RECORD_KINDS, classroomName, fullName, isPresent, nextAttendanceStatus, type RecordKind } from "@/lib/domain";
import { addDays, formatThaiDate, formatTime, isWeekend, todayISO } from "@/lib/thai-date";
import { Spinner, Stat } from "@/components/ui";
import { useToast } from "@/components/toast";

export type ClassOption = { id: number; grade: string; room: number };
type Student = { student_id: string; number: number | null; prefix: string | null; first_name: string; last_name: string; nickname: string | null };
type DayData = {
  line: Record<string, number>;
  milk: Record<string, boolean>;
  brush: Record<string, boolean>;
  sessions: Partial<Record<RecordKind, string>>;
};

const KIND_LABEL: Record<RecordKind, string> = { line: "เช็กชื่อ", milk: "ดื่มนม", brush: "แปรงฟัน" };

export function AttendanceSheet({ options, initialClass, initialKind, initialDate, editWindow }: {
  options: ClassOption[]; initialClass: number; initialKind: RecordKind; initialDate: string; editWindow: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [classroom, setClassroom] = useState(initialClass);
  const [kind, setKind] = useState<RecordKind>(initialKind);
  const [date, setDate] = useState(initialDate);
  const [students, setStudents] = useState<Student[] | null>(null);
  const [day, setDay] = useState<DayData>({ line: {}, milk: {}, brush: {}, sessions: {} });
  const [fromCache, setFromCache] = useState(false);
  const [justSaved, setJustSaved] = useState<RecordKind | null>(null);
  const [saving, setSaving] = useState(false);

  const today = todayISO();
  const minDate = addDays(today, -editWindow);
  const room = options.find((o) => o.id === classroom);

  // จำห้อง/แท็บ/วันที่ไว้ใน URL เพื่อให้กดย้อนกลับและแชร์ลิงก์ได้
  useEffect(() => {
    const url = `/attendance?c=${classroom}&k=${kind}${date !== today ? `&d=${date}` : ""}`;
    window.history.replaceState(null, "", url);
  }, [classroom, kind, date, today]);

  const load = useCallback(async (c: number, d: string) => {
    setStudents(null);
    setJustSaved(null);
    const sb = supabaseBrowser();
    const dayKey = `day:${c}:${d}`;
    try {
      const [roster, att, health, sessions] = await Promise.all([
        sb.rpc("roster", { p_classroom: c }),
        sb.from("attendance_daily").select("student_id, status").eq("classroom_id", c).eq("date", d),
        sb.from("health_daily").select("student_id, kind, done").eq("classroom_id", c).eq("date", d),
        sb.from("record_sessions").select("kind, saved_at").eq("classroom_id", c).eq("date", d),
      ]);
      const err = roster.error ?? att.error ?? health.error ?? sessions.error;
      if (err) throw err;
      const data: DayData = { line: {}, milk: {}, brush: {}, sessions: {} };
      for (const r of att.data ?? []) data.line[r.student_id] = r.status;
      for (const r of health.data ?? []) data[r.kind as "milk" | "brush"][r.student_id] = r.done;
      for (const r of sessions.data ?? []) data.sessions[r.kind as RecordKind] = r.saved_at;
      const list = (roster.data ?? []) as Student[];
      await Promise.all([cachePut(`roster:${c}`, list), cachePut(dayKey, data)]);
      setFromCache(false);
      setStudents(list);
      setDay(await withPending(c, d, data));
    } catch (e) {
      const list = await cacheGet<Student[]>(`roster:${c}`);
      if (list) {
        const cached = (await cacheGet<DayData>(dayKey)) ?? { line: {}, milk: {}, brush: {}, sessions: {} };
        setFromCache(true);
        setStudents(list);
        setDay(await withPending(c, d, cached));
      } else {
        setStudents([]);
        toast(e instanceof Error && !/fetch/i.test(e.message) ? e.message : "โหลดรายชื่อไม่ได้ และยังไม่เคยเปิดห้องนี้ในเครื่องนี้ กรุณาต่ออินเทอร์เน็ต", "error");
      }
    }
  }, [toast]);

  useEffect(() => { load(classroom, date); }, [classroom, date, load]);

  // ค่าปัจจุบันของแต่ละคน (ยังไม่เคยบันทึก = มา / ดื่ม / แปรง)
  const lineOf = (id: string) => day.line[id] ?? 0;
  const healthOf = (k: "milk" | "brush", id: string) => day[k][id] ?? true;

  const counts = useMemo(() => {
    const ids = (students ?? []).map((s) => s.student_id);
    const c = [0, 0, 0, 0, 0];
    for (const id of ids) c[day.line[id] ?? 0] += 1;
    const here = ids.filter((id) => isPresent(day.line[id]));
    const yes = (k: "milk" | "brush") => here.filter((id) => day[k][id] ?? true).length;
    return { status: c, here: here.length, total: ids.length, milk: yes("milk"), brush: yes("brush") };
  }, [students, day]);

  function tap(id: string) {
    setJustSaved(null);
    if (kind === "line") {
      setDay((d) => ({ ...d, line: { ...d.line, [id]: nextAttendanceStatus(d.line[id] ?? 0) } }));
    } else if (isPresent(day.line[id])) {
      const k = kind;
      setDay((d) => ({ ...d, [k]: { ...d[k], [id]: !(d[k][id] ?? true) } }));
    }
  }

  function resetAll() {
    setJustSaved(null);
    if (kind === "line") setDay((d) => ({ ...d, line: {} }));
    else { const k = kind; setDay((d) => ({ ...d, [k]: {} })); }
  }

  async function save() {
    if (!students?.length || !room) return;
    setSaving(true);
    const entries = kind === "line"
      ? students.map((s) => ({ s: s.student_id, v: lineOf(s.student_id) }))
      : students.filter((s) => isPresent(day.line[s.student_id])).map((s) => ({ s: s.student_id, v: healthOf(kind, s.student_id) }));
    const label = `${classroomName(room)} ${formatThaiDate(date)} · ${KIND_LABEL[kind]}`;
    try {
      // บันทึกลงเครื่องก่อน แล้วแจ้งสำเร็จทันที ส่วนการส่งทำเบื้องหลัง
      await enqueue({ key: `daily:${classroom}:${date}:${kind}`, rpc: "save_daily", label,
        args: { p_classroom: classroom, p_date: date, p_kind: kind, p_entries: entries } });
      const savedAt = new Date().toISOString();
      setDay((d) => { const next = { ...d, sessions: { ...d.sessions, [kind]: savedAt } }; cachePut(`day:${classroom}:${date}`, next); return next; });
      setJustSaved(kind);
    } catch (e) {
      toast(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ", "error");
      setSaving(false);
      return;
    }
    setSaving(false);
    const r = await flushQueue();
    if (r.failed.length) toast(`ระบบไม่รับข้อมูล: ${r.failed[0].error}`, "error");
    else if (r.sent) router.refresh();
  }

  const dayBlocked = isWeekend(date) ? "วันเสาร์-อาทิตย์ ไม่ต้องบันทึก" : date > today ? "บันทึกล่วงหน้าไม่ได้" : date < minDate ? `แก้ไขย้อนหลังได้ไม่เกิน ${editWindow} วัน` : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 rounded-[1.25rem] bg-white p-3 shadow-sm sm:flex-row sm:items-end">
        {options.length > 1 && (
          <label className="flex flex-1 flex-col gap-1 text-sm font-semibold">ห้อง
            <select className="field-input" value={classroom} onChange={(e) => setClassroom(Number(e.target.value))}>
              {options.map((o) => <option key={o.id} value={o.id}>{classroomName(o)}</option>)}
            </select>
          </label>
        )}
        <div className="flex flex-1 flex-col gap-1 text-sm font-semibold">
          <label htmlFor="att-date">วันที่ <span className="font-normal text-muted">({formatThaiDate(date, "weekday")})</span></label>
          <div className="flex gap-2">
            <button type="button" aria-label="วันก่อนหน้า" onClick={() => setDate(addDays(date, -1))} className="flex size-[2.875rem] shrink-0 items-center justify-center rounded-xl border-[1.5px] border-slate-300 bg-white"><CaretLeft size={20} /></button>
            <input id="att-date" type="date" className="field-input" value={date} min={minDate} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} />
            <button type="button" aria-label="วันถัดไป" disabled={date >= today} onClick={() => setDate(addDays(date, 1))} className="flex size-[2.875rem] shrink-0 items-center justify-center rounded-xl border-[1.5px] border-slate-300 bg-white disabled:opacity-40"><CaretRight size={20} /></button>
          </div>
        </div>
      </div>

      <div role="tablist" aria-label="ประเภทการบันทึก" className="grid grid-cols-3 gap-1 rounded-2xl bg-green-600 p-1">
        {RECORD_KINDS.map((k) => (
          <button key={k.id} type="button" role="tab" aria-selected={kind === k.id} onClick={() => { setKind(k.id); setJustSaved(null); }}
            className={`flex min-h-11 flex-col items-center justify-center rounded-xl text-[0.9375rem] font-bold ${kind === k.id ? "bg-white text-green-800" : "text-white hover:bg-white/10"}`}>
            {k.label}
            <span className={`text-[0.6875rem] font-medium ${kind === k.id ? "text-green-700" : "text-green-100"}`}>
              {day.sessions[k.id] ? `✓ ${formatTime(day.sessions[k.id])} น.` : "ยังไม่บันทึก"}
            </span>
          </button>
        ))}
      </div>

      {fromCache && (
        <p className="flex items-center gap-2 rounded-xl bg-amber-100 px-3 py-2 text-sm font-medium text-amber-950">
          <CloudSlash size={20} weight="duotone" /> ไม่มีสัญญาณ: ใช้รายชื่อที่จำไว้ในเครื่อง บันทึกได้ตามปกติ ระบบจะส่งให้ภายหลัง
        </p>
      )}
      {dayBlocked && <p className="rounded-xl bg-sky-100 px-3 py-2 text-sm font-medium text-sky-950">{dayBlocked}</p>}

      {students === null ? <Spinner label="กำลังโหลดรายชื่อ" /> : students.length === 0 ? (
        <p className="rounded-2xl bg-white p-6 text-center text-muted">ห้องนี้ยังไม่มีนักเรียน (ผู้ดูแลระบบนำเข้าจาก DMC ได้ที่หน้าทะเบียนนักเรียน)</p>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-2">
            {kind === "line" ? (
              <>
                <Stat label="มา" value={counts.status[0]} tone="green" />
                <Stat label="สาย" value={counts.status[1]} tone="amber" />
                <Stat label="ลา" value={counts.status[2] + counts.status[3]} tone="blue" />
                <Stat label="ขาด" value={counts.status[4]} tone="red" />
              </>
            ) : (
              <>
                <Stat label="มาเรียน" value={counts.here} tone="green" />
                <Stat label={kind === "milk" ? "ดื่ม" : "แปรง"} value={counts[kind]} tone="blue" />
                <Stat label={kind === "milk" ? "ไม่ดื่ม" : "ไม่แปรง"} value={counts.here - counts[kind]} tone="orange" />
                <Stat label="ไม่มา" value={counts.total - counts.here} tone="gray" />
              </>
            )}
          </div>
          <p className="px-1 text-sm text-muted">
            {kind === "line" ? "แตะป้ายเพื่อเปลี่ยน: มา → สาย → ลาป่วย → ลากิจ → ขาด" : "ดึงคนที่ไม่มาจาก \"เข้าแถว\" ให้แล้ว แตะเฉพาะคนที่ไม่" + (kind === "milk" ? "ดื่ม" : "แปรง")}
          </p>

          <ul className="flex flex-col gap-2 pb-36 lg:pb-24">
            {students.map((s) => {
              const away = kind !== "line" && !isPresent(day.line[s.student_id]);
              let pill: { text: string; bg: string; fg: string; border: string };
              if (kind === "line") {
                const st = ATTENDANCE_STATUSES[lineOf(s.student_id)];
                pill = { text: st.label, bg: st.bg, fg: st.fg, border: st.border };
              } else if (away) {
                pill = { text: "—", bg: "#F1F5F9", fg: "#475569", border: "#E2E8F0" };
              } else {
                const on = healthOf(kind, s.student_id);
                const yes = kind === "milk" ? "ดื่มแล้ว" : "แปรงแล้ว";
                const no = kind === "milk" ? "ไม่ดื่ม" : "ไม่แปรง";
                pill = on ? { text: yes, bg: "#E0F2FE", fg: "#075985", border: "#7DD3FC" } : { text: no, bg: "#FFEDD5", fg: "#9A3412", border: "#FDBA74" };
              }
              const name = fullName(s, true);
              return (
                <li key={s.student_id} className={`flex items-center gap-3 rounded-2xl border border-line bg-white py-2 pl-3 pr-2 ${away ? "opacity-55" : ""}`}>
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-sm font-semibold text-slate-700">{s.number ?? "-"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{name}</span>
                    <span className="block truncate text-xs text-muted">{away ? "ไม่มาเรียนวันนี้ · ตัดออกอัตโนมัติ" : s.nickname ? `ชื่อเล่น ${s.nickname}` : " "}</span>
                  </span>
                  <button type="button" onClick={() => tap(s.student_id)} disabled={away || !!dayBlocked}
                    aria-label={`${name} สถานะ ${pill.text} แตะเพื่อเปลี่ยน`}
                    className="min-h-12 min-w-24 rounded-xl border-[1.5px] px-3 text-[0.9375rem] font-bold transition-transform active:scale-95"
                    style={{ background: pill.bg, color: pill.fg, borderColor: pill.border }}>
                    {pill.text}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="no-print fixed inset-x-0 bottom-16 z-20 border-t border-line bg-white/95 px-3 pb-3 pt-2 backdrop-blur lg:bottom-0 lg:left-auto lg:right-0 lg:w-[calc(100%-16rem)]">
            <div className="mx-auto flex max-w-3xl flex-col gap-2">
              {justSaved === kind && (
                <p role="status" className="flex items-center gap-2 rounded-xl bg-green-100 px-3 py-2 text-sm font-semibold text-green-900">
                  <CheckCircle size={20} weight="fill" /> บันทึกแล้ว · เก็บในเครื่องและส่งขึ้นระบบอัตโนมัติ
                </p>
              )}
              <div className="flex gap-2">
                <button type="button" onClick={resetAll} disabled={!!dayBlocked} className="flex min-h-[3.25rem] items-center gap-2 rounded-xl border-[1.5px] border-slate-300 bg-white px-4 font-semibold disabled:opacity-50">
                  <ArrowCounterClockwise size={20} /> {kind === "line" ? "ทุกคนมา" : "ทุกคน"}
                </button>
                <button type="button" onClick={save} disabled={saving || !!dayBlocked} className="min-h-[3.25rem] flex-1 rounded-xl bg-navy-700 text-base font-bold text-white disabled:bg-slate-300">
                  {saving ? "กำลังบันทึก…" : `บันทึก${KIND_LABEL[kind]} (${kind === "line" ? counts.total : counts.here} คน)`}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** ถ้ามีรายการที่บันทึกไว้ในเครื่องแต่ยังไม่ได้ส่ง ให้แสดงค่านั้น (ใหม่กว่าเซิร์ฟเวอร์) */
async function withPending(c: number, d: string, data: DayData): Promise<DayData> {
  const items = await pendingItems();
  const next: DayData = { line: { ...data.line }, milk: { ...data.milk }, brush: { ...data.brush }, sessions: { ...data.sessions } };
  for (const it of items) {
    if (it.rpc !== "save_daily" || it.args.p_classroom !== c || it.args.p_date !== d) continue;
    const k = it.args.p_kind as RecordKind;
    for (const e of it.args.p_entries as { s: string; v: number | boolean }[]) {
      if (k === "line") next.line[e.s] = e.v as number;
      else next[k][e.s] = e.v as boolean;
    }
    next.sessions[k] = new Date(it.createdAt).toISOString();
  }
  return next;
}
