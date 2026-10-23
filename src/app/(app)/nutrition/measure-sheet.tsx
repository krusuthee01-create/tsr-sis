"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, CloudSlash, Warning } from "@phosphor-icons/react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cacheGet, cachePut, enqueue, flushQueue, pendingItems } from "@/lib/offline-queue";
import { fullName } from "@/lib/domain";
import { formatThaiDate } from "@/lib/thai-date";
import { ageInMonths, classify, HFA, measureWarnings, parseMeasure, refMaps, TONE_STYLE, WFA, WFH, type AgeRef, type HeightRef } from "@/lib/nutrition";
import { Spinner } from "@/components/ui";
import { useToast } from "@/components/toast";

type Row = {
  student_id: string; number: number | null; prefix: string | null; first_name: string; last_name: string;
  gender: string | null; birth_date: string | null; weight: number | null; height: number | null;
  prev_weight: number | null; prev_height: number | null; prev_round: string | null;
};
type Refs = { age: AgeRef[]; height: HeightRef[] };

/** กรอกน้ำหนัก/ส่วนสูงทั้งห้อง แสดงผลการแปลผลทันที และเตือนค่าผิดปกติ */
export function MeasureSheet({ classroomId, classroomLabel, round, today, alertKg }: {
  classroomId: number; classroomLabel: string; round: { id: number; name: string; start_date: string; end_date: string }; today: string; alertKg: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [refs, setRefs] = useState<Refs | null>(null);
  const [input, setInput] = useState<Record<string, { w: string; h: string }>>({});
  const [date, setDate] = useState(today > round.end_date ? round.end_date : today < round.start_date ? round.start_date : today);
  const [offline, setOffline] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const sb = supabaseBrowser();
      const key = `nutrition:${classroomId}:${round.id}`;
      let list: Row[] | undefined;
      let r: Refs | undefined;
      try {
        const [roster, age, height] = await Promise.all([
          sb.rpc("nutrition_roster", { p_classroom: classroomId, p_round: round.id }),
          sb.from("growth_ref_age").select("sex, age_months, w_m2, w_m15, w_p15, w_p2, h_m2, h_m15, h_p15, h_p2"),
          sb.from("growth_ref_height").select("sex, height_cm, m2, m15, p15, p2, p3"),
        ]);
        if (roster.error) throw roster.error;
        list = roster.data as Row[];
        r = { age: (age.data ?? []) as AgeRef[], height: (height.data ?? []) as HeightRef[] };
        await Promise.all([cachePut(key, list), cachePut("growth-refs", r)]);
      } catch (e) {
        list = await cacheGet<Row[]>(key);
        r = await cacheGet<Refs>("growth-refs");
        if (!list) {
          if (alive) { setRows([]); toast(e instanceof Error && !/fetch/i.test(e.message) ? e.message : "โหลดรายชื่อไม่ได้ กรุณาต่ออินเทอร์เน็ต", "error"); }
          return;
        }
        if (alive) setOffline(true);
      }
      const init: Record<string, { w: string; h: string }> = {};
      for (const s of list) init[s.student_id] = { w: s.weight?.toString() ?? "", h: s.height?.toString() ?? "" };
      // ค่าที่บันทึกในเครื่องแต่ยังไม่ได้ส่ง
      for (const it of await pendingItems()) {
        if (it.rpc !== "save_measurements" || it.args.p_classroom !== classroomId || it.args.p_round !== round.id) continue;
        for (const e of it.args.p_entries as { s: string; w: number | null; h: number | null }[]) init[e.s] = { w: e.w?.toString() ?? "", h: e.h?.toString() ?? "" };
      }
      if (!alive) return;
      setRows(list);
      setRefs(r ?? { age: [], height: [] });
      setInput(init);
    })();
    return () => { alive = false; };
  }, [classroomId, round.id, toast]);

  const maps = useMemo(() => (refs ? refMaps(refs.age, refs.height) : null), [refs]);
  const view = useMemo(() => (rows ?? []).map((s) => {
    const v = input[s.student_id] ?? { w: "", h: "" };
    const w = parseMeasure(v.w);
    const h = parseMeasure(v.h);
    const sex = s.gender === "ช" ? 1 : s.gender === "ญ" ? 2 : null;
    const age = ageInMonths(s.birth_date, date);
    const ok = (x: number | null) => (x === null || Number.isNaN(x) ? null : x);
    const res = maps ? classify(sex, age, ok(w), ok(h), maps.ageRef, maps.heightRef) : { wfa: null, hfa: null, wfh: null };
    const warnings = measureWarnings(w, h, { weight: s.prev_weight, height: s.prev_height }, alertKg);
    return { s, w, h, age, res, warnings };
  }), [rows, input, date, maps, alertKg]);

  const done = view.filter((v) => v.w !== null || v.h !== null).length;
  const errors = view.filter((v) => v.warnings.some((x) => x.level === "error")).length;

  async function save() {
    if (!rows) return;
    if (errors) return toast(`มีค่าที่ต้องแก้ ${errors} คน (กรอบสีแดง)`, "error");
    setSaving(true);
    const entries = view
      .filter((v) => v.w !== null || v.h !== null || v.s.weight !== null || v.s.height !== null)
      .map((v) => ({ s: v.s.student_id, w: v.w, h: v.h }));
    await enqueue({
      key: `measure:${classroomId}:${round.id}`, rpc: "save_measurements",
      label: `${classroomLabel} น้ำหนัก/ส่วนสูง ${round.name}`,
      args: { p_classroom: classroomId, p_round: round.id, p_date: date, p_entries: entries },
    });
    setSaved(true);
    setSaving(false);
    const r = await flushQueue();
    if (r.failed.length) toast(`ระบบไม่รับข้อมูล: ${r.failed[0].error}`, "error");
    else if (r.sent) router.refresh();
  }

  if (!rows) return <Spinner label="กำลังโหลดรายชื่อ" />;
  if (!rows.length) return <p className="rounded-2xl bg-white p-6 text-center text-muted">ห้องนี้ยังไม่มีนักเรียน</p>;

  const chip = (map: Record<number, { short: string; tone: keyof typeof TONE_STYLE }>, v: number | null, title: string) => v ? (
    <span title={title} className="whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: TONE_STYLE[map[v].tone].bg, color: TONE_STYLE[map[v].tone].fg }}>{map[v].short}</span>
  ) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3 rounded-[1.25rem] bg-white p-3 shadow-sm">
        <label className="flex flex-col gap-1 text-sm font-semibold">วันที่ชั่ง/วัด <span className="font-normal text-muted">({formatThaiDate(date)})</span>
          <input type="date" className="field-input" value={date} min={round.start_date} max={today < round.end_date ? today : round.end_date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        <div className="flex-1 text-sm text-muted">
          <p>รอบ <b className="text-ink">{round.name}</b> · กรอกแล้ว <b className="text-ink">{done}/{rows.length}</b> คน</p>
          <p>น้ำหนักเป็นกิโลกรัม (เช่น 18.5) ส่วนสูงเป็นเซนติเมตร (เช่น 112) · เว้นว่างได้ถ้ายังไม่ได้ชั่ง</p>
        </div>
      </div>
      {offline && <p className="flex items-center gap-2 rounded-xl bg-amber-100 px-3 py-2 text-sm font-medium text-amber-950"><CloudSlash size={20} weight="duotone" /> ไม่มีสัญญาณ: ใช้รายชื่อที่จำไว้ในเครื่อง บันทึกได้ตามปกติ</p>}

      <ul className="flex flex-col gap-2 pb-36 lg:pb-24">
        {view.map(({ s, age, res, warnings }) => {
          const v = input[s.student_id] ?? { w: "", h: "" };
          const bad = warnings.some((x) => x.level === "error");
          const set = (k: "w" | "h", val: string) => { setSaved(false); setInput((x) => ({ ...x, [s.student_id]: { ...v, [k]: val } })); };
          return (
            <li key={s.student_id} className={`rounded-2xl border bg-white p-3 ${bad ? "border-red-400" : warnings.length ? "border-amber-300" : "border-line"}`}>
              <div className="flex items-start gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-sm font-semibold">{s.number ?? "-"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{fullName(s, true)}</span>
                  <span className="block text-xs text-muted">
                    {age !== null ? `${Math.floor(age / 12)} ปี ${age % 12} เดือน` : "ไม่มีวันเกิด"}
                    {s.prev_round ? ` · ครั้งก่อน (${s.prev_round}) ${s.prev_weight ?? "-"} กก. / ${s.prev_height ?? "-"} ซม.` : ""}
                  </span>
                </span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 pl-11 sm:max-w-sm">
                <label className="relative block">
                  <span className="sr-only">น้ำหนัก {s.first_name} (กิโลกรัม)</span>
                  <input inputMode="decimal" enterKeyHint="next" placeholder="น้ำหนัก" value={v.w} onChange={(e) => set("w", e.target.value)} aria-invalid={bad}
                    className="field-input pr-10 text-center text-lg font-semibold" />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted" aria-hidden>กก.</span>
                </label>
                <label className="relative block">
                  <span className="sr-only">ส่วนสูง {s.first_name} (เซนติเมตร)</span>
                  <input inputMode="decimal" enterKeyHint="next" placeholder="ส่วนสูง" value={v.h} onChange={(e) => set("h", e.target.value)} aria-invalid={bad}
                    className="field-input pr-10 text-center text-lg font-semibold" />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted" aria-hidden>ซม.</span>
                </label>
              </div>
              {(res.wfa || res.hfa || res.wfh || warnings.length > 0) && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-11">
                  {!bad && chip(WFH, res.wfh, "น้ำหนักตามส่วนสูง")}
                  {!bad && chip(WFA, res.wfa, "น้ำหนักตามอายุ")}
                  {!bad && chip(HFA, res.hfa, "ส่วนสูงตามอายุ")}
                  {warnings.map((x, i) => (
                    <span key={i} className={`flex items-center gap-1 text-xs font-semibold ${x.level === "error" ? "text-red-700" : "text-amber-800"}`}>
                      <Warning size={14} weight="fill" />{x.text}
                    </span>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="no-print fixed inset-x-0 bottom-16 z-20 border-t border-line bg-white/95 px-3 pb-3 pt-2 backdrop-blur lg:bottom-0 lg:left-auto lg:w-[calc(100%-16rem)]">
        <div className="mx-auto flex max-w-5xl flex-col gap-2">
          {saved && <p role="status" className="flex items-center gap-2 rounded-xl bg-green-100 px-3 py-2 text-sm font-semibold text-green-900"><CheckCircle size={20} weight="fill" /> บันทึกแล้ว · เก็บในเครื่องและส่งขึ้นระบบอัตโนมัติ</p>}
          <button type="button" onClick={save} disabled={saving} className="min-h-[3.25rem] rounded-xl bg-navy-700 text-base font-bold text-white disabled:bg-slate-300">
            {saving ? "กำลังบันทึก…" : `บันทึกน้ำหนัก/ส่วนสูง (${done} คน)`}
          </button>
        </div>
      </div>
    </div>
  );
}
