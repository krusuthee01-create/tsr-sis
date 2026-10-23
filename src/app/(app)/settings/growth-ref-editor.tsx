"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileArrowUp, CheckCircle } from "@phosphor-icons/react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { readSheet } from "@/lib/excel";
import { parseAgeSheet, parseHeightSheet, type AgeRefRow, type HeightRefRow } from "@/lib/growth-ref";
import { Button, Field } from "@/components/ui";
import { useToast } from "@/components/toast";

/** เปลี่ยนตารางเกณฑ์อ้างอิงการเจริญเติบโต (นำเข้าจากไฟล์ที่มีชีต age และ ht) */
export function GrowthRefEditor({ name, ageCount, heightCount, alertKg }: { name: string; ageCount: number; heightCount: number; alertKg: number }) {
  const router = useRouter();
  const toast = useToast();
  const [data, setData] = useState<{ age: AgeRefRow[]; height: HeightRefRow[]; file: string; warnings: string[] } | null>(null);
  const [newName, setNewName] = useState("เกณฑ์อ้างอิงการเจริญเติบโต กรมอนามัย 2564");
  const [busy, setBusy] = useState(false);
  const [kg, setKg] = useState(alertKg);

  async function onFile(file?: File) {
    if (!file) return;
    try {
      const a = await readSheet(file, "age");
      if (!a.sheetNames.includes("age") || !a.sheetNames.includes("ht")) return toast("ไฟล์ต้องมีชีตชื่อ \"age\" และ \"ht\" (รูปแบบเดียวกับโปรแกรม ปพ.5)", "error");
      const h = await readSheet(file, "ht");
      const age = parseAgeSheet(a.rows);
      const height = parseHeightSheet(h.rows);
      if (age.error || height.error) return toast(age.error ?? height.error ?? "", "error");
      setData({ age: age.rows, height: height.rows, file: file.name, warnings: [...age.warnings, ...height.warnings] });
    } catch (e) {
      toast("อ่านไฟล์ไม่ได้: " + (e instanceof Error ? e.message : String(e)), "error");
    }
  }

  async function apply() {
    if (!data) return;
    if (!confirm(`เปลี่ยนเป็นชุด "${newName}" และแปลผลการชั่งทุกครั้งใหม่ทั้งหมด?`)) return;
    setBusy(true);
    const { data: r, error } = await supabaseBrowser().rpc("replace_growth_refs", { p_name: newName, p_age: data.age, p_height: data.height });
    setBusy(false);
    if (error) return toast(error.message, "error");
    toast(`เปลี่ยนเกณฑ์แล้ว แปลผลใหม่ ${r.reclassified} รายการ`);
    setData(null);
    router.refresh();
  }

  async function saveKg() {
    const { error } = await supabaseBrowser().from("school_settings").update({ nutrition_alert_kg: kg }).eq("id", 1);
    if (error) return toast(error.message, "error");
    toast("บันทึกแล้ว");
    router.refresh();
  }

  const range = (xs: number[]) => (xs.length ? `${Math.min(...xs)}–${Math.max(...xs)}` : "-");
  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-2xl bg-orange-50 p-4 text-orange-950">
        <p className="text-sm">ชุดเกณฑ์ที่ใช้อยู่</p>
        <p className="text-lg font-semibold">{name}</p>
        <p className="text-sm">ตามอายุ {ageCount} แถว · น้ำหนักตามส่วนสูง {heightCount} แถว</p>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="font-semibold">เปลี่ยนชุดเกณฑ์</h3>
        <p className="text-sm text-muted">
          ใช้ไฟล์ Excel ที่มีชีต <b>age</b> (เกณฑ์ตามอายุ) และ <b>ht</b> (น้ำหนักตามส่วนสูง) รูปแบบเดียวกับโปรแกรม ปพ.5-6
          คอลัมน์ code = เพศ (1 ชาย, 2 หญิง) ตามด้วยอายุเป็นเดือน หรือส่วนสูงเป็นเซนติเมตร
          ระบบจะแปลผลการชั่งที่บันทึกไว้แล้วใหม่ทั้งหมดตามเกณฑ์ชุดใหม่
        </p>
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 self-start rounded-xl border-[1.5px] border-slate-300 bg-white px-4 font-semibold">
          <FileArrowUp size={22} weight="duotone" /> เลือกไฟล์ (.xlsx / .xlsb)
          <input type="file" accept=".xlsx,.xlsb,.xls" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        {data && (
          <div className="flex flex-col gap-3 rounded-2xl border border-line p-4">
            <p className="flex items-center gap-2 font-semibold text-green-800"><CheckCircle size={22} weight="fill" /> อ่านไฟล์ {data.file} ได้</p>
            <p className="text-sm">ตามอายุ {data.age.length} แถว (อายุ {range(data.age.map((r) => r.age_months))} เดือน) · น้ำหนักตามส่วนสูง {data.height.length} แถว (ส่วนสูง {range(data.height.map((r) => r.height_cm))} ซม.)</p>
            {data.warnings.length > 0 && (
              <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
                <p className="font-semibold">ข้อสังเกตในไฟล์ {data.warnings.length} แถว (นำเข้าได้ แต่ควรแจ้งผู้จัดทำไฟล์)</p>
                <ul className="mt-1 list-disc pl-5">{data.warnings.slice(0, 10).map((w) => <li key={w}>{w}</li>)}</ul>
              </div>
            )}
            <Field label="ชื่อชุดเกณฑ์ (แสดงในรายงาน)" htmlFor="gr-name"><input id="gr-name" className="field-input" value={newName} onChange={(e) => setNewName(e.target.value)} /></Field>
            <div className="flex gap-2"><Button onClick={apply} disabled={busy}>{busy ? "กำลังเปลี่ยน…" : "ใช้ชุดเกณฑ์นี้"}</Button><Button variant="secondary" onClick={() => setData(null)}>ยกเลิก</Button></div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Field label="เตือนเมื่อน้ำหนักต่างจากครั้งก่อนเกิน (กก.)" htmlFor="gr-kg" hint="ช่วยจับการพิมพ์ผิด เช่น 18.5 เป็น 81.5">
          <input id="gr-kg" type="number" step="0.5" min={1} max={20} className="field-input w-32" value={kg} onChange={(e) => setKg(Number(e.target.value))} />
        </Field>
        <Button variant="secondary" onClick={saveKg}>บันทึก</Button>
      </div>
    </div>
  );
}
