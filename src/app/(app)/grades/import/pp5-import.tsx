"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, FileArrowUp, Warning, XCircle } from "@phosphor-icons/react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { readWorkbook } from "@/lib/excel";
import { parsePp5Workbook, PP5_SHEETS, TERM_LABEL, type Pp5File } from "@/lib/pp5-grades";
import { classroomName } from "@/lib/domain";
import { Button, Card, Stepper } from "@/components/ui";
import { useToast } from "@/components/toast";

type Room = { id: number; year: number; grade: string; room: number };
type Summary = { matched: number; students: number; unmatched: number[]; other_room: number[]; subjects_new: number; terms: number[];
  added: number; changed: number; removed: number; unchanged: number; assessments: number };
type Item = { file: File; parsed?: Pp5File; room?: Room; summary?: Summary; error?: string; done?: boolean };

function payload(p: Pp5File) {
  return {
    p_subjects: p.subjects.map((s) => ({ code: s.code, name: s.name, hours: s.hours, area: s.area, grade: s.grade })),
    p_students: p.students.map((s) => ({ citizen_id: s.citizen_id, number: s.number, results: s.results, assessments: s.assessments })),
  };
}

/** นำเข้าไฟล์ ปพ.5: อ่านไฟล์บนเครื่อง → ตรวจกับข้อมูลเดิม (ยังไม่บันทึก) → ยืนยันนำเข้า */
export function Pp5Import({ classrooms, all }: { classrooms: Room[]; all: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);

  async function choose(files: FileList | null) {
    if (!files?.length) return;
    const list: Item[] = [];
    setStep(2);
    for (const [i, file] of [...files].entries()) {
      setBusy(`กำลังอ่านไฟล์ ${i + 1}/${files.length}: ${file.name}`);
      const item: Item = { file };
      try {
        const parsed = parsePp5Workbook(await readWorkbook(file, PP5_SHEETS));
        item.parsed = parsed;
        item.room = classrooms.find((c) => c.year === parsed.year && c.grade === parsed.grade && c.room === parsed.room);
        if (!item.room) item.error = `ไม่พบห้อง ${parsed.grade ?? "?"}/${parsed.room ?? "?"} ปีการศึกษา ${parsed.year ?? "?"} ในระบบ${all ? "" : " หรือท่านไม่ใช่ครูที่ปรึกษาของห้องนี้"}`;
        else {
          const { data, error } = await supabaseBrowser().rpc("import_pp5", { p_classroom: item.room.id, p_term: parsed.term, p_file_name: file.name, ...payload(parsed), p_dry_run: true });
          if (error) item.error = error.message; else item.summary = data as Summary;
        }
      } catch (e) {
        item.error = (e as Error).message || "อ่านไฟล์ไม่ได้";
      }
      list.push(item);
    }
    setItems(list);
    setBusy(null);
  }

  async function confirm() {
    const ready = items.filter((x) => x.summary && x.parsed && x.room && !x.done);
    setStep(3);
    for (const [i, it] of ready.entries()) {
      setBusy(`กำลังนำเข้า ${i + 1}/${ready.length}: ${classroomName(it.room!)}`);
      const { error } = await supabaseBrowser().rpc("import_pp5", { p_classroom: it.room!.id, p_term: it.parsed!.term, p_file_name: it.file.name, ...payload(it.parsed!), p_dry_run: false });
      setItems((xs) => xs.map((x) => (x === it ? { ...x, done: !error, error: error?.message } : x)));
      if (error) toast(`${classroomName(it.room!)}: ${error.message}`, "error");
    }
    setBusy(null);
    toast("นำเข้าผลการเรียนเรียบร้อย");
    router.refresh();
  }

  const ready = items.filter((x) => x.summary);
  return (
    <div className="flex flex-col gap-3">
      <Stepper steps={["เลือกไฟล์", "ตรวจก่อนนำเข้า", "นำเข้า"]} current={step} />

      {step === 1 && (
        <Card className="flex flex-col gap-3">
          <ol className="list-decimal pl-5 text-[0.9375rem] text-muted">
            <li>เปิดไฟล์โปรแกรม ปพ.5-6 ของห้อง ตรวจว่ากรอกคะแนนและบันทึกไฟล์แล้ว</li>
            <li>เลือกไฟล์ด้านล่าง {all ? "(เลือกได้หลายห้องพร้อมกัน)" : ""} ระบบอ่านไฟล์บนเครื่องนี้ ไม่ต้องรอส่งไฟล์</li>
            <li>ตรวจจำนวนรายการที่จะเพิ่ม/แก้ไข แล้วกดยืนยัน — นำเข้าซ้ำได้ ระบบใช้ไฟล์ล่าสุด</li>
          </ol>
          <label className="flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-violet-300 bg-violet-50 p-6 text-center font-semibold text-violet-800">
            <FileArrowUp size={44} weight="duotone" />
            แตะเพื่อเลือกไฟล์ ปพ.5 (.xlsb / .xlsx)
            <input type="file" accept=".xlsb,.xlsx,.xlsm" multiple={all} className="sr-only" onChange={(e) => choose(e.target.files)} />
          </label>
        </Card>
      )}

      {busy && <Card className="animate-pulse text-center font-semibold text-violet-800">{busy}</Card>}

      {items.map((it, i) => (
        <Card key={i} className="flex flex-col gap-2">
          <div className="flex items-start gap-2">
            {it.done ? <CheckCircle size={26} weight="fill" className="shrink-0 text-green-600" /> : it.error ? <XCircle size={26} weight="fill" className="shrink-0 text-red-600" /> : <FileArrowUp size={26} weight="duotone" className="shrink-0 text-violet-700" />}
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{it.room ? classroomName(it.room) : "ไม่ทราบห้อง"} · {it.parsed?.term ? `ภาคเรียนที่ ${it.parsed.term}` : ""}/{it.parsed?.year ?? "-"}</p>
              <p className="truncate text-xs text-muted">{it.file.name}</p>
            </div>
            {it.done && <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-bold text-green-800">นำเข้าแล้ว</span>}
          </div>
          {it.error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-900">{it.error}</p>}
          {it.summary && (
            <>
              <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
                <div className="rounded-xl bg-slate-100 p-2"><p className="text-xl font-bold">{it.summary.matched}/{it.summary.students}</p><p className="text-xs">นักเรียนที่พบ</p></div>
                <div className="rounded-xl bg-green-100 p-2 text-green-900"><p className="text-xl font-bold">{it.summary.added}</p><p className="text-xs">เกรดเพิ่มใหม่</p></div>
                <div className="rounded-xl bg-amber-100 p-2 text-amber-900"><p className="text-xl font-bold">{it.summary.changed}</p><p className="text-xs">เกรดเปลี่ยน</p></div>
                <div className="rounded-xl bg-red-100 p-2 text-red-900"><p className="text-xl font-bold">{it.summary.removed}</p><p className="text-xs">ถูกลบออก</p></div>
              </div>
              <p className="text-sm text-muted">
                {it.parsed!.subjects.length} รายวิชา{it.summary.subjects_new ? ` (วิชาใหม่ ${it.summary.subjects_new})` : ""} ·
                ข้อมูล: {it.summary.terms.length ? it.summary.terms.map((t) => TERM_LABEL[t]).join(", ") : "ยังไม่มีเกรด"} ·
                คุณลักษณะ/อ่านคิดวิเคราะห์/กิจกรรม {it.summary.assessments} รายการ
              </p>
              {it.summary.added + it.summary.changed + it.summary.removed === 0 && it.summary.assessments === 0 && (
                <p className="rounded-xl bg-sky-50 p-2.5 text-sm text-sky-900">ไฟล์นี้ยังไม่มีคะแนนที่กรอกไว้ หรือข้อมูลตรงกับในระบบแล้ว</p>
              )}
              {[...it.summary.unmatched.length ? [`ไม่พบนักเรียนเลขที่ ${it.summary.unmatched.join(", ")} ในระบบ (ตรวจเลขประจำตัวประชาชนในไฟล์ หรือนำเข้า DMC ก่อน) — ข้ามคนเหล่านี้`] : [],
                ...it.summary.other_room.length ? [`เลขที่ ${it.summary.other_room.join(", ")} ไม่ได้อยู่ห้องนี้ในระบบ (อาจย้ายห้อง) — ยังนำเข้าให้`] : [],
                ...(it.parsed?.warnings ?? [])].map((w) => (
                <p key={w} className="flex items-start gap-1.5 rounded-xl bg-amber-50 p-2.5 text-sm text-amber-950"><Warning size={18} weight="fill" className="mt-0.5 shrink-0 text-amber-600" />{w}</p>
              ))}
            </>
          )}
        </Card>
      ))}

      {step === 2 && !busy && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={confirm} disabled={!ready.length}>ยืนยันนำเข้า {ready.length} ห้อง</Button>
          <Button variant="secondary" onClick={() => { setItems([]); setStep(1); }}>เลือกไฟล์ใหม่</Button>
        </div>
      )}
      {step === 3 && !busy && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => router.push("/grades")}>ดูผลการเรียน</Button>
          <Button variant="secondary" onClick={() => { setItems([]); setStep(1); }}>นำเข้าไฟล์อื่น</Button>
        </div>
      )}
    </div>
  );
}
