"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Check, PenNib, UserCircle, Users, X } from "@phosphor-icons/react";
import { Button, Card, SectionTitle } from "@/components/ui";
import { useToast } from "@/components/toast";
import { supabaseBrowser } from "@/lib/supabase/client";
import { todayISO } from "@/lib/thai-date";
import { DEFAULT_PRESETS, latestFile, type BookDetail, type Preset, type PresetRole, type StaffOption } from "@/lib/saraban/book";
import type { SarabanRole } from "@/lib/saraban/types";
import { endorseBook, forwardBook, proposeBook } from "../../actions";
import { EncryptedPdfError, signAndUpload } from "../../pdf-client";

export type Me = { id: string; role: SarabanRole; workGroup: string | null; name: string };

/** แผ่นล่างจอ (มือถือ) / กล่องกลางจอ (จอใหญ่) ด้วย <dialog> */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} aria-label={title}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[90dvh] w-full max-w-full rounded-t-3xl p-0 shadow-2xl backdrop:bg-slate-900/40 md:inset-0 md:m-auto md:max-w-lg md:rounded-3xl">
      <div className="flex max-h-[90dvh] flex-col">
        <div className="flex items-center gap-3 border-b border-line px-5 py-3">
          <h2 className="flex-1 text-lg font-semibold">{title}</h2>
          <button type="button" aria-label="ปิด" onClick={onClose} className="flex size-11 items-center justify-center rounded-xl hover:bg-slate-100"><X size={20} /></button>
        </div>
        <div className="overflow-y-auto px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4">{children}</div>
      </div>
    </dialog>
  );
}

const chip = (active: boolean) =>
  `inline-flex min-h-11 items-center gap-1.5 rounded-full border-[1.5px] px-4 py-1.5 text-left text-[0.9375rem] font-semibold ${active ? "border-navy-700 bg-navy-700 text-white" : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"}`;

function presetTexts(presets: Preset[], role: PresetRole) {
  const mine = presets.filter((p) => p.role === role).map((p) => p.text);
  return mine.length ? mine : DEFAULT_PRESETS[role];
}

function PresetChips({ texts, note, onPick }: { texts: string[]; note: string; onPick: (t: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="คำสั่งสำเร็จรูป">
      {texts.map((t) => (
        <button key={t} type="button" className={chip(note === t)} aria-pressed={note === t} onClick={() => onPick(t)}>{t}</button>
      ))}
    </div>
  );
}

function NoteBox({ id, value, onChange, label }: { id: string; value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">{label}</label>
      <textarea id={id} className="field-input" rows={2} maxLength={1000} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Busy({ text }: { text: string }) {
  return <><span className="size-5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden /> {text}</>;
}

/** เลือกผู้รับหลายคน พร้อมช่องค้นหา */
function StaffPicker({ options, selected, onToggle }: { options: StaffOption[]; selected: string[]; onToggle: (id: string) => void }) {
  const [q, setQ] = useState("");
  const shown = options.filter((s) => !q.trim() || s.name.includes(q.trim()) || (s.work_group ?? "").includes(q.trim()));
  return (
    <div className="flex flex-col gap-2">
      {options.length > 8 && (
        <input type="search" className="field-input" placeholder="ค้นหาชื่อหรือกลุ่มงาน" aria-label="ค้นหาชื่อหรือกลุ่มงาน" value={q} onChange={(e) => setQ(e.target.value)} />
      )}
      <ul className="flex flex-col divide-y divide-line rounded-2xl border-[1.5px] border-line">
        {shown.map((s) => (
          <li key={s.id}>
            <label className="flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2">
              <input type="checkbox" className="size-5" checked={selected.includes(s.id)} onChange={() => onToggle(s.id)} />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{s.name}</span>
                {s.work_group && <span className="block text-sm text-muted">{s.work_group}</span>}
              </span>
            </label>
          </li>
        ))}
        {shown.length === 0 && <li className="px-3 py-4 text-center text-muted">ไม่พบรายชื่อ</li>}
      </ul>
    </div>
  );
}

/** แผงดำเนินการตามบทบาทและสถานะ (คืน null ถ้าผู้ใช้ไม่มีอะไรต้องทำ) */
export function EndorsePanel(props: { detail: BookDetail; me: Me; staff: StaffOption[]; presets: Preset[]; schoolName: string }) {
  const { detail: { book }, me } = props;
  const canEndorse = me.role === "director" && (book.status === "proposed" || (book.status === "registered" && book.created_by === me.id));
  if (canEndorse) return <DirectorPanel {...props} />;
  if ((me.role === "clerk" || me.role === "director") && book.status === "registered") return <ClerkPanel {...props} />;
  if (me.role === "head" && book.status === "endorsed" && book.current_holder === me.id) return <HeadPanel {...props} />;
  return null;
}

type Route = { kind: "head"; id: string } | { kind: "teachers"; ids: string[] } | { kind: "close" };

/** ผอ. เกษียน 4 แตะ: คำสั่ง → ผู้รับ → ลงนาม → ยืนยัน */
function DirectorPanel({ detail, me, staff, presets, schoolName }: { detail: BookDetail; me: Me; staff: StaffOption[]; presets: Preset[]; schoolName: string }) {
  const { book } = detail;
  const router = useRouter();
  const toast = useToast();
  const [note, setNote] = useState("");
  const [route, setRoute] = useState<Route | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [signature, setSignature] = useState<Blob | null | undefined>(undefined); // undefined = กำลังโหลด
  const running = useRef(false);
  // ไฟล์ที่ลงนามแล้วแต่บันทึกเกษียนไม่สำเร็จ: ลองใหม่ด้วยข้อความเดิมใช้ไฟล์นี้ ไม่ลงนามซ้ำทับ
  const signed = useRef<{ note: string; fileId: string } | null>(null);

  const heads = useMemo(() => staff.filter((s) => s.saraban_role === "head"), [staff]);
  const others = useMemo(() => staff.filter((s) => s.id !== me.id), [staff, me.id]);
  const nameOf = useMemo(() => new Map(staff.map((s) => [s.id, s.name])), [staff]);
  const latest = latestFile(detail.files);

  // ลายเซ็นของฉัน (ไม่มีก็ลงนามด้วยชื่อได้)
  useEffect(() => {
    let alive = true;
    supabaseBrowser().storage.from("signatures").download(`${me.id}/signature.png`)
      .then(({ data }) => alive && setSignature(data ?? null))
      .catch(() => alive && setSignature(null));
    return () => { alive = false; };
  }, [me.id]);

  const routeText = !route ? "" : route.kind === "head"
    ? `มอบ ${nameOf.get(route.id) ?? "หัวหน้ากลุ่มงาน"}`
    : route.kind === "teachers" ? `มอบครู ${route.ids.length} คน: ${route.ids.map((id) => nameOf.get(id)).filter(Boolean).join(", ")}` : "ทราบ/จัดเก็บ (ปิดเรื่อง)";
  const ready = !!route && note.trim() !== "";

  async function confirm() {
    if (!route || running.current) return;
    running.current = true;
    try {
      let fileId: string | null = null;
      const text = note.trim();
      if (signed.current?.note === text) {
        fileId = signed.current.fileId;
      } else if (latest) {
        try {
          setStep("กำลังลงนามลงไฟล์…");
          fileId = await signAndUpload(book.id, latest.id, {
            note: text, signerName: me.name, position: `ผู้อำนวยการ${schoolName}`, date: todayISO(),
            fileName: `เกษียน รับที่ ${book.receive_no}-${book.year}.pdf`,
          }, signature ?? null);
          signed.current = { note: text, fileId };
        } catch (err) {
          if (!(err instanceof EncryptedPdfError)) {
            toast(`ลงนามลงไฟล์ไม่สำเร็จ (${err instanceof Error ? err.message : "ไม่ทราบสาเหตุ"}) กรุณาลองใหม่`, "error");
            return;
          }
          toast("ไฟล์ PDF ถูกล็อก จึงบันทึกคำเกษียนในระบบโดยไม่ฝังลงไฟล์", "info");
        }
      }
      setStep("กำลังบันทึกการเกษียน…");
      const targets = route.kind === "head" ? [route.id] : route.kind === "teachers" ? route.ids : [];
      const res = await endorseBook(book.id, route.kind === "head" ? "head" : route.kind, text, targets, fileId);
      if (!res.ok) {
        toast(res.error, "error");
        return;
      }
      signed.current = null;
      setConfirmOpen(false);
      toast(route.kind === "close" ? "ลงนามแล้ว · ปิดเรื่อง" : "ลงนามแล้ว · แจ้งผู้รับแล้ว");
      router.refresh();
    } finally {
      running.current = false;
      setStep(null);
    }
  }

  return (
    <Card className="flex flex-col gap-4 border-2 border-navy-700/20">
      <SectionTitle>เกษียนหนังสือ</SectionTitle>
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-muted">1. คำสั่งการ</h3>
        <PresetChips texts={presetTexts(presets, "director")} note={note} onPick={setNote} />
        <NoteBox id="endorse-note" label="ข้อความ (แก้ไขได้)" value={note} onChange={setNote} />
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-muted">2. มอบให้</h3>
        <div className="flex flex-wrap gap-2" role="group" aria-label="ผู้รับ">
          {heads.map((h) => (
            <button key={h.id} type="button" className={chip(route?.kind === "head" && route.id === h.id)}
              aria-pressed={route?.kind === "head" && route.id === h.id} onClick={() => setRoute({ kind: "head", id: h.id })}>
              <UserCircle size={20} weight="duotone" />
              <span>{h.work_group ? `${h.work_group} · ` : ""}{h.name}</span>
            </button>
          ))}
          <button type="button" className={chip(route?.kind === "teachers")} aria-pressed={route?.kind === "teachers"}
            onClick={() => { setPicked(route?.kind === "teachers" ? route.ids : []); setPickOpen(true); }}>
            <Users size={20} weight="duotone" /> มอบครู{route?.kind === "teachers" ? ` (${route.ids.length})` : ""}
          </button>
          <button type="button" className={chip(route?.kind === "close")} aria-pressed={route?.kind === "close"}
            onClick={() => { setRoute({ kind: "close" }); if (!note.trim()) setNote("ทราบ"); }}>
            <Archive size={20} weight="duotone" /> ทราบ/จัดเก็บ
          </button>
        </div>
        {heads.length === 0 && <p className="text-sm text-muted">ยังไม่ได้กำหนดหัวหน้ากลุ่มงาน (ตั้งได้ที่ทะเบียนครู)</p>}
      </section>
      {signature === null && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
          ยังไม่มีลายเซ็น จะลงนามด้วยชื่อ — <Link href="/saraban/settings" className="font-semibold underline">ตั้งค่าลายเซ็น</Link>
        </p>
      )}
      {!latest && <p className="text-sm text-muted">หนังสือนี้ยังไม่มีไฟล์ คำเกษียนจะบันทึกในระบบเท่านั้น</p>}
      {/* ปุ่มลงนามลอยเหนือแถบเมนูล่างบนมือถือ: แตะได้โดยไม่ต้องเลื่อนจอ */}
      <div className="sticky bottom-20 z-10 flex flex-col gap-1 md:bottom-4">
        <Button size="lg" className="w-full shadow-lg" disabled={!ready} onClick={() => setConfirmOpen(true)}>
          <PenNib size={22} weight="bold" /> ลงนาม
        </Button>
        {!ready && <p className="rounded-lg bg-white/90 text-center text-sm text-muted">เลือกคำสั่งและผู้รับก่อนลงนาม</p>}
      </div>

      <Sheet open={pickOpen} onClose={() => setPickOpen(false)} title="มอบครู (เลือกได้หลายคน)">
        <StaffPicker options={others} selected={picked} onToggle={(id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))} />
        <Button size="lg" className="sticky bottom-0 mt-3 w-full" disabled={picked.length === 0}
          onClick={() => { setRoute({ kind: "teachers", ids: picked }); setPickOpen(false); }}>
          <Check size={22} weight="bold" /> ตกลง ({picked.length} คน)
        </Button>
      </Sheet>

      <Sheet open={confirmOpen} onClose={() => { if (!step) setConfirmOpen(false); }} title="ยืนยันการลงนาม">
        <dl className="flex flex-col gap-2 text-[0.9375rem]">
          <div><dt className="text-sm text-muted">คำสั่งการ</dt><dd className="whitespace-pre-wrap font-semibold">{note.trim()}</dd></div>
          <div><dt className="text-sm text-muted">มอบให้</dt><dd className="font-semibold">{routeText}</dd></div>
          <div><dt className="text-sm text-muted">ลงนาม</dt><dd>{me.name}{signature ? " (พร้อมลายเซ็น)" : ""}</dd></div>
        </dl>
        <div className="mt-4 flex flex-col gap-2">
          <Button size="lg" className="w-full" disabled={!!step} onClick={confirm}>
            {step ? <Busy text={step} /> : <><Check size={22} weight="bold" /> ยืนยันลงนาม</>}
          </Button>
          <Button variant="secondary" className="w-full" disabled={!!step} onClick={() => setConfirmOpen(false)}>แก้ไข</Button>
        </div>
      </Sheet>
    </Card>
  );
}

/** ธุรการ: คำเกษียนเสนอ ผอ. */
function ClerkPanel({ detail, presets }: { detail: BookDetail; presets: Preset[] }) {
  const router = useRouter();
  const toast = useToast();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  async function submit() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      const res = await proposeBook(detail.book.id, note, null);
      if (!res.ok) return toast(res.error, "error");
      toast("เสนอ ผอ. แล้ว");
      router.refresh();
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 border-2 border-navy-700/20">
      <SectionTitle>เสนอผู้อำนวยการ</SectionTitle>
      <PresetChips texts={presetTexts(presets, "clerk")} note={note} onPick={setNote} />
      <NoteBox id="propose-note" label="ข้อความเสนอ" value={note} onChange={setNote} />
      <Button size="lg" className="w-full" disabled={busy} onClick={submit}>
        {busy ? <Busy text="กำลังเสนอ…" /> : "เสนอ ผอ."}
      </Button>
    </Card>
  );
}

/** หัวหน้ากลุ่มงาน: มอบหมายครูในกลุ่มงานของตน */
function HeadPanel({ detail, me, staff, presets }: { detail: BookDetail; me: Me; staff: StaffOption[]; presets: Preset[] }) {
  const router = useRouter();
  const toast = useToast();
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const members = useMemo(() => staff.filter((s) => s.id !== me.id && !!me.workGroup && s.work_group === me.workGroup), [staff, me]);

  async function submit() {
    if (running.current || picked.length === 0) return;
    running.current = true;
    setBusy(true);
    try {
      const res = await forwardBook(detail.book.id, note, picked, null);
      if (!res.ok) return toast(res.error, "error");
      toast(`มอบหมายแล้ว ${picked.length} คน`);
      router.refresh();
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 border-2 border-navy-700/20">
      <SectionTitle>มอบหมายครูในกลุ่มงาน{me.workGroup ? ` (${me.workGroup})` : ""}</SectionTitle>
      {members.length === 0 ? (
        <p className="text-muted">ยังไม่มีครูในกลุ่มงานของท่าน (กำหนดกลุ่มงานได้ที่ทะเบียนครู)</p>
      ) : (
        <StaffPicker options={members} selected={picked} onToggle={(id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))} />
      )}
      <PresetChips texts={presetTexts(presets, "head")} note={note} onPick={setNote} />
      <NoteBox id="forward-note" label="ข้อความถึงผู้รับ" value={note} onChange={setNote} />
      <Button size="lg" className="w-full" disabled={busy || picked.length === 0} onClick={submit}>
        {busy ? <Busy text="กำลังมอบหมาย…" /> : `มอบหมาย${picked.length ? ` (${picked.length} คน)` : ""}`}
      </Button>
    </Card>
  );
}
