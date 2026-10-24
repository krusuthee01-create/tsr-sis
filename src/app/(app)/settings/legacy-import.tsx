"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, FileArrowUp, Warning } from "@phosphor-icons/react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { readWorkbook } from "@/lib/excel";
import { LEAVE_NOTE, LEGACY_SHEETS, parseLegacyWorkbook, roundName, type LegacyFile } from "@/lib/legacy-import";
import { formatThaiDate } from "@/lib/thai-date";
import { Button, Stepper } from "@/components/ui";
import { useToast } from "@/components/toast";

type Match = { code: string; student_id: string; classroom_id: number; grade: string; room: number };
type Term = { start_date: string; end_date: string };
const CHUNK = 1500;

/** นำเข้าข้อมูลภาคเรียนที่ผ่านมาจากระบบเช็กชื่อเดิม (Google Sheets) */
export function LegacyImport({ years, current, terms }: { years: number[]; current: number | null; terms: Record<number, Term[]> }) {
  const router = useRouter();
  const toast = useToast();
  const [year, setYear] = useState(current ?? years[0]);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [file, setFile] = useState<LegacyFile | null>(null);
  const [match, setMatch] = useState<Map<string, Match>>(new Map());
  const [result, setResult] = useState<{ attendance: number; health: number; skipped: number; measurements: number; rounds: number } | null>(null);

  async function choose(f: File | undefined) {
    if (!f) return;
    setBusy("กำลังอ่านไฟล์ (ไฟล์ใหญ่อาจใช้เวลาประมาณ 10–20 วินาที)…");
    try {
      const parsed = parseLegacyWorkbook(await readWorkbook(f, LEGACY_SHEETS));
      const codes = [...new Set([...parsed.attendance.map((a) => a.code), ...parsed.measures.map((m) => m.code)])];
      setBusy("กำลังจับคู่นักเรียนกับข้อมูล DMC…");
      const { data, error } = await supabaseBrowser().rpc("legacy_match", { p_year: year, p_codes: codes });
      if (error) throw new Error(error.message);
      setMatch(new Map(((data ?? []) as Match[]).map((m) => [m.code, m])));
      setFile(parsed);
      setStep(2);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  async function run() {
    if (!file) return;
    setStep(3);
    const sb = supabaseBrowser();
    const att = file.attendance.filter((a) => match.has(a.code)).map((a) => {
      const m = match.get(a.code)!;
      return { s: m.student_id, c: m.classroom_id, d: a.date, a: a.status, n: a.leave ? LEAVE_NOTE : null, m: a.milk, b: a.brush };
    });
    const meas = file.measures.filter((x) => match.has(x.code)).map((x) => {
      const m = match.get(x.code)!;
      const [y, mo] = x.month.split("-").map(Number);
      const end = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
      return { s: m.student_id, c: m.classroom_id, round: roundName(x.month), start: `${x.month}-01`, end, d: x.date, w: x.weight, h: x.height };
    });
    const total = Math.ceil(att.length / CHUNK) + Math.ceil(meas.length / 500);
    let done = 0;
    const sum = { attendance: 0, health: 0, skipped: 0, measurements: 0, rounds: 0 };
    try {
      for (let i = 0; i < att.length; i += CHUNK) {
        setBusy(`กำลังนำเข้าเช็กชื่อ ดื่มนม แปรงฟัน ${Math.min(i + CHUNK, att.length).toLocaleString("th-TH")} / ${att.length.toLocaleString("th-TH")} รายการ`);
        const { data, error } = await sb.rpc("import_legacy_attendance", { p_year: year, p_rows: att.slice(i, i + CHUNK) });
        if (error) throw new Error(error.message);
        sum.attendance += data.attendance; sum.health += data.health; sum.skipped += data.skipped;
        setProgress(++done / total);
      }
      for (let i = 0; i < meas.length; i += 500) {
        setBusy(`กำลังนำเข้าน้ำหนัก ส่วนสูง ${Math.min(i + 500, meas.length).toLocaleString("th-TH")} / ${meas.length.toLocaleString("th-TH")} รายการ`);
        const { data, error } = await sb.rpc("import_legacy_measurements", { p_year: year, p_rows: meas.slice(i, i + 500) });
        if (error) throw new Error(error.message);
        sum.measurements += data.measurements; sum.rounds += data.rounds;
        setProgress(++done / total);
      }
      setResult(sum);
      toast("นำเข้าข้อมูลจากระบบเดิมเรียบร้อย");
      router.refresh();
    } catch (e) {
      toast(`หยุดกลางทาง: ${(e as Error).message} — กดนำเข้าใหม่ได้ ข้อมูลที่เข้าแล้วจะไม่ซ้ำ`, "error");
      setStep(2);
    } finally {
      setBusy(null);
    }
  }

  const f = file;
  const unmatched = f ? [...new Set(f.attendance.map((a) => a.code).filter((c) => !match.has(c)))] : [];
  const unmatchedRows = f ? f.attendance.filter((a) => !match.has(a.code)).length : 0;
  const moved = f ? new Set(f.attendance.filter((a) => match.has(a.code) && a.cls !== `${match.get(a.code)!.grade}/${match.get(a.code)!.room}`).map((a) => a.code)).size : 0;
  const t = (terms[year] ?? []);
  const outside = f ? new Set(f.attendance.map((a) => a.date).filter((d) => !t.some((x) => d >= x.start_date && d <= x.end_date))).size : 0;
  const months = f ? [...new Set(f.measures.map((m) => m.month))].sort() : [];

  return (
    <div className="flex flex-col gap-4">
      <Stepper steps={["เลือกไฟล์", "ตรวจก่อนนำเข้า", "นำเข้า"]} current={step} />

      {step === 1 && (
        <>
          <ol className="list-decimal pl-5 text-[0.9375rem] text-muted">
            <li>เปิด Google Sheets ของระบบเช็กชื่อเดิม › ไฟล์ › ดาวน์โหลด › Microsoft Excel (.xlsx)</li>
            <li>ตรวจว่าระบบใหม่ตั้งปีการศึกษา วันเปิด-ปิดภาคเรียน และนำเข้า DMC (มีเลขประจำตัวนักเรียน) แล้ว</li>
            <li>เลือกไฟล์ ระบบอ่านเฉพาะชีต Attendance และ น้ำหนักส่วนสูง (ไม่อ่านชีตรหัสผ่านครู)</li>
          </ol>
          <label className="flex flex-col gap-1 text-sm font-semibold">ปีการศึกษาของข้อมูล
            <select className="field-input max-w-48" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-sky-300 bg-sky-50 p-6 text-center font-semibold text-sky-800">
            <FileArrowUp size={44} weight="duotone" />แตะเพื่อเลือกไฟล์ระบบเช็กชื่อเดิม (.xlsx)
            <input type="file" accept=".xlsx" className="sr-only" disabled={!!busy} onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
        </>
      )}

      {busy && (
        <div className="rounded-2xl bg-sky-50 p-4 text-center font-semibold text-sky-900">
          {busy}
          {step === 3 && <div className="mx-auto mt-3 h-3 max-w-md overflow-hidden rounded-full bg-sky-100"><div className="h-full rounded-full bg-sky-600 transition-all" style={{ width: `${progress * 100}%` }} /></div>}
        </div>
      )}

      {f && step >= 2 && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2 text-center md:grid-cols-4">
            <div className="rounded-xl bg-green-100 p-3 text-green-900"><p className="text-2xl font-bold">{(f.attendance.length - unmatchedRows).toLocaleString("th-TH")}</p><p className="text-xs">รายการเช็กชื่อที่จะนำเข้า</p></div>
            <div className="rounded-xl bg-slate-100 p-3"><p className="text-2xl font-bold">{f.stats.days}</p><p className="text-xs">วันเรียน ({f.stats.from ? formatThaiDate(f.stats.from) : "-"} – {f.stats.to ? formatThaiDate(f.stats.to) : "-"})</p></div>
            <div className="rounded-xl bg-sky-100 p-3 text-sky-900"><p className="text-2xl font-bold">{match.size}</p><p className="text-xs">นักเรียนที่จับคู่ได้</p></div>
            <div className="rounded-xl bg-orange-100 p-3 text-orange-900"><p className="text-2xl font-bold">{f.measures.filter((m) => match.has(m.code)).length.toLocaleString("th-TH")}</p><p className="text-xs">น้ำหนัก/ส่วนสูง ({months.length} รอบ)</p></div>
          </div>
          <ul className="flex flex-col gap-1.5 text-sm">
            <li className="flex gap-2"><CheckCircle size={20} weight="fill" className="shrink-0 text-green-600" />ใช้รายการที่บันทึกล่าสุดเมื่อมีซ้ำ (ตัดซ้ำ {f.stats.duplicates.toLocaleString("th-TH")} รายการ) · ข้ามวันเสาร์-อาทิตย์ {f.stats.weekend} รายการ</li>
            <li className="flex gap-2"><CheckCircle size={20} weight="fill" className="shrink-0 text-green-600" />&ldquo;ลา&rdquo; {f.attendance.filter((a) => a.leave).length.toLocaleString("th-TH")} รายการ บันทึกเป็นลากิจ พร้อมหมายเหตุว่าไม่ระบุประเภท</li>
            <li className="flex gap-2"><CheckCircle size={20} weight="fill" className="shrink-0 text-green-600" />รอบการชั่ง: {months.map(roundName).join(", ") || "-"} (สร้างให้ถ้ายังไม่มี)</li>
            <li className="flex gap-2"><CheckCircle size={20} weight="fill" className="shrink-0 text-green-600" />วันที่บันทึกในระบบใหม่แล้วจะไม่ถูกเขียนทับ · นำเข้าซ้ำได้ ไม่เกิดข้อมูลซ้ำ</li>
            {unmatched.length > 0 && <li className="flex gap-2 text-amber-900"><Warning size={20} weight="fill" className="shrink-0 text-amber-500" />ไม่พบเลขประจำตัว {unmatched.length} คน ({unmatchedRows.toLocaleString("th-TH")} รายการ) ในข้อมูล DMC ปี {year} จะข้าม: {unmatched.slice(0, 15).join(", ")}{unmatched.length > 15 ? " …" : ""}</li>}
            {moved > 0 && <li className="flex gap-2 text-amber-900"><Warning size={20} weight="fill" className="shrink-0 text-amber-500" />{moved} คน ห้องในไฟล์ต่างจากในระบบ (เช่น ย้ายห้อง) จะบันทึกตามห้องในระบบ</li>}
            {outside > 0 && <li className="flex gap-2 text-amber-900"><Warning size={20} weight="fill" className="shrink-0 text-amber-500" />{outside} วันอยู่นอกช่วงภาคเรียนที่ตั้งไว้ในระบบ ควรตรวจวันเปิด-ปิดภาคเรียนที่แท็บปีการศึกษา/ปฏิทิน</li>}
            {f.issues.map((i) => <li key={`${i.sheet}${i.row}`} className="flex gap-2 text-amber-900"><Warning size={20} weight="fill" className="shrink-0 text-amber-500" />ชีต {i.sheet} แถว {i.row} (เลขประจำตัว {i.code}): {i.reason}</li>)}
          </ul>
          {step === 2 && !busy && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={run} disabled={!match.size}>ยืนยันนำเข้าปีการศึกษา {year}</Button>
              <Button variant="secondary" onClick={() => { setFile(null); setStep(1); }}>เลือกไฟล์ใหม่</Button>
            </div>
          )}
        </div>
      )}

      {result && (
        <div className="rounded-2xl bg-green-50 p-4 text-green-950">
          <p className="flex items-center gap-2 font-bold"><CheckCircle size={24} weight="fill" className="text-green-600" />นำเข้าเรียบร้อย</p>
          <p className="mt-1 text-sm">เช็กชื่อใหม่ {result.attendance.toLocaleString("th-TH")} รายการ (มีอยู่แล้ว {result.skipped.toLocaleString("th-TH")}) · ดื่มนม/แปรงฟัน {result.health.toLocaleString("th-TH")} รายการ · น้ำหนักส่วนสูง {result.measurements.toLocaleString("th-TH")} รายการ · สร้างรอบการชั่ง {result.rounds} รอบ</p>
          <p className="mt-1 text-sm">ตรวจผลได้ที่เมนูรายงาน และภาวะโภชนาการ ไฟล์ Google Sheets เดิมควรปิดการแชร์ หรือลบชีต Teachers ที่มีรหัสผ่าน</p>
        </div>
      )}
    </div>
  );
}
