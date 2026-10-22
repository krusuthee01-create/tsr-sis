"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FileArrowUp, CheckCircle, WarningCircle, Warning } from "@phosphor-icons/react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { readSheet } from "@/lib/excel";
import { diffDmc, parseDmcSheet, toImportPayload, type DmcChange, type DmcParseResult, type ExistingStudent } from "@/lib/dmc";
import { classroomName, fullName } from "@/lib/domain";
import { formatThaiDate, todayISO } from "@/lib/thai-date";
import { Button, Card, Field, Stepper, Spinner, Badge } from "@/components/ui";
import { useToast } from "@/components/toast";

const STEPS = ["เลือกไฟล์", "ตรวจไฟล์", "ตรวจผลก่อนบันทึก", "เสร็จสิ้น"];
const CHUNK = 100;

export function ImportWizard({ defaultYear, schoolCode }: { defaultYear: number; schoolCode: string | null }) {
  const toast = useToast();
  const [step, setStep] = useState(1);
  const [year, setYear] = useState(defaultYear);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<DmcParseResult | null>(null);
  const [changes, setChanges] = useState<DmcChange[] | null>(null);
  const [filter, setFilter] = useState<DmcChange["kind"]>("new");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ new: number; updated: number; moved: number } | null>(null);
  const [handled, setHandled] = useState<Record<string, string>>({});
  const [dragOver, setDragOver] = useState(false);

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (!/\.(xlsx|xls|xlsb|csv)$/i.test(file.name)) return toast("กรุณาเลือกไฟล์ Excel (.xlsx) ที่ส่งออกจาก DMC", "error");
    setBusy(true);
    try {
      const { rows } = await readSheet(file);
      const p = parseDmcSheet(rows);
      setFileName(file.name);
      setParsed(p);
      setStep(2);
    } catch (e) {
      toast("อ่านไฟล์ไม่ได้: " + (e instanceof Error ? e.message : String(e)), "error");
    } finally {
      setBusy(false);
    }
  }

  async function prepareDiff() {
    if (!parsed) return;
    setBusy(true);
    const { data, error } = await supabaseBrowser().from("students")
      .select("id, citizen_id, student_code, prefix, first_name, last_name, birth_date, gender, guardian_name, guardian_phone, father_phone, mother_phone, address_current, status, enrollments(year, classrooms(grade, room))");
    setBusy(false);
    if (error) return toast(error.message, "error");
    const existing: ExistingStudent[] = ((data ?? []) as unknown as (ExistingStudent & { enrollments: { year: number; classrooms: { grade: string; room: number } }[] })[]).map((s) => {
      const e = s.enrollments.find((x) => x.year === year);
      return { ...s, classroom: e ? classroomName(e.classrooms) : null };
    });
    const d = diffDmc(parsed.rows, existing);
    setChanges(d);
    setFilter(d.some((c) => c.kind === "new") ? "new" : d.some((c) => c.kind === "changed") ? "changed" : "missing");
    setStep(3);
  }

  async function confirm() {
    if (!changes) return;
    const toSend = changes.flatMap((c) => (c.kind === "new" || c.kind === "changed" ? [toImportPayload(c.row)] : []));
    setBusy(true);
    setProgress(0);
    const total = { new: 0, updated: 0, moved: 0 };
    const sb = supabaseBrowser();
    for (let i = 0; i < toSend.length; i += CHUNK) {
      const { data, error } = await sb.rpc("import_dmc", { p_year: year, p_rows: toSend.slice(i, i + CHUNK) });
      if (error) {
        setBusy(false);
        return toast(`นำเข้าไม่สำเร็จที่รายการ ${i + 1}–${Math.min(i + CHUNK, toSend.length)}: ${error.message} (รายการก่อนหน้านี้บันทึกแล้ว กดยืนยันซ้ำได้)`, "error");
      }
      total.new += data.new; total.updated += data.updated; total.moved += data.moved;
      setProgress(Math.min(i + CHUNK, toSend.length) / toSend.length);
    }
    setBusy(false);
    setResult(total);
    setStep(4);
  }

  async function markMoved(id: string, name: string) {
    const { error } = await supabaseBrowser().rpc("change_student_status", {
      p_student: id, p_status: "moved_out", p_date: todayISO(), p_reason: `ไม่พบในไฟล์ DMC ที่นำเข้าเมื่อ ${formatThaiDate(todayISO())}`,
    });
    if (error) return toast(error.message, "error");
    setHandled((h) => ({ ...h, [id]: "ย้ายออกแล้ว" }));
    toast(`เปลี่ยน ${name} เป็นย้ายออกแล้ว`);
  }

  const counts = useMemo(() => {
    const c = { new: 0, changed: 0, same: 0, missing: 0 };
    for (const x of changes ?? []) c[x.kind] += 1;
    return c;
  }, [changes]);
  const errors = parsed?.issues.filter((i) => i.level === "error") ?? [];
  const warnings = parsed?.issues.filter((i) => i.level === "warning") ?? [];
  const wrongSchool = parsed?.schoolCode && schoolCode && parsed.schoolCode !== schoolCode;
  const missing = (changes ?? []).filter((c): c is Extract<DmcChange, { kind: "missing" }> => c.kind === "missing");

  return (
    <div className="flex flex-col gap-4">
      <Stepper steps={STEPS} current={step} />

      {step === 1 && (
        <div className="grid gap-4 md:grid-cols-[3fr_2fr]">
          <Card className="flex flex-col gap-4">
            <Field label="ปีการศึกษาที่นำเข้า" htmlFor="imp-year" hint="นักเรียนจะถูกจัดเข้าห้องของปีนี้ตามคอลัมน์ ชั้น/ห้อง ในไฟล์">
              <input id="imp-year" type="number" className="field-input max-w-40" value={year} min={2560} max={2700} onChange={(e) => setYear(Number(e.target.value))} />
            </Field>
            <label htmlFor="imp-file" onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); onFile(e.dataTransfer.files[0]); }}
              className={`flex cursor-pointer flex-col items-center gap-3 rounded-3xl border-[2.5px] border-dashed px-6 py-10 text-center ${dragOver ? "border-navy-600 bg-navy-50" : "border-sky-300 bg-white hover:bg-sky-50"}`}>
              <FileArrowUp size={64} weight="duotone" className="text-sky-600" />
              <span className="font-display text-lg font-semibold">ลากไฟล์มาวาง หรือแตะเพื่อเลือกไฟล์</span>
              <span className="text-sm text-muted">ไฟล์ .xlsx &ldquo;รายชื่อนักเรียนในโรงเรียน&rdquo; ที่ส่งออกจาก DMC</span>
              {busy && <Spinner label="กำลังอ่านไฟล์" />}
            </label>
            <input id="imp-file" type="file" accept=".xlsx,.xls,.xlsb,.csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
          </Card>
          <Card>
            <h2 className="mb-3 font-semibold">ไฟล์ที่ใช้</h2>
            <ol className="flex flex-col gap-2.5 text-[0.9375rem]">
              {["เข้าระบบ DMC ด้วยบัญชีนายทะเบียน", "ส่งออกรายชื่อนักเรียนในโรงเรียนเป็นไฟล์ Excel", "นำไฟล์มาวางในกล่องด้านซ้าย", "ไฟล์อยู่ในเครื่องนี้เท่านั้น ระบบส่งเฉพาะข้อมูลที่ยืนยันแล้ว"].map((t, i) => (
                <li key={t} className="flex gap-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sm font-bold text-sky-900">{i + 1}</span>{t}</li>
              ))}
            </ol>
          </Card>
        </div>
      )}

      {step === 2 && parsed && (
        <Card className="flex flex-col gap-4">
          <p className="font-semibold">ไฟล์: {fileName}</p>
          {parsed.missingHeaders.length ? (
            <p className="flex items-start gap-2 rounded-2xl bg-red-50 p-4 text-red-900"><WarningCircle size={24} weight="duotone" className="shrink-0" />
              ไฟล์นี้ไม่ใช่ไฟล์รายชื่อจาก DMC (ไม่พบคอลัมน์: {parsed.missingHeaders.join(", ")}) กรุณาเลือกไฟล์ใหม่</p>
          ) : (
            <>
              <div className="flex items-center gap-3 rounded-2xl bg-green-50 p-4 text-green-900">
                <CheckCircle size={28} weight="duotone" />
                <span>อ่านได้ <b>{parsed.rows.length}</b> คน จาก {parsed.headers.length} คอลัมน์ · พร้อมนำเข้าปีการศึกษา {year}</span>
              </div>
              {wrongSchool && <p className="rounded-2xl bg-amber-50 p-4 font-semibold text-amber-950">รหัสโรงเรียนในไฟล์ ({parsed.schoolCode}) ไม่ตรงกับที่ตั้งค่าไว้ ({schoolCode}) ตรวจสอบว่าเป็นไฟล์ของโรงเรียนนี้</p>}
              {errors.length > 0 && <IssueList title={`แถวที่ข้ามไป ${errors.length} แถว`} tone="red" items={errors} />}
              {warnings.length > 0 && <IssueList title={`ข้อสังเกต ${warnings.length} รายการ (นำเข้าได้)`} tone="amber" items={warnings} />}
            </>
          )}
          <div className="flex justify-between gap-2">
            <Button variant="secondary" onClick={() => { setStep(1); setParsed(null); }}>‹ เลือกไฟล์ใหม่</Button>
            <Button onClick={prepareDiff} disabled={busy || !!parsed.missingHeaders.length || !parsed.rows.length}>{busy ? "กำลังเทียบข้อมูล…" : "ถัดไป ›"}</Button>
          </div>
        </Card>
      )}

      {step === 3 && changes && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {([["new", "นักเรียนใหม่", "จะเพิ่มเข้าระบบ", "bg-green-100 text-green-900"], ["changed", "มีการเปลี่ยนแปลง", "ข้อมูลหรือห้องเปลี่ยน", "bg-sky-100 text-sky-900"],
              ["same", "ไม่เปลี่ยนแปลง", "ข้ามไป", "bg-slate-100 text-slate-800"], ["missing", "ไม่พบในไฟล์", "อาจย้ายออก · ตรวจสอบ", "bg-amber-100 text-amber-950"]] as const).map(([k, label, sub, cls]) => (
              <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={filter === k}
                className={`flex flex-col rounded-2xl p-4 text-left ${cls} ${filter === k ? "ring-[3px] ring-navy-700" : ""}`}>
                <span className="font-display text-3xl font-bold">{counts[k]}</span><span className="font-semibold">{label}</span><span className="text-sm">{sub}</span>
              </button>
            ))}
          </div>
          <Card className="p-0 md:p-0">
            <ul className="max-h-[50dvh] divide-y divide-slate-100 overflow-y-auto">
              {changes.filter((c) => c.kind === filter).slice(0, 300).map((c, i) => (
                <li key={i} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                  <span className="font-semibold sm:w-64">{c.kind === "missing" ? fullName(c.existing) : fullName(c.row)}</span>
                  <span className="text-sm text-muted">
                    {c.kind === "new" && `${c.row.grade}/${c.row.room} · รหัส ${c.row.student_code ?? "-"}`}
                    {c.kind === "changed" && c.fields.map((f) => `${f.label}: ${f.from} → ${f.to}`).join(" · ")}
                    {c.kind === "same" && `${c.row.grade}/${c.row.room}`}
                    {c.kind === "missing" && `${c.existing.classroom ?? "ไม่มีห้องในปีนี้"} · มีในระบบแต่ไม่มีในไฟล์ (จัดการได้ในขั้นถัดไป)`}
                  </span>
                </li>
              ))}
              {counts[filter] === 0 && <li className="px-4 py-6 text-center text-muted">ไม่มีรายการ</li>}
            </ul>
          </Card>
          {busy && progress > 0 && <div className="h-3 overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-green-600" style={{ width: `${progress * 100}%` }} /></div>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="secondary" onClick={() => setStep(2)} disabled={busy}>‹ ย้อนกลับ</Button>
            <span className="text-sm text-muted">ยังไม่มีอะไรถูกบันทึกจนกว่าจะกดยืนยัน</span>
            <Button variant="success" size="lg" onClick={confirm} disabled={busy || counts.new + counts.changed === 0}>
              {busy ? "กำลังนำเข้า…" : `ยืนยันนำเข้า ${counts.new + counts.changed} รายการ`}
            </Button>
          </div>
        </div>
      )}

      {step === 4 && result && (
        <div className="flex flex-col gap-3">
          <Card className="flex flex-col items-center gap-2 py-8 text-center">
            <CheckCircle size={72} weight="duotone" className="text-green-600" />
            <h2 className="text-2xl font-semibold">นำเข้าเรียบร้อย</h2>
            <p className="text-muted">เพิ่มนักเรียนใหม่ {result.new} คน · อัปเดต {result.updated} คน · ย้ายห้อง {result.moved} คน · บันทึกลงประวัติการแก้ไขแล้ว</p>
            <p className="text-sm text-muted">ข้อมูลเช็กชื่อและข้อมูลอื่นที่บันทึกในระบบไม่ถูกแตะต้อง</p>
          </Card>
          {missing.length > 0 && (
            <Card>
              <h2 className="mb-1 font-semibold">นักเรียนที่ไม่พบในไฟล์ DMC ({missing.length} คน)</h2>
              <p className="mb-3 text-sm text-muted">ถ้าย้ายออกแล้ว กด &ldquo;ย้ายออก&rdquo; (บันทึกเหตุผลให้อัตโนมัติ) หรือเปิดประวัติเพื่อเลือกสถานะอื่น</p>
              <ul className="flex flex-col gap-2">
                {missing.map(({ existing: e }) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2">
                    <span className="flex-1 font-semibold">{fullName(e)} <span className="font-normal text-muted">{e.classroom ?? ""}</span></span>
                    {handled[e.id] ? <Badge tone="gray">{handled[e.id]}</Badge> : (
                      <>
                        <Link href={`/students/${e.id}`} className="rounded-lg px-3 py-2 text-sm font-semibold text-navy-700 hover:bg-navy-50">เปิดประวัติ</Link>
                        <Button size="sm" variant="secondary" onClick={() => markMoved(e.id, fullName(e))}>ย้ายออก</Button>
                        <Button size="sm" variant="ghost" onClick={() => setHandled((h) => ({ ...h, [e.id]: "คงไว้" }))}>คงไว้</Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <div className="flex flex-wrap gap-2">
            <Link href="/classrooms" className="rounded-xl bg-navy-700 px-4 py-3 font-semibold text-white">ไปจัดห้องและเลขที่</Link>
            <Link href="/students" className="rounded-xl border-[1.5px] border-slate-300 bg-white px-4 py-3 font-semibold">ดูทะเบียนนักเรียน</Link>
          </div>
        </div>
      )}
    </div>
  );
}

function IssueList({ title, tone, items }: { title: string; tone: "red" | "amber"; items: { row: number; message: string }[] }) {
  return (
    <details className={`rounded-2xl p-4 ${tone === "red" ? "bg-red-50 text-red-950" : "bg-amber-50 text-amber-950"}`} open={items.length <= 10}>
      <summary className="flex cursor-pointer items-center gap-2 font-semibold"><Warning size={22} weight="duotone" />{title}</summary>
      <ul className="mt-2 flex max-h-60 flex-col gap-1 overflow-y-auto text-sm">
        {items.map((i, k) => <li key={k}>แถว {i.row} ใน Excel: {i.message}</li>)}
      </ul>
    </details>
  );
}
