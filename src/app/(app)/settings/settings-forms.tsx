"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash, FileArrowUp } from "@phosphor-icons/react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Button, Field, Badge } from "@/components/ui";
import { useToast } from "@/components/toast";
import { formatThaiDate } from "@/lib/thai-date";
import { GRADE_CODES } from "@/lib/domain";
import { readSheet } from "@/lib/excel";
import { parsePp5Subjects, type Pp5Subject } from "@/lib/pp5";

function useSave() {
  const router = useRouter();
  const toast = useToast();
  return async (p: PromiseLike<{ error: { message: string; code?: string } | null }>, ok: string, dup?: string) => {
    const { error } = await p;
    if (error) {
      toast(error.code === "23505" && dup ? dup : error.code === "23503" ? "ลบไม่ได้ เพราะมีข้อมูลอื่นใช้รายการนี้อยู่" : error.message, "error");
      return false;
    }
    toast(ok);
    router.refresh();
    return true;
  };
}

type Settings = { school_name: string; school_code: string; address: string | null; director_name: string | null; registrar_name: string | null; edit_window_days: number; attendance_risk_percent: number };

export function SchoolForm({ initial }: { initial: Settings }) {
  const save = useSave();
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Settings, v: string | number) => setD((x) => ({ ...x, [k]: v }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    await save(supabaseBrowser().from("school_settings").update({
      school_name: d.school_name, school_code: d.school_code, address: d.address, director_name: d.director_name,
      registrar_name: d.registrar_name, edit_window_days: d.edit_window_days, attendance_risk_percent: d.attendance_risk_percent,
    }).eq("id", 1), "บันทึกข้อมูลโรงเรียนแล้ว");
    setBusy(false);
  }
  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <Field label="ชื่อโรงเรียน" htmlFor="s-name"><input id="s-name" className="field-input" value={d.school_name} onChange={(e) => set("school_name", e.target.value)} /></Field>
      <Field label="รหัสโรงเรียน (DMC)" htmlFor="s-code" hint="ใช้ตรวจว่าไฟล์ DMC เป็นของโรงเรียนนี้"><input id="s-code" className="field-input" value={d.school_code} onChange={(e) => set("school_code", e.target.value)} /></Field>
      <div className="sm:col-span-2"><Field label="ที่อยู่" htmlFor="s-addr"><input id="s-addr" className="field-input" value={d.address ?? ""} onChange={(e) => set("address", e.target.value)} /></Field></div>
      <Field label="ชื่อผู้อำนวยการ" htmlFor="s-dir" hint="แสดงในช่องลงนามของรายงาน"><input id="s-dir" className="field-input" value={d.director_name ?? ""} onChange={(e) => set("director_name", e.target.value)} /></Field>
      <Field label="ชื่อนายทะเบียน" htmlFor="s-reg"><input id="s-reg" className="field-input" value={d.registrar_name ?? ""} onChange={(e) => set("registrar_name", e.target.value)} /></Field>
      <Field label="ครูแก้ไขเช็กชื่อย้อนหลังได้ (วัน)" htmlFor="s-win" hint="หลังจากนี้ต้องให้ผู้ดูแลระบบแก้"><input id="s-win" type="number" min={0} max={60} className="field-input" value={d.edit_window_days} onChange={(e) => set("edit_window_days", Number(e.target.value))} /></Field>
      <Field label="เกณฑ์มาเรียนต่ำ (ร้อยละ)" htmlFor="s-risk" hint="ต่ำกว่านี้ขึ้นสีแดงในรายงาน และใช้คัดกรองในเฟส 2"><input id="s-risk" type="number" min={50} max={100} className="field-input" value={d.attendance_risk_percent} onChange={(e) => set("attendance_risk_percent", Number(e.target.value))} /></Field>
      <div className="sm:col-span-2"><Button type="submit" disabled={busy}>บันทึก</Button></div>
    </form>
  );
}

export function YearsEditor({ years, current, selected }: { years: number[]; current: number | null; selected: number }) {
  const save = useSave();
  const [y, setY] = useState((years[0] ?? 2568) + 1);
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-2">
        {years.map((x) => (
          <li key={x} className={`flex items-center gap-2 rounded-xl border-[1.5px] px-3 py-2 ${x === selected ? "border-sky-500 bg-sky-50" : "border-line"}`}>
            <Link href={`/settings?s=calendar&y=${x}`} className="font-semibold">{x}</Link>
            {x === current ? <Badge tone="green">ปีปัจจุบัน</Badge> : (
              <button type="button" className="text-sm font-semibold text-navy-700 underline"
                onClick={() => confirm(`ตั้งปีการศึกษาปัจจุบันเป็น ${x}? ทุกหน้าจะแสดงข้อมูลของปีนี้`) && save(supabaseBrowser().from("school_settings").update({ current_year: x }).eq("id", 1), `ตั้งปีปัจจุบันเป็น ${x} แล้ว`)}>
                ตั้งเป็นปีปัจจุบัน
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="flex items-end gap-2">
        <Field label="เพิ่มปีการศึกษา" htmlFor="y-new"><input id="y-new" type="number" min={2560} max={2700} className="field-input w-32" value={y} onChange={(e) => setY(Number(e.target.value))} /></Field>
        <Button onClick={async () => {
          const ok = await save(supabaseBrowser().from("academic_years").insert({ year: y }), `เพิ่มปี ${y} แล้ว`, "มีปีนี้แล้ว");
          if (ok && !current) await save(supabaseBrowser().from("school_settings").update({ current_year: y }).eq("id", 1), `ตั้งปีปัจจุบันเป็น ${y} แล้ว`);
        }}><Plus size={20} weight="bold" /> เพิ่ม</Button>
      </div>
    </div>
  );
}

export function TermsEditor({ year, terms }: { year: number; terms: { id: number; term: number; start_date: string; end_date: string }[] }) {
  const save = useSave();
  const [d, setD] = useState(() => [1, 2].map((t) => {
    const x = terms.find((y) => y.term === t);
    const g = year - 543;
    return { term: t, start_date: x?.start_date ?? (t === 1 ? `${g}-05-16` : `${g}-11-01`), end_date: x?.end_date ?? (t === 1 ? `${g}-10-10` : `${g + 1}-03-31`) };
  }));
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    for (const t of d) if (t.end_date < t.start_date) return setError(`ภาคเรียนที่ ${t.term}: วันปิดต้องอยู่หลังวันเปิด`);
    if (d[1].start_date <= d[0].end_date) return setError("ภาคเรียนที่ 2 ต้องเริ่มหลังภาคเรียนที่ 1 สิ้นสุด");
    setError(null);
    await save(supabaseBrowser().from("terms").upsert(d.map((t) => ({ year, ...t })), { onConflict: "year,term" }), "บันทึกภาคเรียนแล้ว");
  }
  return (
    <div className="flex flex-col gap-3">
      {d.map((t, i) => (
        <div key={t.term} className="grid grid-cols-2 gap-2">
          <Field label={`ภาค ${t.term} เปิด (${formatThaiDate(t.start_date)})`} htmlFor={`t${t.term}s`}>
            <input id={`t${t.term}s`} type="date" className="field-input" value={t.start_date} onChange={(e) => setD((x) => x.map((y, j) => (j === i ? { ...y, start_date: e.target.value } : y)))} />
          </Field>
          <Field label={`ภาค ${t.term} ปิด (${formatThaiDate(t.end_date)})`} htmlFor={`t${t.term}e`}>
            <input id={`t${t.term}e`} type="date" className="field-input" value={t.end_date} onChange={(e) => setD((x) => x.map((y, j) => (j === i ? { ...y, end_date: e.target.value } : y)))} />
          </Field>
        </div>
      ))}
      {error && <p role="alert" className="text-sm font-medium text-red-700">{error}</p>}
      <p className="text-sm text-muted">ครูเช็กชื่อได้เฉพาะวันที่อยู่ในภาคเรียน (ไม่รวมเสาร์-อาทิตย์และวันหยุด)</p>
      <Button onClick={submit} className="self-start">บันทึกภาคเรียน</Button>
    </div>
  );
}

export function HolidaysEditor({ holidays }: { holidays: { date: string; name: string }[] }) {
  const save = useSave();
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
        <Field label="วันที่" htmlFor="h-date"><input id="h-date" type="date" className="field-input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="ชื่อวันหยุด" htmlFor="h-name"><input id="h-name" className="field-input" placeholder="เช่น วันปิยมหาราช" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Button disabled={!date || !name.trim()} onClick={async () => { if (await save(supabaseBrowser().from("holidays").insert({ date, name: name.trim() }), "เพิ่มวันหยุดแล้ว", "วันนี้เป็นวันหยุดอยู่แล้ว")) { setDate(""); setName(""); } }}>
          <Plus size={20} weight="bold" /> เพิ่ม
        </Button>
      </div>
      {holidays.length === 0 ? <p className="text-muted">ยังไม่มีวันหยุดในปีการศึกษานี้</p> : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {holidays.map((h) => (
            <li key={h.date} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2">
              <span className="w-28 shrink-0 text-sm font-semibold">{formatThaiDate(h.date)}</span>
              <span className="flex-1">{h.name}</span>
              <button type="button" aria-label={`ลบ ${h.name}`} onClick={() => save(supabaseBrowser().from("holidays").delete().eq("date", h.date), "ลบแล้ว")} className="rounded-lg p-2 text-red-700 hover:bg-red-50"><Trash size={18} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PeriodsEditor({ periods }: { periods: { no: number; start_time: string; end_time: string }[] }) {
  const save = useSave();
  const [d, setD] = useState(periods);
  const next = (d.at(-1)?.no ?? 0) + 1;
  async function submit() {
    const sb = supabaseBrowser();
    const removed = periods.filter((p) => !d.some((x) => x.no === p.no)).map((p) => p.no);
    if (removed.length) {
      const { error } = await sb.from("periods").delete().in("no", removed);
      if (error) return save(Promise.resolve({ error }), "");
    }
    await save(sb.from("periods").upsert(d), "บันทึกคาบเรียนแล้ว");
  }
  return (
    <div className="flex flex-col gap-3">
      {d.map((p, i) => (
        <div key={p.no} className="grid grid-cols-[4rem_1fr_1fr_auto] items-end gap-2">
          <span className="pb-3 font-semibold">คาบ {p.no}</span>
          <Field label="เริ่ม" htmlFor={`p${p.no}s`}><input id={`p${p.no}s`} type="time" className="field-input" value={p.start_time} onChange={(e) => setD((x) => x.map((y, j) => (j === i ? { ...y, start_time: e.target.value } : y)))} /></Field>
          <Field label="สิ้นสุด" htmlFor={`p${p.no}e`}><input id={`p${p.no}e`} type="time" className="field-input" value={p.end_time} onChange={(e) => setD((x) => x.map((y, j) => (j === i ? { ...y, end_time: e.target.value } : y)))} /></Field>
          <button type="button" aria-label={`ลบคาบ ${p.no}`} disabled={i !== d.length - 1} onClick={() => setD((x) => x.slice(0, -1))} className="mb-1 rounded-lg p-2.5 text-red-700 hover:bg-red-50 disabled:invisible"><Trash size={20} /></button>
        </div>
      ))}
      <div className="flex gap-2">
        <Button variant="secondary" disabled={next > 12} onClick={() => setD((x) => [...x, { no: next, start_time: x.at(-1)?.end_time ?? "08:30", end_time: "16:00" }])}><Plus size={20} weight="bold" /> เพิ่มคาบ</Button>
        <Button onClick={submit}>บันทึกคาบเรียน</Button>
      </div>
    </div>
  );
}

type Subject = { id: number; code: string; name: string; grade: string | null; hours_per_year: number | null; learning_area: string | null };

export function SubjectsEditor({ subjects }: { subjects: Subject[] }) {
  const save = useSave();
  const toast = useToast();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [grade, setGrade] = useState("ป.1");
  const [preview, setPreview] = useState<Pp5Subject[] | null>(null);
  const [filter, setFilter] = useState("");

  async function fromPp5(file: File | undefined) {
    if (!file) return;
    try {
      const { rows, sheetNames } = await readSheet(file, "รายวิชา");
      if (!sheetNames.includes("รายวิชา")) return toast("ไม่พบชีต \"รายวิชา\" ในไฟล์นี้ (ต้องเป็นไฟล์โปรแกรม ปพ.5)", "error");
      const list = parsePp5Subjects(rows);
      if (!list.length) return toast("ไม่พบรายวิชาในชีต \"รายวิชา\"", "error");
      setPreview(list);
    } catch (e) {
      toast("อ่านไฟล์ไม่ได้: " + (e instanceof Error ? e.message : String(e)), "error");
    }
  }
  async function importPreview() {
    if (!preview) return;
    const ok = await save(supabaseBrowser().from("subjects").upsert(
      preview.map((s) => ({ code: s.code, name: s.name, grade: s.grade, hours_per_year: s.hours, learning_area: s.area })), { onConflict: "code" }),
      `นำเข้า ${preview.length} วิชาแล้ว`);
    if (ok) setPreview(null);
  }

  const shown = subjects.filter((s) => !filter || s.grade === filter);
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl bg-violet-50 p-4">
        <p className="mb-2 font-semibold text-violet-950">นำเข้าจากไฟล์โปรแกรม ปพ.5 (ไม่ต้องพิมพ์ซ้ำ)</p>
        <p className="mb-3 text-sm text-violet-900">เลือกไฟล์ .xlsb ของแต่ละชั้น ระบบอ่านชีต &ldquo;รายวิชา&rdquo; ให้ (ไฟล์ไม่ถูกส่งขึ้นระบบ)</p>
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-white px-4 font-semibold text-violet-900 shadow-sm">
          <FileArrowUp size={22} weight="duotone" /> เลือกไฟล์ ปพ.5
          <input type="file" accept=".xlsb,.xlsx,.xls" className="sr-only" onChange={(e) => fromPp5(e.target.files?.[0])} />
        </label>
        {preview && (
          <div className="mt-3 rounded-xl bg-white p-3">
            <p className="mb-2 font-semibold">พบ {preview.length} วิชา ชั้น {preview[0]?.grade ?? "-"}</p>
            <ul className="mb-3 grid gap-1 text-sm sm:grid-cols-2">{preview.map((s) => <li key={s.code}>{s.code} {s.name} ({s.hours ?? "-"} ชม.)</li>)}</ul>
            <div className="flex gap-2"><Button onClick={importPreview}>นำเข้า {preview.length} วิชา</Button><Button variant="secondary" onClick={() => setPreview(null)}>ยกเลิก</Button></div>
          </div>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-[8rem_1fr_7rem_auto] sm:items-end">
        <Field label="รหัสวิชา" htmlFor="sj-code"><input id="sj-code" className="field-input" placeholder="ท11101" value={code} onChange={(e) => setCode(e.target.value.trim())} /></Field>
        <Field label="ชื่อวิชา" htmlFor="sj-name"><input id="sj-name" className="field-input" placeholder="ภาษาไทย" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="ชั้น" htmlFor="sj-grade"><select id="sj-grade" className="field-input" value={grade} onChange={(e) => setGrade(e.target.value)}>{GRADE_CODES.filter((g) => g.startsWith("ป.")).map((g) => <option key={g}>{g}</option>)}</select></Field>
        <Button disabled={!code || !name.trim()} onClick={async () => { if (await save(supabaseBrowser().from("subjects").insert({ code, name: name.trim(), grade }), "เพิ่มวิชาแล้ว", "มีรหัสวิชานี้แล้ว")) { setCode(""); setName(""); } }}><Plus size={20} weight="bold" /> เพิ่ม</Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {["", ...GRADE_CODES.filter((g) => g.startsWith("ป."))].map((g) => (
          <button key={g} type="button" onClick={() => setFilter(g)} className={`rounded-full px-3 py-1.5 text-sm font-bold ${filter === g ? "bg-violet-600 text-white" : "bg-slate-100"}`}>{g || "ทั้งหมด"}</button>
        ))}
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>รหัส</th><th>ชื่อวิชา</th><th>ชั้น</th><th>ชม./ปี</th><th /></tr></thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.id}>
                <td>{s.code}</td><td className="font-semibold">{s.name}</td><td>{s.grade ?? "-"}</td><td>{s.hours_per_year ?? "-"}</td>
                <td className="w-12"><button type="button" aria-label={`ลบ ${s.name}`} onClick={() => confirm(`ลบวิชา ${s.name}? (ลบไม่ได้ถ้ามีการเช็กชื่อประจำวิชานี้แล้ว)`) && save(supabaseBrowser().from("subjects").delete().eq("id", s.id), "ลบแล้ว", undefined)} className="rounded-lg p-2 text-red-700 hover:bg-red-50"><Trash size={18} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
