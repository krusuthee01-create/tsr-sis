"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { EQ_DOMAINS, EQ_LEVELS, eqLevel } from "@/lib/care";
import { Card } from "@/components/ui";
import { useToast } from "@/components/toast";

type Values = { version: string; good: number | null; smart: number | null; happy: number | null };

/** กรอกคะแนนรวมรายด้าน ดี เก่ง สุข จากแบบประเมิน EQ ฉบับกรมสุขภาพจิต */
export function EqForm({ studentId, term, initial, ranges, backHref }: {
  studentId: string; term: number; initial: Values; ranges: Record<string, Record<string, number[]>>; backHref: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [v, setV] = useState<Values>(initial);
  const [text, setText] = useState<Record<string, string>>({ good: initial.good?.toString() ?? "", smart: initial.smart?.toString() ?? "", happy: initial.happy?.toString() ?? "" });
  const [busy, setBusy] = useState(false);
  const rng = ranges[v.version] ?? {};
  const hasRanges = EQ_DOMAINS.some((d) => (rng[d.key]?.length ?? 0) >= 2);

  function setScore(k: string, raw: string) {
    setText((t) => ({ ...t, [k]: raw }));
    const n = raw.trim() === "" ? null : Number(raw);
    setV((x) => ({ ...x, [k]: n !== null && Number.isFinite(n) ? n : null }));
  }

  async function save() {
    const bad = EQ_DOMAINS.find((d) => text[d.key].trim() === "" || v[d.key] === null || (v[d.key] as number) < 0 || (v[d.key] as number) > 999);
    if (bad) return toast(`กรุณากรอกคะแนนด้าน${bad.label}ให้ถูกต้อง`, "error");
    setBusy(true);
    const { error } = await supabaseBrowser().rpc("save_eq", { p_student: studentId, p_term: term, p_version: v.version, p_good: v.good, p_smart: v.smart, p_happy: v.happy });
    setBusy(false);
    if (error) return toast(error.message, "error");
    toast("บันทึกผล EQ แล้ว");
    router.push(backHref);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <Card className="bg-pink-50 text-sm text-pink-950">
        ทำแบบประเมิน EQ ฉบับกรมสุขภาพจิตตามคู่มือ รวมคะแนนแต่ละด้านในกระดาษ แล้วกรอกเฉพาะ<b>คะแนนรวมรายด้าน</b> ระบบแปลผลตามช่วงปกติที่ผู้ดูแลระบบตั้งไว้
      </Card>
      <Card className="flex flex-col gap-4">
        <div>
          <p className="mb-1.5 text-sm font-semibold">ฉบับแบบประเมิน</p>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="ฉบับแบบประเมิน">
            {[{ id: "3-5", label: "อายุ 3–5 ปี" }, { id: "6-11", label: "อายุ 6–11 ปี" }].map((o) => (
              <button key={o.id} type="button" role="radio" aria-checked={v.version === o.id} onClick={() => setV((x) => ({ ...x, version: o.id }))}
                className={`min-h-12 rounded-xl border-[1.5px] font-bold ${v.version === o.id ? "border-pink-600 bg-pink-600 text-white" : "border-slate-300 bg-white text-slate-700"}`}>{o.label}</button>
            ))}
          </div>
        </div>
        {EQ_DOMAINS.map((d) => {
          const lv = eqLevel(v[d.key], rng[d.key]);
          const r = rng[d.key];
          return (
            <label key={d.key} className="flex flex-col gap-1.5">
              <span className="flex items-center justify-between gap-2 font-semibold">
                ด้าน{d.label}
                {r?.length === 2 && <span className="text-xs font-normal text-muted">ช่วงปกติ {r[0]}–{r[1]}</span>}
              </span>
              <div className="flex items-center gap-2">
                <input className="field-input text-lg" inputMode="decimal" placeholder="คะแนนรวมด้านนี้" value={text[d.key]} onChange={(e) => setScore(d.key, e.target.value)} />
                {lv !== null && <span className="shrink-0 rounded-full px-3 py-1.5 text-sm font-bold" style={{ background: EQ_LEVELS[lv].bg, color: EQ_LEVELS[lv].fg }}>{EQ_LEVELS[lv].label}</span>}
              </div>
            </label>
          );
        })}
        {!hasRanges && (
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            ยังไม่ได้ตั้งช่วงคะแนนปกติของฉบับนี้ ระบบจะบันทึกคะแนนไว้ก่อน และแปลผลให้อัตโนมัติเมื่อผู้ดูแลระบบตั้งค่าที่ <Link className="font-semibold underline" href="/settings?s=care">ตั้งค่า › เกณฑ์ดูแลช่วยเหลือ</Link>
          </p>
        )}
        <button type="button" onClick={save} disabled={busy} className="min-h-[3.25rem] rounded-xl bg-navy-700 text-base font-bold text-white disabled:bg-slate-300">
          {busy ? "กำลังบันทึก…" : "บันทึกผล EQ"}
        </button>
      </Card>
    </div>
  );
}
