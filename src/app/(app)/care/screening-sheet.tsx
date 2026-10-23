"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, Lightbulb } from "@phosphor-icons/react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { DOMAINS, LEVELS, type DomainKey } from "@/lib/care";
import { fullName } from "@/lib/domain";
import { formatThaiDateTime } from "@/lib/thai-date";
import { WFH, HFA } from "@/lib/nutrition";
import { useToast } from "@/components/toast";

export type SuggestionRow = {
  student_id: string; number: number | null; prefix: string | null; first_name: string; last_name: string;
  attendance_pct: number | null; wfh: number | null; hfa: number | null; wfa: number | null; sdq_level: number | null;
  income_per_person: number | null; safety_risk: boolean; visited: boolean;
  s_learning: number; s_health: number; s_economic: number; s_safety: number; s_behavior: number;
  learning: number | null; health: number | null; economic: number | null; safety: number | null; behavior: number | null;
  talent: string | null; notes: Record<string, string> | null; confirmed_at: string | null; last_action: string | null;
};

type Draft = Record<DomainKey, number> & { talent: string; notes: Record<string, string> };

function evidence(r: SuggestionRow, k: DomainKey): string {
  switch (k) {
    case "learning": return r.attendance_pct === null ? "ยังไม่มีข้อมูลการมาเรียน" : `มาเรียน ${r.attendance_pct}%`;
    case "health": return r.wfh || r.hfa ? [r.wfh ? WFH[r.wfh].label : "", r.hfa && r.hfa < 3 ? HFA[r.hfa].label : ""].filter(Boolean).join(" · ") : "ยังไม่มีข้อมูลน้ำหนัก/ส่วนสูง";
    case "economic": return r.income_per_person === null ? (r.visited ? "ไม่ได้บันทึกรายได้" : "ยังไม่ได้เยี่ยมบ้าน") : `รายได้ ${r.income_per_person.toLocaleString("th-TH")} บาท/คน/เดือน`;
    case "safety": return r.visited ? (r.safety_risk ? "พบความเสี่ยงตอนเยี่ยมบ้าน" : "ไม่พบความเสี่ยงตอนเยี่ยมบ้าน") : "ยังไม่ได้เยี่ยมบ้าน";
    case "behavior": return r.sdq_level ? `SDQ ฉบับครู: ${LEVELS[r.sdq_level].label}` : "ยังไม่ได้ทำ SDQ";
  }
}

/** คัดกรอง 6 ด้าน: ระบบเสนอผลจากข้อมูลที่มีอยู่แล้ว ครูที่ปรึกษายืนยันหรือแก้ไข พร้อมเหตุผล */
export function ScreeningSheet({ classroomId, room, rows, canEdit }: { classroomId: number; room: string; rows: SuggestionRow[]; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [draft, setDraft] = useState<Record<string, Draft>>(() => Object.fromEntries(rows.map((r) => [r.student_id, {
    learning: r.learning ?? r.s_learning, health: r.health ?? r.s_health, economic: r.economic ?? r.s_economic,
    safety: r.safety ?? r.s_safety, behavior: r.behavior ?? r.s_behavior, talent: r.talent ?? "", notes: r.notes ?? {},
  }])));
  const [busy, setBusy] = useState(false);
  const confirmed = rows.filter((r) => r.confirmed_at).length;
  const counts = useMemo(() => {
    const c = { 1: 0, 2: 0, 3: 0 } as Record<number, number>;
    for (const d of Object.values(draft)) c[Math.max(d.learning, d.health, d.economic, d.safety, d.behavior)] += 1;
    return c;
  }, [draft]);

  function set(id: string, k: DomainKey, v: number) {
    setDraft((x) => ({ ...x, [id]: { ...x[id], [k]: v } }));
  }

  async function save() {
    const missing = rows.find((r) => DOMAINS.some((d) => {
      const v = draft[r.student_id][d.key];
      const suggested = r[`s_${d.key}` as const];
      return v !== suggested && v >= 2 && !draft[r.student_id].notes[d.key]?.trim();
    }));
    if (missing) return toast(`กรุณาระบุเหตุผลของ ${fullName(missing, true)} ในด้านที่ปรับเป็นเสี่ยง/มีปัญหาเอง`, "error");
    setBusy(true);
    const payload = rows.map((r) => ({ s: r.student_id, ...draft[r.student_id] }));
    const { data, error } = await supabaseBrowser().rpc("save_screenings", { p_classroom: classroomId, p_rows: payload });
    setBusy(false);
    if (error) return toast(error.message, "error");
    toast(`ยืนยันผลคัดกรอง ${data} คนแล้ว`);
    router.refresh();
  }

  if (!rows.length) return <p className="rounded-2xl bg-white p-6 text-center text-muted">ห้องนี้ยังไม่มีนักเรียน</p>;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 rounded-[1.25rem] bg-white p-4 shadow-sm">
        <Lightbulb size={28} weight="duotone" className="shrink-0 text-amber-500" />
        <p className="min-w-0 flex-1 text-sm text-muted">ระบบเสนอผลจากข้อมูลที่มีอยู่แล้ว (การมาเรียน โภชนาการ SDQ เยี่ยมบ้าน) ครูตรวจแล้วแตะเปลี่ยนได้ ถ้าปรับเป็นเสี่ยง/มีปัญหาเอง ให้ใส่เหตุผล</p>
        <div className="flex gap-2">
          {[1, 2, 3].map((l) => <span key={l} className="rounded-xl px-3 py-1.5 text-sm font-bold" style={{ background: LEVELS[l].bg, color: LEVELS[l].fg }}>{LEVELS[l].label} {counts[l]}</span>)}
        </div>
      </div>
      <p className="px-1 text-sm text-muted">{room} · ยืนยันแล้ว {confirmed}/{rows.length} คน</p>

      <ul className="flex flex-col gap-3 pb-32 lg:pb-24">
        {rows.map((r) => {
          const d = draft[r.student_id];
          return (
            <li key={r.student_id} className="rounded-2xl border border-line bg-white p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-lg bg-slate-100 text-sm font-semibold">{r.number ?? "-"}</span>
                <span className="flex-1 font-semibold">{fullName(r, true)}</span>
                {r.confirmed_at ? <span className="flex items-center gap-1 text-xs text-green-700"><CheckCircle size={16} weight="fill" />ยืนยัน {formatThaiDateTime(r.confirmed_at)}</span> : <span className="text-xs font-semibold text-amber-700">ยังไม่ยืนยัน</span>}
              </div>
              <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                {DOMAINS.map((dm) => {
                  const suggested = r[`s_${dm.key}` as const];
                  const changed = d[dm.key] !== suggested;
                  return (
                    <div key={dm.key} className="rounded-xl bg-slate-50 p-2.5">
                      <div className="mb-1.5 flex items-baseline justify-between gap-2">
                        <span className="text-sm font-semibold">{dm.label}</span>
                        <span className="truncate text-xs text-muted" title={dm.hint}>{evidence(r, dm.key)}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-label={`${dm.label} ของ ${r.first_name}`}>
                        {[1, 2, 3].map((l) => (
                          <button key={l} type="button" role="radio" aria-checked={d[dm.key] === l} disabled={!canEdit} onClick={() => set(r.student_id, dm.key, l)}
                            className="min-h-10 rounded-lg border-[1.5px] text-sm font-bold"
                            style={d[dm.key] === l ? { background: LEVELS[l].bg, color: LEVELS[l].fg, borderColor: LEVELS[l].fg } : { background: "#fff", color: "#64748B", borderColor: "#E2E8F0" }}>
                            {LEVELS[l].label}{l === suggested ? " •" : ""}
                          </button>
                        ))}
                      </div>
                      {changed && d[dm.key] >= 2 && (
                        <input className="field-input mt-1.5 min-h-10 text-sm" placeholder="เหตุผลที่ปรับ (จำเป็น)" value={d.notes[dm.key] ?? ""} disabled={!canEdit}
                          onChange={(e) => setDraft((x) => ({ ...x, [r.student_id]: { ...d, notes: { ...d.notes, [dm.key]: e.target.value } } }))} />
                      )}
                    </div>
                  );
                })}
                <label className="rounded-xl bg-slate-50 p-2.5 text-sm font-semibold">ความสามารถพิเศษ (ถ้ามี)
                  <input className="field-input mt-1.5 min-h-10 font-normal" placeholder="เช่น วาดภาพ ดนตรี กีฬา" value={d.talent} disabled={!canEdit}
                    onChange={(e) => setDraft((x) => ({ ...x, [r.student_id]: { ...d, talent: e.target.value } }))} />
                </label>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="px-1 text-xs text-muted">• = ระดับที่ระบบเสนอ</p>
      {canEdit && (
        <div className="no-print fixed inset-x-0 bottom-16 z-20 border-t border-line bg-white/95 px-3 pb-3 pt-2 backdrop-blur lg:bottom-0 lg:left-auto lg:w-[calc(100%-16rem)]">
          <div className="mx-auto max-w-6xl">
            <button type="button" onClick={save} disabled={busy} className="min-h-[3.25rem] w-full rounded-xl bg-navy-700 text-base font-bold text-white disabled:bg-slate-300">
              {busy ? "กำลังบันทึก…" : `ยืนยันผลคัดกรองทั้งห้อง (${rows.length} คน)`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
