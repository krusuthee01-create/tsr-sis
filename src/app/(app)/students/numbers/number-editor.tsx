"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowCounterClockwise, SortAscending } from "@phosphor-icons/react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { compareForNumbering, fullName, STUDENT_STATUSES } from "@/lib/domain";
import { Badge, Card } from "@/components/ui";
import { useToast } from "@/components/toast";

export type NumRow = { student_id: string; number: number | null; prefix: string | null; first_name: string; last_name: string; gender: string | null; student_code: string | null; status: string };

const byOld = (a: NumRow, b: NumRow) => (a.number ?? 999) - (b.number ?? 999) || a.first_name.localeCompare(b.first_name, "th");
const SORTS: { id: string; label: string; fn: (a: NumRow, b: NumRow) => number }[] = [
  { id: "gender", label: "ชายก่อนหญิง แล้วเรียงชื่อ", fn: compareForNumbering },
  { id: "name", label: "เรียงชื่อ ก–ฮ (ไม่แยกเพศ)", fn: (a, b) => (a.first_name + a.last_name).localeCompare(b.first_name + b.last_name, "th") },
  { id: "code", label: "เรียงเลขประจำตัวนักเรียน", fn: (a, b) => (Number(a.student_code) || 1e9) - (Number(b.student_code) || 1e9) },
];

/** ครูที่ปรึกษาจัดลำดับเลขที่: ลำดับในรายการ = เลขที่ 1, 2, 3 … (นักเรียนที่ไม่ได้กำลังศึกษาอยู่ท้ายห้อง) */
export function NumberEditor({ classroomId, roster }: { classroomId: number; roster: NumRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const initial = useMemo(() => [...roster.filter((r) => r.status === "studying").sort(byOld), ...roster.filter((r) => r.status !== "studying").sort(byOld)], [roster]);
  const [list, setList] = useState(initial);
  const [typing, setTyping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const active = list.filter((r) => r.status === "studying").length;
  const numbered = list.map((r, i) => ({ ...r, newNo: i + 1 }));
  const changed = numbered.filter((r) => r.number !== r.newNo).length;

  function moveTo(id: string, pos: number) {
    setList((xs) => {
      const from = xs.findIndex((r) => r.student_id === id);
      if (from < 0) return xs;
      const isActive = xs[from].status === "studying";
      // นักเรียนกำลังศึกษาย้ายได้ในช่วง 1..จำนวนที่กำลังศึกษา คนอื่นอยู่ท้ายห้อง
      const min = isActive ? 0 : active, max = isActive ? active - 1 : xs.length - 1;
      const to = Math.max(min, Math.min(max, pos - 1));
      const next = [...xs];
      const [r] = next.splice(from, 1);
      next.splice(to, 0, r);
      return next;
    });
  }
  function sortBy(fn: (a: NumRow, b: NumRow) => number) {
    setList((xs) => [...xs.filter((r) => r.status === "studying").sort(fn), ...xs.filter((r) => r.status !== "studying")]);
  }

  async function save() {
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("set_class_numbers", { p_classroom: classroomId, p_numbers: numbered.map((r) => ({ s: r.student_id, n: r.newNo })) });
    setBusy(false);
    if (error) return toast(error.message, "error");
    toast(`บันทึกเลขที่แล้ว (เปลี่ยน ${data} คน)`);
    router.refresh();
  }

  if (!roster.length) return <Card className="text-muted">ห้องนี้ยังไม่มีนักเรียน</Card>;
  return (
    <div className="flex flex-col gap-3 pb-28">
      <Card className="flex flex-col gap-3">
        <p className="text-sm text-muted">เลือกวิธีเรียงด้านล่าง หรือพิมพ์เลขที่ใหม่ในช่องของนักเรียน (หรือกดลูกศร) ระบบเลื่อนคนอื่นให้อัตโนมัติ เลขที่จะต่อเนื่อง 1–{active} เสมอ แล้วกดบันทึก</p>
        <div className="flex flex-wrap gap-2">
          {SORTS.map((s) => (
            <button key={s.id} type="button" onClick={() => sortBy(s.fn)} className="flex min-h-11 items-center gap-1.5 rounded-xl border-[1.5px] border-sky-300 bg-sky-50 px-3 text-sm font-semibold text-sky-900">
              <SortAscending size={18} weight="duotone" />{s.label}
            </button>
          ))}
          <button type="button" onClick={() => setList(initial)} className="flex min-h-11 items-center gap-1.5 rounded-xl border-[1.5px] border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700">
            <ArrowCounterClockwise size={18} />กลับเป็นเลขที่เดิม
          </button>
        </div>
      </Card>

      <Card className="p-0 md:p-0">
        <ol className="divide-y divide-slate-100">
          {numbered.map((r, i) => {
            const isActive = r.status === "studying";
            const moved = r.number !== r.newNo;
            return (
              <li key={r.student_id} className={`flex items-center gap-2 px-3 py-2 ${isActive ? "" : "bg-slate-50 text-muted"}`}>
                <label className="sr-only" htmlFor={`no-${r.student_id}`}>เลขที่ของ {r.first_name}</label>
                <input id={`no-${r.student_id}`} inputMode="numeric" disabled={!isActive}
                  className={`field-input min-h-11 w-16 shrink-0 text-center text-lg font-bold ${moved ? "border-amber-400 bg-amber-50" : ""}`}
                  value={typing[r.student_id] ?? String(r.newNo)}
                  onChange={(e) => setTyping((t) => ({ ...t, [r.student_id]: e.target.value.replace(/\D/g, "") }))}
                  onBlur={() => { const v = Number(typing[r.student_id]); if (v) moveTo(r.student_id, v); setTyping((t) => { const n = { ...t }; delete n[r.student_id]; return n; }); }}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{fullName(r, true)}</span>
                  <span className="text-xs text-muted">
                    {r.gender === "ช" ? "ชาย" : r.gender === "ญ" ? "หญิง" : ""}{r.student_code ? ` · รหัส ${r.student_code}` : ""}
                    {moved && <span className="font-semibold text-amber-700"> · เดิมเลขที่ {r.number ?? "-"}</span>}
                  </span>
                </span>
                {!isActive && <Badge tone={STUDENT_STATUSES[r.status]?.tone ?? "gray"}>{STUDENT_STATUSES[r.status]?.label ?? r.status}</Badge>}
                {isActive && (
                  <span className="flex shrink-0 gap-1">
                    <button type="button" aria-label={`เลื่อน ${r.first_name} ขึ้น`} disabled={i === 0} onClick={() => moveTo(r.student_id, r.newNo - 1)}
                      className="flex size-11 items-center justify-center rounded-xl border border-slate-300 bg-white disabled:opacity-30"><ArrowUp size={20} weight="bold" /></button>
                    <button type="button" aria-label={`เลื่อน ${r.first_name} ลง`} disabled={i === active - 1} onClick={() => moveTo(r.student_id, r.newNo + 1)}
                      className="flex size-11 items-center justify-center rounded-xl border border-slate-300 bg-white disabled:opacity-30"><ArrowDown size={20} weight="bold" /></button>
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </Card>

      <div className="no-print fixed inset-x-0 bottom-16 z-20 border-t border-line bg-white/95 px-3 pb-3 pt-2 backdrop-blur lg:bottom-0 lg:left-auto lg:w-[calc(100%-16rem)]">
        <div className="mx-auto max-w-3xl">
          <button type="button" onClick={save} disabled={busy || !changed} className="min-h-[3.25rem] w-full rounded-xl bg-navy-700 text-base font-bold text-white disabled:bg-slate-300">
            {busy ? "กำลังบันทึก…" : changed ? `บันทึกเลขที่ใหม่ (เปลี่ยน ${changed} คน)` : "ยังไม่มีการเปลี่ยนแปลง"}
          </button>
        </div>
      </div>
    </div>
  );
}
