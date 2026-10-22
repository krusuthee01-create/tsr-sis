"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

const STEPS = [0.9, 1, 1.125, 1.25, 1.4];

function apply(scale: number) {
  document.documentElement.style.setProperty("--font-scale", String(scale));
  try { localStorage.setItem("tsr-font-scale", String(scale)); } catch {}
}

/** ปุ่ม A− / A+ ปรับขนาดตัวอักษรทั้งระบบ และจำค่าไว้ในบัญชีของผู้ใช้ */
export function FontSizeControl({ initial }: { initial: number }) {
  const [scale, setScale] = useState(initial);

  useEffect(() => {
    let local: number | null = null;
    try { local = Number(localStorage.getItem("tsr-font-scale")) || null; } catch {}
    const s = local ?? initial;
    setScale(s);
    apply(s);
  }, [initial]);

  function change(dir: 1 | -1) {
    const i = STEPS.findIndex((s) => s >= scale - 0.001);
    const next = STEPS[Math.min(STEPS.length - 1, Math.max(0, (i === -1 ? 1 : i) + dir))];
    setScale(next);
    apply(next);
    supabaseBrowser().rpc("update_my_prefs", { p_font_scale: next }).then(() => {});
  }

  return (
    <div className="flex items-center gap-0.5 rounded-xl bg-slate-100 p-1" role="group" aria-label="ขนาดตัวอักษร">
      <button type="button" onClick={() => change(-1)} disabled={scale <= STEPS[0]} aria-label="ลดขนาดตัวอักษร"
        className="size-9 rounded-lg text-sm font-bold text-slate-700 hover:bg-white disabled:opacity-40">A−</button>
      <button type="button" onClick={() => change(1)} disabled={scale >= STEPS[STEPS.length - 1]} aria-label="เพิ่มขนาดตัวอักษร"
        className="size-9 rounded-lg bg-white text-base font-bold text-navy-700 shadow-sm disabled:opacity-40">A+</button>
    </div>
  );
}
