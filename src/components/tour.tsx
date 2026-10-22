"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckSquare, Student, Question, DeviceMobile, HandWaving } from "@phosphor-icons/react";
import { supabaseBrowser } from "@/lib/supabase/client";

const STEPS = [
  { icon: HandWaving, color: "#1E3A8A", title: "ยินดีต้อนรับสู่ TSR-SIS", text: "ระบบสารสนเทศนักเรียนของโรงเรียน ใช้ได้ทั้งมือถือ iPad และคอมพิวเตอร์ ทัวร์นี้ใช้เวลาประมาณ 1 นาที" },
  { icon: CheckSquare, color: "#16A34A", title: "เช็กชื่อทุกเช้าในไม่ถึง 1 นาที", text: "ระบบตั้งให้ทุกคน \"มา\" ไว้แล้ว แตะเฉพาะเด็กที่ไม่มา แล้วกดบันทึก ดื่มนมและแปรงฟันตัดคนที่ไม่มาออกให้เอง" },
  { icon: Student, color: "#0284C7", title: "ข้อมูลนักเรียนมาจาก DMC", text: "ไม่ต้องพิมพ์ข้อมูลนักเรียนซ้ำ ผู้ดูแลระบบนำเข้าจาก DMC ครูดูประวัติและการมาเรียนได้ทันที" },
  { icon: DeviceMobile, color: "#EA580C", title: "ไม่มีสัญญาณก็บันทึกได้", text: "ระบบเก็บไว้ในเครื่องแล้วส่งให้เองเมื่อกลับมาออนไลน์ แนะนำให้ติดตั้งเป็นแอปบนหน้าจอโฮม (ดูวิธีในคู่มือ)" },
  { icon: Question, color: "#DB2777", title: "ติดตรงไหน กดปุ่ม ?", text: "ทุกหน้ามีปุ่ม ? อธิบายวิธีใช้หน้านั้น และมีหน้า \"คู่มือการใช้งาน\" รวมทุกเรื่อง ปรับขนาดตัวอักษรได้ที่ปุ่ม A− / A+" },
];

/** ทัวร์แนะนำครั้งแรกที่ครูเข้าระบบ */
export function Tour() {
  const [step, setStep] = useState(0);
  const [hidden, setHidden] = useState(false);
  const router = useRouter();
  if (hidden) return null;
  const s = STEPS[step];
  const Ico = s.icon;
  const last = step === STEPS.length - 1;

  async function finish() {
    setHidden(true);
    await supabaseBrowser().rpc("update_my_prefs", { p_tour_done: true });
    router.refresh();
  }

  return (
    <div className="no-print fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex size-16 items-center justify-center rounded-2xl" style={{ background: s.color + "1A", color: s.color }}>
          <Ico size={36} weight="duotone" />
        </div>
        <h2 id="tour-title" className="mb-2 text-xl font-semibold">{s.title}</h2>
        <p className="mb-6 text-[0.9375rem] text-muted">{s.text}</p>
        <div className="mb-5 flex gap-1.5" aria-label={`ขั้นที่ ${step + 1} จาก ${STEPS.length}`}>
          {STEPS.map((_, i) => <span key={i} className={`h-2 flex-1 rounded-full ${i <= step ? "bg-navy-700" : "bg-slate-200"}`} />)}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={finish} className="min-h-12 rounded-xl px-4 font-semibold text-muted hover:bg-slate-100">ข้าม</button>
          <div className="flex-1" />
          {step > 0 && <button type="button" onClick={() => setStep(step - 1)} className="min-h-12 rounded-xl border-[1.5px] border-slate-300 px-4 font-semibold">ย้อนกลับ</button>}
          <button type="button" onClick={() => (last ? finish() : setStep(step + 1))} className="min-h-12 rounded-xl bg-navy-700 px-5 font-semibold text-white">
            {last ? "เริ่มใช้งาน" : "ถัดไป"}
          </button>
        </div>
      </div>
    </div>
  );
}
