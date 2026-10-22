"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash, SortAscending } from "@phosphor-icons/react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Badge, Button, Card, Field, SectionTitle } from "@/components/ui";
import { useToast } from "@/components/toast";
import { compareForNumbering, fullName, GRADE_CODES, STUDENT_STATUSES } from "@/lib/domain";

export function AddClassroom({ year }: { year: number }) {
  const router = useRouter();
  const toast = useToast();
  const ref = useRef<HTMLDialogElement>(null);
  const [grade, setGrade] = useState<string>("อ.1");
  const [room, setRoom] = useState(1);
  async function add() {
    const sb = supabaseBrowser();
    await sb.from("academic_years").upsert({ year }, { onConflict: "year", ignoreDuplicates: true });
    const { error } = await sb.from("classrooms").insert({ year, grade, room });
    if (error) return toast(error.code === "23505" ? "มีห้องนี้อยู่แล้ว" : error.message, "error");
    ref.current?.close();
    toast(`เพิ่มห้อง ${grade}/${room} แล้ว`);
    router.refresh();
  }
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => ref.current?.showModal()} disabled={!year}><Plus size={20} weight="bold" /> เพิ่มห้อง</Button>
      <dialog ref={ref} className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-3xl p-0 shadow-2xl backdrop:bg-slate-900/40">
        <div className="flex flex-col gap-4 p-5 text-ink">
          <h2 className="text-lg font-semibold">เพิ่มห้องเรียน ปี {year}</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="ชั้น" htmlFor="ac-grade"><select id="ac-grade" className="field-input" value={grade} onChange={(e) => setGrade(e.target.value)}>{GRADE_CODES.map((g) => <option key={g}>{g}</option>)}</select></Field>
            <Field label="ห้อง" htmlFor="ac-room"><input id="ac-room" type="number" min={1} max={20} className="field-input" value={room} onChange={(e) => setRoom(Number(e.target.value))} /></Field>
          </div>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => ref.current?.close()}>ยกเลิก</Button><Button onClick={add}>เพิ่มห้อง</Button></div>
        </div>
      </dialog>
    </>
  );
}

export function HomeroomEditor({ classroomId, title, assigned, staff }: {
  classroomId: number; title: string; assigned: { id: number; kind: string; name: string }[]; staff: { id: string; name: string }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [who, setWho] = useState("");
  const [kind, setKind] = useState<"homeroom" | "assistant">("homeroom");
  const homeroomCount = assigned.filter((a) => a.kind === "homeroom").length;

  async function add() {
    if (!who) return;
    const { error } = await supabaseBrowser().from("homeroom_assignments").insert({ classroom_id: classroomId, staff_id: who, kind });
    if (error) return toast(error.code === "23505" ? "ครูท่านนี้อยู่ในห้องนี้แล้ว" : error.message, "error");
    setWho("");
    toast("เพิ่มแล้ว");
    router.refresh();
  }
  async function remove(id: number) {
    const { error } = await supabaseBrowser().from("homeroom_assignments").delete().eq("id", id);
    if (error) return toast(error.message, "error");
    router.refresh();
  }

  return (
    <Card>
      <SectionTitle>ครูที่ปรึกษา {title}</SectionTitle>
      <ul className="mb-3 flex flex-col gap-2">
        {assigned.length === 0 && <li className="rounded-xl bg-amber-50 px-3 py-2.5 text-amber-950">ยังไม่มีครูที่ปรึกษา — ห้องนี้จะยังเช็กชื่อไม่ได้</li>}
        {assigned.map((a) => (
          <li key={a.id} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2">
            <span className="flex-1 font-semibold">{a.name}</span>
            <Badge tone={a.kind === "homeroom" ? "blue" : "gray"}>{a.kind === "homeroom" ? "ครูที่ปรึกษา" : "ครูพี่เลี้ยง"}</Badge>
            <button type="button" aria-label={`นำ ${a.name} ออก`} onClick={() => remove(a.id)} className="rounded-lg p-2 text-red-700 hover:bg-red-50"><Trash size={20} /></button>
          </li>
        ))}
      </ul>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <label className="sr-only" htmlFor="hr-who">เลือกครู</label>
        <select id="hr-who" className="field-input" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">เลือกครู…</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <label className="sr-only" htmlFor="hr-kind">บทบาท</label>
        <select id="hr-kind" className="field-input" value={kind} onChange={(e) => setKind(e.target.value as "homeroom" | "assistant")}>
          <option value="homeroom" disabled={homeroomCount >= 2}>ครูที่ปรึกษา{homeroomCount >= 2 ? " (ครบ 2 คน)" : ""}</option>
          <option value="assistant">ครูพี่เลี้ยง</option>
        </select>
        <Button onClick={add} disabled={!who}><Plus size={20} weight="bold" /> เพิ่ม</Button>
      </div>
      <p className="mt-2 text-sm text-muted">ครูที่ปรึกษาไม่เกิน 2 คน · ครูพี่เลี้ยงเช็กชื่อได้แต่ไม่เห็นข้อมูลส่วนตัวของนักเรียน</p>
    </Card>
  );
}

export function RosterManager({ classroomId, title, roster, classrooms }: {
  classroomId: number; title: string; classrooms: { id: number; name: string }[];
  roster: { student_id: string; number: number | null; prefix: string | null; first_name: string; last_name: string; gender: string | null; status: string }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function renumber() {
    if (!confirm("เรียงเลขที่ใหม่ทั้งห้อง: ชายก่อนหญิง แล้วเรียงตามชื่อ (นักเรียนที่ไม่ได้กำลังศึกษาจะอยู่ท้าย)?")) return;
    setBusy(true);
    const active = roster.filter((r) => r.status === "studying").sort(compareForNumbering);
    const others = roster.filter((r) => r.status !== "studying");
    const { error } = await supabaseBrowser().rpc("renumber_classroom", { p_classroom: classroomId, p_students: [...active, ...others].map((r) => r.student_id) });
    setBusy(false);
    if (error) return toast(error.message, "error");
    toast("เรียงเลขที่ใหม่แล้ว");
    router.refresh();
  }
  async function move(studentId: string, to: number) {
    const { error } = await supabaseBrowser().rpc("move_student", { p_student: studentId, p_classroom: to });
    if (error) return toast(error.message, "error");
    toast("ย้ายห้องแล้ว");
    router.refresh();
  }

  return (
    <Card>
      <SectionTitle action={<Button variant="secondary" size="sm" onClick={renumber} disabled={busy || !roster.length}><SortAscending size={20} weight="duotone" /> เรียงเลขที่ใหม่</Button>}>
        นักเรียน {title} ({roster.filter((r) => r.status === "studying").length} คน)
      </SectionTitle>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>เลขที่</th><th>ชื่อ-สกุล</th><th>สถานะ</th><th>ย้ายไปห้อง</th></tr></thead>
          <tbody>
            {roster.map((r) => (
              <tr key={r.student_id}>
                <td className="w-16">{r.number ?? "-"}</td>
                <td className="font-semibold">{fullName(r, true)}</td>
                <td>{r.status === "studying" ? "-" : <Badge tone={STUDENT_STATUSES[r.status]?.tone ?? "gray"}>{STUDENT_STATUSES[r.status]?.label}</Badge>}</td>
                <td className="w-44">
                  <label className="sr-only" htmlFor={`mv-${r.student_id}`}>ย้าย {r.first_name} ไปห้อง</label>
                  <select id={`mv-${r.student_id}`} className="field-input min-h-10" value="" onChange={(e) => e.target.value && move(r.student_id, Number(e.target.value))}>
                    <option value="">—</option>
                    {classrooms.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
