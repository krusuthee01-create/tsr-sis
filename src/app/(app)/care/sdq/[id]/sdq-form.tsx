"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { LEVELS, SDQ_REVERSED, SDQ_SCALES, sdqScore } from "@/lib/care";
import { Card } from "@/components/ui";
import { useToast } from "@/components/toast";

const CHOICES = [
  { v: 0, label: "ไม่จริง" },
  { v: 1, label: "ค่อนข้างจริง" },
  { v: 2, label: "จริงแน่นอน" },
];

/** กรอกคำตอบ SDQ 25 ข้อ ตามช่องที่ทำเครื่องหมายในแบบประเมินกระดาษ — ระบบกลับคะแนนข้อกลับให้เอง */
export function SdqForm({ studentId, term, informant, initial, cutoffs, backHref }: {
  studentId: string; term: number; informant: string; initial: number[] | null; cutoffs?: Record<string, number[]>; backHref: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [answers, setAnswers] = useState<(number | null)[]>(initial ?? Array(25).fill(null));
  const [busy, setBusy] = useState(false);
  const done = answers.filter((a) => a !== null).length;
  const score = useMemo(() => sdqScore(answers, cutoffs), [answers, cutoffs]);

  async function save() {
    if (done < 25) return toast(`ยังไม่ได้ตอบ ${25 - done} ข้อ (ข้อ ${answers.map((a, i) => (a === null ? i + 1 : null)).filter(Boolean).slice(0, 5).join(", ")})`, "error");
    setBusy(true);
    const { error } = await supabaseBrowser().rpc("save_sdq", { p_student: studentId, p_term: term, p_informant: informant, p_answers: answers });
    setBusy(false);
    if (error) return toast(error.message, "error");
    toast("บันทึกผล SDQ แล้ว");
    router.push(backHref);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3 pb-40 lg:pb-28">
      <Card className="bg-pink-50 text-sm text-pink-950">
        ใช้แบบประเมิน SDQ ฉบับกรมสุขภาพจิต ({informant === "teacher" ? "ฉบับครู" : informant === "parent" ? "ฉบับผู้ปกครอง" : "ฉบับนักเรียน"}) ที่ทำไว้
        แล้วแตะช่องให้ตรงกับที่ทำเครื่องหมายในแต่ละข้อ <b>ไม่ต้องกลับคะแนนเอง</b> ระบบกลับคะแนนข้อ {SDQ_REVERSED.join(", ")} ให้อัตโนมัติ
      </Card>
      <ol className="flex flex-col gap-2">
        {answers.map((a, i) => (
          <li key={i} className={`flex flex-wrap items-center gap-2 rounded-2xl border bg-white p-2.5 ${a === null ? "border-line" : "border-pink-200"}`}>
            <span className="w-14 shrink-0 font-semibold">ข้อ {i + 1}</span>
            <div className="grid flex-1 grid-cols-3 gap-1.5" role="radiogroup" aria-label={`ข้อ ${i + 1}`}>
              {CHOICES.map((c) => (
                <button key={c.v} type="button" role="radio" aria-checked={a === c.v}
                  onClick={() => setAnswers((x) => x.map((y, j) => (j === i ? c.v : y)))}
                  className={`min-h-11 rounded-xl border-[1.5px] text-sm font-bold ${a === c.v ? "border-pink-600 bg-pink-600 text-white" : "border-slate-300 bg-white text-slate-700"}`}>
                  {c.label}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ol>

      <div className="no-print fixed inset-x-0 bottom-16 z-20 border-t border-line bg-white/95 px-3 pb-3 pt-2 backdrop-blur lg:bottom-0 lg:left-auto lg:w-[calc(100%-16rem)]">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          {score ? (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="rounded-full px-2.5 py-1 font-bold" style={score.levels.total ? { background: LEVELS[score.levels.total].bg, color: LEVELS[score.levels.total].fg } : {}}>
                รวมปัญหา {score.total} {score.levels.total ? `· ${LEVELS[score.levels.total].label}` : ""}
              </span>
              {SDQ_SCALES.map((s) => {
                const lv = score.levels[s.key];
                return <span key={s.key} className="rounded-full px-2 py-1" style={lv ? { background: LEVELS[lv].bg, color: LEVELS[lv].fg } : { background: "#F1F5F9" }}>{s.label.replace("ด้าน", "")} {score[s.key]}</span>;
              })}
            </div>
          ) : <p className="text-sm text-muted">ตอบแล้ว {done}/25 ข้อ</p>}
          <button type="button" onClick={save} disabled={busy} className="min-h-[3.25rem] rounded-xl bg-navy-700 text-base font-bold text-white disabled:bg-slate-300">
            {busy ? "กำลังบันทึก…" : done < 25 ? `บันทึก (ตอบแล้ว ${done}/25)` : "บันทึกผล SDQ"}
          </button>
        </div>
      </div>
    </div>
  );
}
