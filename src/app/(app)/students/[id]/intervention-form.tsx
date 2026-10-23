"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "@phosphor-icons/react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { INTERVENTION_DOMAINS, INTERVENTION_STATUS } from "@/lib/care";
import { todayISO } from "@/lib/thai-date";
import { Button, Field } from "@/components/ui";
import { useToast } from "@/components/toast";

/** บันทึกการช่วยเหลือ/ส่งต่อ (ครูที่ปรึกษา งานแนะแนว ผู้ดูแลระบบ) */
export function InterventionForm({ studentId, classroomId, year, defaultDomain }: { studentId: string; classroomId: number; year: number; defaultDomain?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ action_date: todayISO(), domain: defaultDomain ?? "behavior", activity: "", responsible: "", result: "", status: "ongoing" });
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!f.activity.trim()) return toast("กรุณาระบุกิจกรรม/วิธีการช่วยเหลือ", "error");
    setBusy(true);
    const { error } = await supabaseBrowser().from("interventions").insert({ ...f, student_id: studentId, classroom_id: classroomId, year });
    setBusy(false);
    if (error) return toast(error.message, "error");
    toast("บันทึกการช่วยเหลือแล้ว");
    setOpen(false);
    setF((x) => ({ ...x, activity: "", result: "" }));
    router.refresh();
  }

  if (!open) return <Button onClick={() => setOpen(true)}><Plus size={20} weight="bold" />บันทึกการช่วยเหลือ</Button>;
  return (
    <div className="grid gap-3 rounded-2xl border border-pink-200 bg-pink-50/50 p-3 sm:grid-cols-2">
      <Field label="วันที่" htmlFor="iv-date"><input id="iv-date" type="date" className="field-input" value={f.action_date} onChange={(e) => setF({ ...f, action_date: e.target.value })} /></Field>
      <Field label="ด้าน" htmlFor="iv-domain">
        <select id="iv-domain" className="field-input" value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value })}>
          {Object.entries(INTERVENTION_DOMAINS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <div className="sm:col-span-2">
        <Field label="กิจกรรม/วิธีการช่วยเหลือ" htmlFor="iv-act" required hint="เช่น พูดคุยรายบุคคล สอนซ่อมเสริม ประสานผู้ปกครอง ขอทุน">
          <textarea id="iv-act" className="field-input" value={f.activity} maxLength={1000} onChange={(e) => setF({ ...f, activity: e.target.value })} />
        </Field>
      </div>
      <Field label="ผู้รับผิดชอบ" htmlFor="iv-resp"><input id="iv-resp" className="field-input" value={f.responsible} onChange={(e) => setF({ ...f, responsible: e.target.value })} placeholder="เช่น ครูที่ปรึกษา, ครูแนะแนว, รพ.สต." /></Field>
      <Field label="สถานะ" htmlFor="iv-status">
        <select id="iv-status" className="field-input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          {Object.entries(INTERVENTION_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </Field>
      <div className="sm:col-span-2">
        <Field label="ผลการช่วยเหลือ" htmlFor="iv-result"><textarea id="iv-result" className="field-input" value={f.result} maxLength={1000} onChange={(e) => setF({ ...f, result: e.target.value })} /></Field>
      </div>
      <div className="flex gap-2 sm:col-span-2">
        <Button onClick={save} disabled={busy}>{busy ? "กำลังบันทึก…" : "บันทึก"}</Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>ยกเลิก</Button>
      </div>
    </div>
  );
}

/** เปลี่ยนสถานะการช่วยเหลือที่บันทึกไว้ */
export function InterventionStatus({ id, status, canEdit }: { id: string; status: string; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const st = INTERVENTION_STATUS[status];
  if (!canEdit) return <span className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: st?.bg, color: st?.fg }}>{st?.label ?? status}</span>;
  return (
    <select aria-label="สถานะ" className="min-h-10 rounded-full border-0 px-3 text-xs font-bold" style={{ background: st?.bg, color: st?.fg }} value={status}
      onChange={async (e) => {
        const { error } = await supabaseBrowser().from("interventions").update({ status: e.target.value }).eq("id", id);
        if (error) return toast(error.message, "error");
        toast("เปลี่ยนสถานะแล้ว");
        router.refresh();
      }}>
      {Object.entries(INTERVENTION_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
    </select>
  );
}
