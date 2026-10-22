"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PencilSimple, ArrowsLeftRight } from "@phosphor-icons/react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Button, Field } from "@/components/ui";
import { useToast } from "@/components/toast";
import { classroomName, gradeSort, STUDENT_STATUSES } from "@/lib/domain";
import { todayISO } from "@/lib/thai-date";

export function ExtraForm({ studentId, nickname, note, canEdit }: { studentId: string; nickname: string | null; note: string | null; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [nick, setNick] = useState(nickname ?? "");
  const [text, setText] = useState(note ?? "");
  const [busy, setBusy] = useState(false);
  const dirty = nick !== (nickname ?? "") || text !== (note ?? "");

  async function save() {
    setBusy(true);
    const { error } = await supabaseBrowser().rpc("update_student_extra", { p_student: studentId, p_nickname: nick, p_note: text });
    setBusy(false);
    if (error) return toast(error.message, "error");
    toast("บันทึกข้อมูลเพิ่มเติมแล้ว");
    router.refresh();
  }

  return (
    <div className="grid gap-3 md:grid-cols-[1fr_2fr]">
      <Field label="ชื่อเล่น" htmlFor="nick" hint="เช่น น้องมิ้นท์ — แสดงในหน้าเช็กชื่อ">
        <input id="nick" className="field-input" value={nick} disabled={!canEdit} maxLength={30} onChange={(e) => setNick(e.target.value)} />
      </Field>
      <Field label="หมายเหตุ" htmlFor="note" hint="ข้อมูลที่ครูควรรู้ เช่น แพ้อาหาร โรคประจำตัว ผู้รับ-ส่ง">
        <textarea id="note" className="field-input" value={text} disabled={!canEdit} maxLength={1000} onChange={(e) => setText(e.target.value)} />
      </Field>
      {canEdit && (
        <div className="md:col-span-2">
          <Button onClick={save} disabled={!dirty || busy}>{busy ? "กำลังบันทึก…" : "บันทึกข้อมูลเพิ่มเติม"}</Button>
        </div>
      )}
    </div>
  );
}

export function AdminActions({ studentId, status, classrooms, currentClassroom }: {
  studentId: string; status: string; classrooms: { id: number; grade: string; room: number }[]; currentClassroom?: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const statusRef = useRef<HTMLDialogElement>(null);
  const moveRef = useRef<HTMLDialogElement>(null);
  const [next, setNext] = useState(status === "studying" ? "moved_out" : "studying");
  const [date, setDate] = useState(todayISO());
  const [reason, setReason] = useState("");
  const [room, setRoom] = useState<number | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function changeStatus() {
    if (!reason.trim()) return setError("กรุณาระบุเหตุผล เช่น ย้ายตามผู้ปกครองไปจังหวัด...");
    setBusy(true);
    const { error } = await supabaseBrowser().rpc("change_student_status", { p_student: studentId, p_status: next, p_date: date, p_reason: reason });
    setBusy(false);
    if (error) return setError(error.message);
    statusRef.current?.close();
    toast(`เปลี่ยนสถานะเป็น "${STUDENT_STATUSES[next].label}" แล้ว`);
    router.refresh();
  }

  async function move() {
    if (!room) return;
    setBusy(true);
    const { error } = await supabaseBrowser().rpc("move_student", { p_student: studentId, p_classroom: room });
    setBusy(false);
    if (error) return toast(error.message, "error");
    moveRef.current?.close();
    toast("ย้ายห้องแล้ว (ได้เลขที่ต่อท้ายห้องใหม่)");
    router.refresh();
  }

  const dialogClass = "m-auto w-[min(32rem,calc(100vw-2rem))] rounded-3xl p-0 shadow-2xl backdrop:bg-slate-900/40";
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => { setError(null); statusRef.current?.showModal(); }}><PencilSimple size={20} weight="duotone" /> เปลี่ยนสถานะ</Button>
      {classrooms.length > 0 && <Button variant="secondary" size="sm" onClick={() => moveRef.current?.showModal()}><ArrowsLeftRight size={20} weight="duotone" /> ย้ายห้อง</Button>}

      <dialog ref={statusRef} className={dialogClass}>
        <div className="flex flex-col gap-4 p-5 text-ink">
          <h2 className="text-lg font-semibold">เปลี่ยนสถานะนักเรียน</h2>
          <Field label="สถานะใหม่" htmlFor="st-next">
            <select id="st-next" className="field-input" value={next} onChange={(e) => setNext(e.target.value)}>
              {Object.entries(STUDENT_STATUSES).filter(([k]) => k !== status).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </Field>
          <Field label="วันที่มีผล" htmlFor="st-date">
            <input id="st-date" type="date" className="field-input" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="เหตุผล" htmlFor="st-reason" required error={error} hint="บันทึกไว้ในประวัติ ใช้ตรวจสอบย้อนหลังได้">
            <textarea id="st-reason" className="field-input" value={reason} onChange={(e) => { setReason(e.target.value); setError(null); }} aria-invalid={!!error} />
          </Field>
          {next !== "studying" && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-950">นักเรียนจะหายจากหน้าเช็กชื่อ แต่ข้อมูลเดิมทั้งหมดยังอยู่ครบ</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => statusRef.current?.close()}>ยกเลิก</Button>
            <Button onClick={changeStatus} disabled={busy}>{busy ? "กำลังบันทึก…" : "ยืนยันเปลี่ยนสถานะ"}</Button>
          </div>
        </div>
      </dialog>

      <dialog ref={moveRef} className={dialogClass}>
        <div className="flex flex-col gap-4 p-5 text-ink">
          <h2 className="text-lg font-semibold">ย้ายห้อง (ปีการศึกษาปัจจุบัน)</h2>
          <Field label="ห้องปลายทาง" htmlFor="mv-room" hint="ประวัติการเช็กชื่อเดิมยังอยู่กับห้องเดิม">
            <select id="mv-room" className="field-input" value={room} onChange={(e) => setRoom(Number(e.target.value) || "")}>
              <option value="">เลือกห้อง</option>
              {[...classrooms].sort((a, b) => gradeSort(a.grade) - gradeSort(b.grade) || a.room - b.room)
                .filter((c) => c.id !== currentClassroom).map((c) => <option key={c.id} value={c.id}>{classroomName(c)}</option>)}
            </select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => moveRef.current?.close()}>ยกเลิก</Button>
            <Button onClick={move} disabled={busy || !room}>ย้ายห้อง</Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
