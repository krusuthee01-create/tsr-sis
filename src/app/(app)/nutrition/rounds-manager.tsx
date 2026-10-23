"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Plus, Trash } from "@phosphor-icons/react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Button, Card, Field, SectionTitle } from "@/components/ui";
import { useToast } from "@/components/toast";
import { formatThaiDate } from "@/lib/thai-date";
import { monthlyRounds } from "@/lib/nutrition";

/** รอบการชั่งน้ำหนัก: สร้างรายเดือนอัตโนมัติตามภาคเรียน หรือเพิ่มเอง (เช่น ภาคละ 2 ครั้ง) */
export function RoundsManager({ year, rounds }: { year: number; rounds: { id: number; name: string; start_date: string; end_date: string }[] }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    const sb = supabaseBrowser();
    const { data: terms } = await sb.from("terms").select("start_date, end_date").eq("year", year);
    if (!terms?.length) { setBusy(false); return toast("ยังไม่ได้ตั้งวันเปิด-ปิดภาคเรียนของปีนี้ (หน้า ตั้งค่า › ปีการศึกษา / ปฏิทิน)", "error"); }
    const missing = monthlyRounds(terms).filter((r) => !rounds.some((x) => x.name === r.name));
    if (!missing.length) { setBusy(false); return toast("มีรอบรายเดือนครบแล้ว", "info"); }
    const { error } = await sb.from("measurement_rounds").insert(missing.map((r) => ({ ...r, year })));
    setBusy(false);
    if (error) return toast(error.message, "error");
    toast(`สร้างรอบรายเดือน ${missing.length} รอบแล้ว`);
    router.refresh();
  }

  async function add() {
    if (!name.trim() || !start || !end) return toast("กรอกชื่อรอบ วันเริ่ม และวันสิ้นสุด", "error");
    if (end < start) return toast("วันสิ้นสุดต้องอยู่หลังวันเริ่ม", "error");
    const { error } = await supabaseBrowser().from("measurement_rounds").insert({ year, name: name.trim(), start_date: start, end_date: end });
    if (error) return toast(error.code === "23505" ? "มีรอบชื่อนี้แล้ว" : error.message, "error");
    setName(""); setStart(""); setEnd("");
    toast("เพิ่มรอบแล้ว");
    router.refresh();
  }

  async function remove(id: number, n: string) {
    if (!confirm(`ลบรอบ ${n}?`)) return;
    const { error } = await supabaseBrowser().from("measurement_rounds").delete().eq("id", id);
    if (error) return toast(error.code === "23503" ? "ลบไม่ได้ เพราะรอบนี้มีข้อมูลน้ำหนัก/ส่วนสูงแล้ว" : error.message, "error");
    router.refresh();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
      <Card>
        <SectionTitle action={<Button size="sm" onClick={generate} disabled={busy}><CalendarPlus size={20} weight="duotone" /> สร้างรอบรายเดือนตามภาคเรียน</Button>}>
          รอบการชั่ง ปีการศึกษา {year}
        </SectionTitle>
        {rounds.length === 0 ? <p className="text-muted">ยังไม่มีรอบ กดปุ่มด้านบนเพื่อสร้างรอบทุกเดือนที่อยู่ในภาคเรียนอัตโนมัติ</p> : (
          <ul className="flex flex-col gap-2">
            {rounds.map((r) => (
              <li key={r.id} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2">
                <span className="w-28 font-semibold">{r.name}</span>
                <span className="flex-1 text-sm text-muted">{formatThaiDate(r.start_date)} – {formatThaiDate(r.end_date)}</span>
                <button type="button" aria-label={`ลบรอบ ${r.name}`} onClick={() => remove(r.id, r.name)} className="rounded-lg p-2 text-red-700 hover:bg-red-50"><Trash size={18} /></button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <SectionTitle>เพิ่มรอบเอง</SectionTitle>
        <div className="flex flex-col gap-3">
          <Field label="ชื่อรอบ" htmlFor="rd-name" hint="เช่น ภาค 1 ครั้งที่ 1 (ถ้าโรงเรียนชั่งภาคละ 2 ครั้ง)"><input id="rd-name" className="field-input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="วันเริ่ม" htmlFor="rd-start"><input id="rd-start" type="date" className="field-input" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="วันสิ้นสุด" htmlFor="rd-end"><input id="rd-end" type="date" className="field-input" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
          <Button onClick={add} className="self-start"><Plus size={20} weight="bold" /> เพิ่มรอบ</Button>
        </div>
      </Card>
    </div>
  );
}
