"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle } from "@phosphor-icons/react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { classroomName, fullName, gradeSort, nextGrade } from "@/lib/domain";
import { Button, Card, Stepper, Stat } from "@/components/ui";
import { useToast } from "@/components/toast";

export type PromoteStudent = { id: string; number: number | null; grade: string; room: number; prefix: string | null; first_name: string; last_name: string };

export function PromoteWizard({ from, students, alreadyPromoted }: { from: number; students: PromoteStudent[]; alreadyPromoted: number }) {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState(1);
  const [repeaters, setRepeaters] = useState<Set<string>>(new Set());
  const [room, setRoom] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ promoted: number; repeated: number; graduated: number } | null>(null);
  const to = from + 1;

  const rooms = useMemo(() => [...new Set(students.map((s) => `${s.grade}/${s.room}`))]
    .sort((a, b) => gradeSort(a.split("/")[0]) - gradeSort(b.split("/")[0]) || a.localeCompare(b)), [students]);
  const currentRoom = room || rooms[0];
  const inRoom = students.filter((s) => `${s.grade}/${s.room}` === currentRoom).sort((a, b) => (a.number ?? 99) - (b.number ?? 99));
  const graduating = students.filter((s) => s.grade === "ป.6" && !repeaters.has(s.id)).length;

  function toggle(id: string) {
    setRepeaters((r) => { const n = new Set(r); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  async function run() {
    if (!confirm(`ยืนยันเลื่อนชั้นนักเรียน ${students.length} คน ไปปีการศึกษา ${to}?`)) return;
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("promote_year", { p_from: from, p_to: to, p_repeaters: [...repeaters] });
    setBusy(false);
    if (error) return toast(error.message, "error");
    setResult(data);
    setStep(4);
    router.refresh();
  }

  async function setCurrentYear() {
    const { error } = await supabaseBrowser().from("school_settings").update({ current_year: to }).eq("id", 1);
    if (error) return toast(error.message, "error");
    toast(`ตั้งปีการศึกษาปัจจุบันเป็น ${to} แล้ว`);
    router.push("/settings");
  }

  return (
    <div className="flex flex-col gap-4">
      <Stepper steps={["ตรวจปี", "เลือกคนซ้ำชั้น", "ยืนยัน", "เสร็จสิ้น"]} current={step} />

      {step === 1 && (
        <Card className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label={`นักเรียนปี ${from}`} value={students.length} tone="blue" />
            <Stat label="จะจบการศึกษา (ป.6)" value={students.filter((s) => s.grade === "ป.6").length} tone="green" />
            <Stat label="ห้องเรียน" value={rooms.length} tone="gray" />
          </div>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[0.9375rem]">
            <li>ทุกคนเลื่อนขึ้นชั้นถัดไป <b>ในห้องเดิม</b> และใช้เลขที่เดิม (อ.3 → ป.1)</li>
            <li>ป.6 เปลี่ยนสถานะเป็น &ldquo;จบการศึกษา&rdquo; พร้อมบันทึกประวัติ</li>
            <li>คนที่ซ้ำชั้นอยู่ชั้นเดิมห้องเดิม</li>
            <li>ข้อมูลปี {from} ทั้งหมดยังอยู่ ดูย้อนหลังได้</li>
          </ul>
          {alreadyPromoted > 0 && <p className="rounded-2xl bg-amber-50 p-3 font-semibold text-amber-950">ปี {to} มีนักเรียนแล้ว {alreadyPromoted} คน (เช่น นำเข้า อ.1 ใหม่ไว้แล้ว) — คนที่มีห้องในปี {to} แล้วจะไม่ถูกเลื่อนซ้ำ</p>}
          <div className="flex justify-end"><Button onClick={() => setStep(2)} disabled={!students.length}>ถัดไป ›</Button></div>
        </Card>
      )}

      {step === 2 && (
        <Card className="flex flex-col gap-3">
          <p className="text-[0.9375rem]">เลือกนักเรียนที่ <b>ซ้ำชั้น</b> (ถ้าไม่มี กดถัดไปได้เลย) · เลือกแล้ว {repeaters.size} คน</p>
          <nav className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {rooms.map((r) => (
              <button key={r} type="button" onClick={() => setRoom(r)} aria-pressed={r === currentRoom}
                className={`shrink-0 rounded-xl px-3.5 py-2 text-sm font-bold ${r === currentRoom ? "bg-sky-600 text-white" : "border-[1.5px] border-slate-300 bg-white"}`}>
                {r} {students.some((s) => `${s.grade}/${s.room}` === r && repeaters.has(s.id)) ? "•" : ""}
              </button>
            ))}
          </nav>
          <ul className="grid gap-2 sm:grid-cols-2">
            {inRoom.map((s) => (
              <li key={s.id}>
                <label className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border-[1.5px] px-3 ${repeaters.has(s.id) ? "border-amber-400 bg-amber-50" : "border-line bg-white"}`}>
                  <input type="checkbox" className="size-5" checked={repeaters.has(s.id)} onChange={() => toggle(s.id)} />
                  <span className="w-7 text-sm text-muted">{s.number ?? "-"}</span>
                  <span className="flex-1 font-semibold">{fullName(s, true)}</span>
                  <span className="text-sm text-muted">{repeaters.has(s.id) ? `ซ้ำ ${s.grade}` : nextGrade(s.grade) ? `→ ${nextGrade(s.grade)}` : "จบ"}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex justify-between"><Button variant="secondary" onClick={() => setStep(1)}>‹ ย้อนกลับ</Button><Button onClick={() => setStep(3)}>ถัดไป ›</Button></div>
        </Card>
      )}

      {step === 3 && (
        <Card className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label={`เลื่อนชั้นไปปี ${to}`} value={students.length - repeaters.size - graduating} tone="green" />
            <Stat label="ซ้ำชั้น" value={repeaters.size} tone="amber" />
            <Stat label="จบการศึกษา" value={graduating} tone="blue" />
          </div>
          {repeaters.size > 0 && (
            <p className="text-sm text-muted">ซ้ำชั้น: {students.filter((s) => repeaters.has(s.id)).map((s) => `${fullName(s, true)} (${classroomName(s)})`).join(", ")}</p>
          )}
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="secondary" onClick={() => setStep(2)} disabled={busy}>‹ ย้อนกลับ</Button>
            <Button variant="success" size="lg" onClick={run} disabled={busy}>{busy ? "กำลังเลื่อนชั้น…" : "ยืนยันเลื่อนชั้น"}</Button>
          </div>
        </Card>
      )}

      {step === 4 && result && (
        <Card className="flex flex-col items-center gap-3 py-8 text-center">
          <CheckCircle size={72} weight="duotone" className="text-green-600" />
          <h2 className="text-2xl font-semibold">เลื่อนชั้นเรียบร้อย</h2>
          <p className="text-muted">เลื่อนชั้น {result.promoted} คน · ซ้ำชั้น {result.repeated} คน · จบการศึกษา {result.graduated} คน</p>
          <div className="mt-2 w-full max-w-md rounded-2xl bg-sky-50 p-4 text-left">
            <p className="mb-2 font-semibold text-sky-950">ขั้นต่อไป</p>
            <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[0.9375rem] text-sky-950">
              <li>ตั้งวันเปิด-ปิดภาคเรียนของปี {to} ในหน้าตั้งค่า</li>
              <li>นำเข้านักเรียน อ.1 ใหม่ (และนักเรียนย้ายเข้า) จาก DMC โดยเลือกปี {to}</li>
              <li>จัดห้องใหม่และกำหนดครูที่ปรึกษาที่หน้า &ldquo;ห้องเรียน&rdquo;</li>
              <li>เปลี่ยนปีการศึกษาปัจจุบันเป็น {to}</li>
            </ol>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={setCurrentYear}>ตั้งปีปัจจุบันเป็น {to}</Button>
            <Link href={`/classrooms?y=${to}`} className="rounded-xl border-[1.5px] border-slate-300 bg-white px-4 py-3 font-semibold">ไปจัดห้อง</Link>
          </div>
        </Card>
      )}
    </div>
  );
}
