"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Check, X, Trash, Key } from "@phosphor-icons/react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Button, Field, Badge } from "@/components/ui";
import { useToast } from "@/components/toast";
import { ROLES } from "@/lib/domain";
import { createLoginAccount, resetPassword } from "./actions";

const PREFIXES = ["นาย", "นาง", "นางสาว", "ว่าที่ร้อยตรี", "ดร."];
const POSITIONS = ["ผู้อำนวยการ", "รองผู้อำนวยการ", "ครู", "ครูผู้ช่วย", "พนักงานราชการ", "ครูอัตราจ้าง", "ครูพี่เลี้ยง", "เจ้าหน้าที่ธุรการ", "บุคลากรอื่น"];
const RANKS = ["-", "ชำนาญการ", "ชำนาญการพิเศษ", "เชี่ยวชาญ", "เชี่ยวชาญพิเศษ"];
const AREAS = ["ปฐมวัย", "ภาษาไทย", "คณิตศาสตร์", "วิทยาศาสตร์และเทคโนโลยี", "สังคมศึกษา ศาสนาและวัฒนธรรม", "สุขศึกษาและพลศึกษา", "ศิลปะ", "การงานอาชีพ", "ภาษาต่างประเทศ", "-"];

export type StaffData = {
  id?: string; prefix: string | null; first_name: string; last_name: string; position: string | null; academic_rank: string | null;
  learning_area: string | null; phone: string | null; email: string | null; roles: string[]; active?: boolean;
};

const EMPTY: StaffData = { prefix: "นาง", first_name: "", last_name: "", position: "ครู", academic_rank: "-", learning_area: "-", phone: "", email: "", roles: [] };

/** ฟอร์มข้อมูลครู ใช้ทั้งเพิ่มใหม่และแก้ไข */
export function StaffForm({ initial = EMPTY, onSaved, canEdit = true }: { initial?: StaffData; onSaved?: (id: string) => void; canEdit?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [d, setD] = useState<StaffData>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof StaffData, v: string) => { setD((x) => ({ ...x, [k]: v })); setErrors((e) => ({ ...e, [k]: "" })); };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!d.first_name.trim()) errs.first_name = "กรุณากรอกชื่อ";
    if (d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) errs.email = "รูปแบบอีเมลไม่ถูกต้อง เช่น somjai@gmail.com";
    if (d.phone && d.phone.replace(/\D/g, "").length < 9) errs.phone = "เบอร์โทรควรมี 9–10 หลัก เช่น 081-234-5678";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    const row = {
      prefix: d.prefix || null, first_name: d.first_name.trim(), last_name: d.last_name.trim(), position: d.position || null,
      academic_rank: d.academic_rank === "-" ? null : d.academic_rank, learning_area: d.learning_area === "-" ? null : d.learning_area,
      phone: d.phone?.trim() || null, email: d.email?.trim().toLowerCase() || null,
    };
    const sb = supabaseBrowser();
    const res = d.id
      ? await sb.from("staff").update(row).eq("id", d.id).select("id").single()
      : await sb.from("staff").insert({ ...row, approved: true }).select("id").single();
    setBusy(false);
    if (res.error) return toast(res.error.code === "23505" ? "อีเมลนี้มีในทะเบียนครูแล้ว" : res.error.message, "error");
    toast(d.id ? "บันทึกข้อมูลครูแล้ว" : "เพิ่มครูแล้ว");
    onSaved?.(res.data.id);
    router.refresh();
  }

  const input = (k: keyof StaffData, label: string, hint?: string, type = "text") => (
    <Field label={label} htmlFor={`sf-${k}`} hint={hint} error={errors[k]} required={k === "first_name"}>
      <input id={`sf-${k}`} type={type} className="field-input" value={(d[k] as string) ?? ""} disabled={!canEdit}
        onChange={(e) => set(k, e.target.value)} aria-invalid={!!errors[k]} />
    </Field>
  );
  const select = (k: keyof StaffData, label: string, list: string[]) => (
    <Field label={label} htmlFor={`sf-${k}`}>
      <select id={`sf-${k}`} className="field-input" value={(d[k] as string) ?? "-"} disabled={!canEdit} onChange={(e) => set(k, e.target.value)}>
        {list.map((x) => <option key={x}>{x}</option>)}
      </select>
    </Field>
  );

  return (
    <form onSubmit={save} className="grid gap-3 sm:grid-cols-2" noValidate>
      {select("prefix", "คำนำหน้า", PREFIXES)}
      <div />
      {input("first_name", "ชื่อ")}
      {input("last_name", "นามสกุล")}
      {select("position", "ตำแหน่ง", POSITIONS)}
      {select("academic_rank", "วิทยฐานะ", RANKS)}
      {select("learning_area", "กลุ่มสาระ", AREAS)}
      {input("phone", "โทรศัพท์", "เช่น 081-234-5678", "tel")}
      <div className="sm:col-span-2">{input("email", "อีเมล Google สำหรับเข้าระบบ", "ครูกดเข้าสู่ระบบด้วย Google ด้วยอีเมลนี้ได้ทันที ไม่ต้องรออนุมัติ", "email")}</div>
      {canEdit && <div className="sm:col-span-2"><Button type="submit" disabled={busy}>{busy ? "กำลังบันทึก…" : d.id ? "บันทึกข้อมูล" : "เพิ่มครู"}</Button></div>}
    </form>
  );
}

export function AddStaff() {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [key, setKey] = useState(0);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => { setKey((k) => k + 1); ref.current?.showModal(); }}><Plus size={20} weight="bold" /> เพิ่มครู</Button>
      <dialog ref={ref} className="m-auto w-[min(40rem,calc(100vw-2rem))] rounded-3xl p-0 shadow-2xl backdrop:bg-slate-900/40">
        <div className="flex max-h-[90dvh] flex-col text-ink">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="text-lg font-semibold">เพิ่มครูและบุคลากร</h2>
            <button type="button" aria-label="ปิด" onClick={() => ref.current?.close()} className="rounded-lg p-2 hover:bg-slate-100"><X size={20} /></button>
          </div>
          <div className="overflow-y-auto p-5">
            <StaffForm key={key} onSaved={(id) => { ref.current?.close(); router.push(`/staff/${id}`); }} />
          </div>
        </div>
      </dialog>
    </>
  );
}

export function ApproveButtons({ staffId }: { staffId: string }) {
  const router = useRouter();
  const toast = useToast();
  async function update(values: Record<string, boolean>, msg: string) {
    const { error } = await supabaseBrowser().from("staff").update(values).eq("id", staffId);
    if (error) return toast(error.message, "error");
    toast(msg);
    router.refresh();
  }
  return (
    <div className="flex gap-2">
      <Button variant="success" size="sm" onClick={() => update({ approved: true }, "อนุมัติแล้ว")}><Check size={18} weight="bold" /> อนุมัติ</Button>
      <Button variant="secondary" size="sm" onClick={() => confirm("ปฏิเสธบัญชีนี้?") && update({ active: false }, "ปฏิเสธแล้ว")}>ปฏิเสธ</Button>
    </div>
  );
}

export function RoleEditor({ staffId, roles, active, isSelf }: { staffId: string; roles: string[]; active: boolean; isSelf: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [r, setR] = useState<string[]>(roles);
  async function save(next: string[]) {
    setR(next);
    const { error } = await supabaseBrowser().from("staff").update({ roles: next }).eq("id", staffId);
    if (error) { setR(roles); return toast(error.message, "error"); }
    toast("บันทึกบทบาทแล้ว");
    router.refresh();
  }
  async function toggleActive() {
    if (!confirm(active ? "ปิดการใช้งานบัญชีนี้? (ข้อมูลเดิมยังอยู่ครบ)" : "เปิดใช้งานบัญชีนี้อีกครั้ง?")) return;
    const { error } = await supabaseBrowser().from("staff").update({ active: !active, approved: true }).eq("id", staffId);
    if (error) return toast(error.message, "error");
    router.refresh();
  }
  return (
    <div className="flex flex-col gap-2">
      {Object.entries(ROLES).map(([k, label]) => (
        <label key={k} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border-[1.5px] border-line px-3">
          <input type="checkbox" className="size-5" checked={r.includes(k)} disabled={isSelf && k === "admin"}
            onChange={(e) => save(e.target.checked ? [...r, k] : r.filter((x) => x !== k))} />
          <span className="font-semibold">{label}</span>
        </label>
      ))}
      <p className="text-sm text-muted">ครูที่ปรึกษาและครูประจำวิชาไม่ต้องติ๊ก ระบบรู้จากการมอบหมายห้องและวิชา</p>
      {!isSelf && <Button variant={active ? "secondary" : "success"} size="sm" onClick={toggleActive} className="self-start">{active ? "ปิดการใช้งานบัญชี" : "เปิดใช้งานบัญชี"}</Button>}
    </div>
  );
}

export function LoginAccount({ staffId, username, hasUser, email }: { staffId: string; username: string | null; hasUser: boolean; email: string | null }) {
  const toast = useToast();
  const router = useRouter();
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = username ? await resetPassword(staffId, p) : await createLoginAccount(staffId, u, p);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    toast(username ? "ตั้งรหัสผ่านใหม่แล้ว แจ้งครูให้เข้าระบบด้วยรหัสใหม่" : "สร้างบัญชีแล้ว");
    setP("");
    router.refresh();
  }

  if (hasUser && !username) {
    return <p className="text-[0.9375rem]">เข้าระบบด้วย Google <Badge tone="green">{email}</Badge></p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {username ? <p>ชื่อผู้ใช้: <b>{username}</b></p> : (
        <>
          {!hasUser && email && <p className="text-sm text-muted">ครูเข้าระบบด้วย Google ({email}) ได้เลย หรือสร้างชื่อผู้ใช้ด้านล่างสำหรับครูที่ไม่มีบัญชี Google</p>}
          <Field label="ชื่อผู้ใช้" htmlFor="la-u" hint="a-z 0-9 . _ - เช่น somjai.r">
            <input id="la-u" className="field-input" autoCapitalize="none" value={u} onChange={(e) => setU(e.target.value)} />
          </Field>
        </>
      )}
      <Field label={username ? "รหัสผ่านใหม่" : "รหัสผ่าน"} htmlFor="la-p" hint="อย่างน้อย 8 ตัวอักษร แจ้งครูทางช่องทางส่วนตัว" error={error}>
        <input id="la-p" type="text" className="field-input" autoComplete="new-password" value={p} onChange={(e) => setP(e.target.value)} />
      </Field>
      <Button onClick={submit} disabled={busy || p.length < 8 || (!username && !u)} className="self-start"><Key size={20} weight="duotone" />{username ? "ตั้งรหัสผ่านใหม่" : "สร้างบัญชีเข้าระบบ"}</Button>
    </div>
  );
}

export function TeachingEditor({ staffId, items, terms, subjects, classrooms }: {
  staffId: string;
  items: { id: number; term: string; subject: string; classroom: string }[];
  terms: { id: number; label: string }[];
  subjects: { id: number; label: string; grade: string | null }[];
  classrooms: { id: number; label: string; grade: string }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [term, setTerm] = useState(terms[0]?.id ?? 0);
  const [classroom, setClassroom] = useState(0);
  const [subject, setSubject] = useState(0);
  const grade = classrooms.find((c) => c.id === classroom)?.grade;
  const subjectOptions = subjects.filter((s) => !grade || !s.grade || s.grade === grade);

  async function add() {
    const { error } = await supabaseBrowser().from("teaching_assignments").insert({ staff_id: staffId, term_id: term, subject_id: subject, classroom_id: classroom });
    if (error) return toast(error.code === "23505" ? "วิชานี้ในห้องนี้มีครูสอนแล้ว (แก้ที่ครูท่านเดิมก่อน)" : error.message, "error");
    toast("เพิ่มวิชาที่สอนแล้ว");
    setSubject(0);
    router.refresh();
  }
  async function remove(id: number) {
    const { error } = await supabaseBrowser().from("teaching_assignments").delete().eq("id", id);
    if (error) return toast(error.message, "error");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 ? <p className="text-muted">ยังไม่มีวิชาที่สอน</p> : (
        <ul className="flex flex-col gap-2">
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2">
              <span className="flex-1"><b>{i.classroom}</b> · {i.subject} <span className="text-sm text-muted">({i.term})</span></span>
              <button type="button" aria-label="ลบ" onClick={() => remove(i.id)} className="rounded-lg p-2 text-red-700 hover:bg-red-50"><Trash size={20} /></button>
            </li>
          ))}
        </ul>
      )}
      {terms.length === 0 || subjects.length === 0 ? (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-950">ต้องตั้งค่าภาคเรียนและรายวิชาในหน้าตั้งค่าก่อน</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-4">
          <select aria-label="ภาคเรียน" className="field-input" value={term} onChange={(e) => setTerm(Number(e.target.value))}>{terms.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
          <select aria-label="ห้อง" className="field-input" value={classroom} onChange={(e) => { setClassroom(Number(e.target.value)); setSubject(0); }}>
            <option value={0}>เลือกห้อง…</option>{classrooms.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <select aria-label="วิชา" className="field-input" value={subject} onChange={(e) => setSubject(Number(e.target.value))}>
            <option value={0}>เลือกวิชา…</option>{subjectOptions.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <Button onClick={add} disabled={!term || !classroom || !subject}><Plus size={20} weight="bold" /> เพิ่ม</Button>
        </div>
      )}
    </div>
  );
}
