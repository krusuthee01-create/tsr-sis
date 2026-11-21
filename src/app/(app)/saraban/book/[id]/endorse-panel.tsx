"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArrowUUpLeft, Check, PenNib, UserCircle, Users, X } from "@phosphor-icons/react";
import { Button, Card, SectionTitle } from "@/components/ui";
import { useToast } from "@/components/toast";
import { supabaseBrowser } from "@/lib/supabase/client";
import { todayISO } from "@/lib/thai-date";
import { DEFAULT_PRESETS, hasNoteLine, latestFile, toggleNoteLine, type BookDetail, type Preset, type PresetRole, type StaffOption } from "@/lib/saraban/book";
import type { SarabanRole } from "@/lib/saraban/types";
import { endorseBook, forwardBook, proposeBook } from "../../actions";
import { defaultPlacement, EncryptedPdfError, prepareEndorsement, signErrorText, uploadEndorsement, type PreparedEndorsement } from "../../pdf-client";
import { PlacementPicker, type Placement } from "./placement-picker";

export type Me = { id: string; role: SarabanRole; workGroup: string | null; name: string };

/** แผ่นล่างจอ (มือถือ) / กล่องกลางจอ (จอใหญ่) ด้วย <dialog> — wide: กว้างขึ้นสำหรับภาพหน้าเอกสาร */
export function Sheet({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
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
      className={`fixed inset-x-0 bottom-0 top-auto m-0 max-h-[92dvh] w-full max-w-full rounded-t-3xl p-0 shadow-2xl backdrop:bg-slate-900/40 md:inset-0 md:m-auto md:rounded-3xl ${wide ? "md:max-w-3xl" : "md:max-w-lg"}`}>
      <div className="flex max-h-[92dvh] flex-col">
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

/** คำสั่งสำเร็จรูปหลายบรรทัด: แตะเพิ่มเป็นบรรทัดใหม่ แตะซ้ำเอาออก (แบบ "บรรทัดที่ 1–4" ของระบบเดิม) */
function PresetChips({ texts, note, onChange, bullet }: { texts: string[]; note: string; onChange: (v: string) => void; bullet: string }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="คำสั่งสำเร็จรูป (แตะเพื่อเพิ่ม/เอาออก)">
      {texts.map((t) => {
        const on = hasNoteLine(note, t, bullet);
        return <button key={t} type="button" className={chip(on)} aria-pressed={on} onClick={() => onChange(toggleNoteLine(note, t, bullet))}>{t}</button>;
      })}
    </div>
  );
}

function NoteBox({ id, value, onChange, label }: { id: string; value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">{label}</label>
      <textarea id={id} className="field-input" rows={3} maxLength={1000} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Busy({ text }: { text: string }) {
  return <><span className="size-5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden /> {text}</>;
}

const NO_GROUP = "ไม่ระบุกลุ่มงาน";

/** เลือกผู้รับหลายคน: เลือกทั้งกลุ่มงานได้ในแตะเดียว ค้นหาได้ (ชื่อไม่ซ้ำ แม้เลือกหลายกลุ่ม) */
function StaffPicker({ options, selected, onChange }: { options: StaffOption[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const [q, setQ] = useState("");
  const term = q.trim();
  const shown = options.filter((s) => !term || s.name.includes(term) || (s.work_group ?? "").includes(term));
  const groups = useMemo(() => {
    const m = new Map<string, StaffOption[]>();
    for (const s of shown) {
      const g = s.work_group || NO_GROUP;
      m.set(g, [...(m.get(g) ?? []), s]);
    }
    return [...m.entries()].sort(([a], [b]) => (a === NO_GROUP ? 1 : b === NO_GROUP ? -1 : a.localeCompare(b, "th")));
  }, [shown]);
  const sel = new Set(selected);
  const setMany = (ids: string[], on: boolean) => {
    const next = new Set(sel);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    onChange([...next]);
  };
  const allIds = shown.map((s) => s.id);
  const allOn = allIds.length > 0 && allIds.every((id) => sel.has(id));

  return (
    <div className="flex flex-col gap-2">
      {options.length > 8 && (
        <input type="search" className="field-input" placeholder="ค้นหาชื่อหรือกลุ่มงาน" aria-label="ค้นหาชื่อหรือกลุ่มงาน" value={q} onChange={(e) => setQ(e.target.value)} />
      )}
      <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl bg-slate-50 px-3 py-2 font-semibold">
        <input type="checkbox" className="size-5" checked={allOn} onChange={() => setMany(allIds, !allOn)} />
        เลือกทุกคน{term ? "ที่ค้นพบ" : ""} ({allIds.length} คน)
      </label>
      {groups.map(([g, members]) => {
        const ids = members.map((m) => m.id);
        const on = ids.every((id) => sel.has(id));
        const some = !on && ids.some((id) => sel.has(id));
        return (
          <fieldset key={g} className="rounded-2xl border-[1.5px] border-line">
            <legend className="sr-only">{g}</legend>
            <label className="flex min-h-12 cursor-pointer items-center gap-3 border-b border-line bg-slate-50/70 px-3 py-2 font-semibold">
              <input type="checkbox" className="size-5" checked={on} ref={(el) => { if (el) el.indeterminate = some; }} onChange={() => setMany(ids, !on)} />
              {g} <span className="font-normal text-muted">({members.length})</span>
            </label>
            <ul className="flex flex-col divide-y divide-line">
              {members.map((s) => (
                <li key={s.id}>
                  <label className="flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2 pl-8">
                    <input type="checkbox" className="size-5" checked={sel.has(s.id)} onChange={() => setMany([s.id], !sel.has(s.id))} />
                    <span className="font-medium">{s.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        );
      })}
      {shown.length === 0 && <p className="px-3 py-4 text-center text-muted">ไม่พบรายชื่อ</p>}
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

type Prep = { state: "idle" } | { state: "loading" } | { state: "ready"; prepared: PreparedEndorsement; place: Placement } | { state: "none"; reason: string };

/**
 * ลงนามคำเกษียนลงไฟล์ (ใช้ร่วมทุกบทบาท)
 * 1) prepare: วาดคำเกษียนจากไฟล์ที่หน้าโหลดมา (จำ id ไว้ตั้งแต่ครั้งแรก — ลองใหม่จะไม่ลงนามทับฉบับที่ลงนามจากครั้งที่ล้มเหลว)
 * 2) ผู้ลงนามแตะเลือกตำแหน่ง (มีตำแหน่งเริ่มต้นให้) 3) commit: ฝังแล้วอัปโหลด คืน fileId
 * ฉบับที่ลงนามแล้วแต่บันทึกขั้นตอนไม่สำเร็จ: ลองใหม่ด้วยข้อความ+ตำแหน่งเดิมใช้ไฟล์เดิม
 */
function useSigner(detail: BookDetail, me: Me) {
  const toast = useToast();
  const [signature, setSignature] = useState<Blob | null | undefined>(undefined); // undefined = กำลังโหลด
  const [prep, setPrep] = useState<Prep>({ state: "idle" });
  const signed = useRef<{ key: string; fileId: string } | null>(null);
  const baseFileId = useRef<string | null>(null);
  const latest = latestFile(detail.files);
  const { book } = detail;

  useEffect(() => {
    let alive = true;
    supabaseBrowser().storage.from("signatures").download(`${me.id}/signature.png`)
      .then(({ data }) => alive && setSignature(data ?? null))
      .catch(() => alive && setSignature(null));
    return () => { alive = false; };
  }, [me.id]);

  /** เตรียมภาพคำเกษียนและตำแหน่งเริ่มต้น */
  async function prepare(note: string, place: { side: "left" | "right"; newPage?: boolean }) {
    const text = note.trim();
    if (!text) return setPrep({ state: "none", reason: "ไม่มีข้อความ" });
    if (!latest) return setPrep({ state: "none", reason: "หนังสือนี้ยังไม่มีไฟล์ คำเกษียนจะบันทึกในระบบเท่านั้น" });
    setPrep({ state: "loading" });
    baseFileId.current ??= latest.id;
    try {
      const prepared = await prepareEndorsement(baseFileId.current, { note: text, signerName: me.name, date: todayISO() }, signature ?? null);
      setPrep({ state: "ready", prepared, place: defaultPlacement(prepared, place) });
    } catch (err) {
      if (err instanceof EncryptedPdfError) return setPrep({ state: "none", reason: "ไฟล์ PDF ถูกล็อก คำเกษียนจะบันทึกในระบบโดยไม่ฝังลงไฟล์" });
      toast(`เตรียมลงนามไม่สำเร็จ (${signErrorText(err)})`, "error");
      setPrep({ state: "idle" });
    }
  }

  /** ฝังตามตำแหน่งที่เลือก: คืน fileId, null = ไม่ฝัง (ไม่มีไฟล์/ไฟล์ล็อก), false = ล้มเหลว (แจ้งแล้ว) */
  async function commit(note: string): Promise<string | null | false> {
    if (prep.state !== "ready") return prep.state === "none" ? null : false;
    const b = prep.place.box;
    const key = `${note.trim()}|${prep.place.appendPage}|${b.page}|${b.x.toFixed(1)}|${b.y.toFixed(1)}`;
    if (signed.current?.key === key) return signed.current.fileId;
    try {
      const fileId = await uploadEndorsement(book.id, prep.prepared, prep.place, `เกษียน รับที่ ${book.receive_no}-${book.year}.pdf`);
      signed.current = { key, fileId };
      return fileId;
    } catch (err) {
      toast(`ลงนามลงไฟล์ไม่สำเร็จ (${signErrorText(err)}) กรุณาลองใหม่`, "error");
      return false;
    }
  }

  return {
    signature,
    prep,
    setPlace: (place: Placement) => setPrep((p) => (p.state === "ready" ? { ...p, place } : p)),
    prepare,
    commit,
    reset: () => setPrep({ state: "idle" }),
    done: () => { signed.current = null; baseFileId.current = null; setPrep({ state: "idle" }); },
  };
}
type Signer = ReturnType<typeof useSigner>;

/** ส่วนเลือกตำแหน่งในแผ่นยืนยัน */
function PlacementSection({ signer }: { signer: Signer }) {
  const p = signer.prep;
  if (p.state === "loading") return <p className="rounded-xl bg-slate-50 px-3 py-6 text-center text-muted">กำลังเตรียมคำเกษียนและหน้าเอกสาร…</p>;
  if (p.state === "none") return <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{p.reason}</p>;
  if (p.state !== "ready") return null;
  return <PlacementPicker prepared={p.prepared} value={p.place} onChange={signer.setPlace} />;
}

function SignatureHint({ signature }: { signature: Blob | null | undefined }) {
  if (signature !== null) return null;
  return (
    <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
      ยังไม่มีลายเซ็น จะลงนามด้วยชื่อ — <Link href="/saraban/settings" className="font-semibold underline">ตั้งค่าลายเซ็น</Link>
    </p>
  );
}

type Route = { kind: "head"; id: string } | { kind: "teachers"; ids: string[] } | { kind: "close" } | { kind: "return" };

/** ผอ. เกษียน 4 แตะ: คำสั่ง → ผู้รับ → ลงนาม (ดูตำแหน่ง แตะย้ายได้) → ยืนยัน */
function DirectorPanel({ detail, me, staff, presets }: { detail: BookDetail; me: Me; staff: StaffOption[]; presets: Preset[]; schoolName: string }) {
  const { book } = detail;
  const router = useRouter();
  const toast = useToast();
  const [note, setNote] = useState("");
  const [route, setRoute] = useState<Route | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const running = useRef(false);
  const signer = useSigner(detail, me);

  const heads = useMemo(() => staff.filter((s) => s.saraban_role === "head"), [staff]);
  const others = useMemo(() => staff.filter((s) => s.id !== me.id), [staff, me.id]);
  const nameOf = useMemo(() => new Map(staff.map((s) => [s.id, s.name])), [staff]);

  const recipients = !route ? [] : route.kind === "head" ? [route.id] : route.kind === "teachers" ? route.ids : [];
  const routeText = !route ? "" : route.kind === "head" ? `มอบ ${nameOf.get(route.id) ?? "หัวหน้ากลุ่มงาน"}`
    : route.kind === "teachers" ? `ส่งต่อบุคลากร ${route.ids.length} คน` : route.kind === "close" ? "จัดเก็บ (ปิดเรื่อง)" : "ส่งคืนงานธุรการ";
  const ready = !!route && note.trim() !== "";
  const isReturn = route?.kind === "return";

  function openConfirm() {
    setConfirmOpen(true);
    // ส่งคืนธุรการไม่ลงนามลงไฟล์ (ธุรการแก้ไขแล้วเสนอใหม่)
    if (isReturn) signer.reset();
    else signer.prepare(note, { side: "right" });
  }

  async function confirm() {
    if (!route || running.current) return;
    running.current = true;
    try {
      const text = note.trim();
      let fileId: string | null | false = null;
      if (!isReturn) {
        setStep("กำลังลงนามลงไฟล์…");
        fileId = await signer.commit(text);
        if (fileId === false) return;
      }
      setStep("กำลังบันทึกการเกษียน…");
      const res = await endorseBook(book.id, route.kind, text, recipients, fileId);
      if (!res.ok) {
        toast(res.error, "error");
        return;
      }
      signer.done();
      setConfirmOpen(false);
      toast(route.kind === "close" ? "ลงนามแล้ว · จัดเก็บ" : isReturn ? "ส่งคืนงานธุรการแล้ว" : "ลงนามแล้ว · แจ้งผู้รับแล้ว");
      router.refresh();
    } finally {
      running.current = false;
      setStep(null);
    }
  }

  const loading = signer.prep.state === "loading";
  return (
    <Card className="flex flex-col gap-4 border-2 border-navy-700/20">
      <SectionTitle>เกษียนหนังสือ</SectionTitle>
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-muted">1. คำสั่งการ (แตะได้หลายข้อ ข้อละบรรทัด)</h3>
        <PresetChips texts={presetTexts(presets, "director")} note={note} onChange={setNote} bullet="- " />
        <NoteBox id="endorse-note" label="ข้อความ (แก้ไขได้)" value={note} onChange={setNote} />
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-muted">2. การดำเนินการ</h3>
        <div className="flex flex-wrap gap-2" role="group" aria-label="การดำเนินการ">
          {heads.map((h) => (
            <button key={h.id} type="button" className={chip(route?.kind === "head" && route.id === h.id)}
              aria-pressed={route?.kind === "head" && route.id === h.id} onClick={() => setRoute({ kind: "head", id: h.id })}>
              <UserCircle size={20} weight="duotone" />
              <span>{h.work_group ? `${h.work_group} · ` : ""}{h.name}</span>
            </button>
          ))}
          <button type="button" className={chip(route?.kind === "teachers")} aria-pressed={route?.kind === "teachers"}
            onClick={() => { setPicked(route?.kind === "teachers" ? route.ids : []); setPickOpen(true); }}>
            <Users size={20} weight="duotone" /> ส่งต่อบุคลากร{route?.kind === "teachers" ? ` (${route.ids.length})` : ""}
          </button>
          <button type="button" className={chip(route?.kind === "close")} aria-pressed={route?.kind === "close"}
            onClick={() => { setRoute({ kind: "close" }); if (!note.trim()) setNote("- ทราบ"); }}>
            <Archive size={20} weight="duotone" /> จัดเก็บ
          </button>
          <button type="button" className={chip(isReturn)} aria-pressed={isReturn} onClick={() => setRoute({ kind: "return" })}>
            <ArrowUUpLeft size={20} weight="duotone" /> ส่งคืนงานธุรการ
          </button>
        </div>
        {isReturn && <p className="text-sm text-muted">พิมพ์เหตุผลที่ส่งคืนในช่องข้อความ เช่น ขอเอกสารแนบเพิ่ม</p>}
        {heads.length === 0 && <p className="text-sm text-muted">ยังไม่ได้กำหนดหัวหน้ากลุ่มงาน (ตั้งได้ที่ทะเบียนครู)</p>}
      </section>
      <SignatureHint signature={signer.signature} />
      {/* ปุ่มลงนามลอยเหนือแถบเมนูล่างบนมือถือ: แตะได้โดยไม่ต้องเลื่อนจอ */}
      <div className="sticky bottom-20 z-10 flex flex-col gap-1 md:bottom-4">
        <Button size="lg" className="w-full shadow-lg" disabled={!ready} onClick={openConfirm}>
          {isReturn ? <><ArrowUUpLeft size={22} weight="bold" /> ส่งคืน</> : <><PenNib size={22} weight="bold" /> ลงนาม</>}
        </Button>
        {!ready && <p className="rounded-lg bg-white/90 text-center text-sm text-muted">เลือกคำสั่งและการดำเนินการก่อน</p>}
      </div>

      <Sheet open={pickOpen} onClose={() => setPickOpen(false)} title="ส่งต่อบุคลากร (เลือกทั้งกลุ่มได้)">
        <StaffPicker options={others} selected={picked} onChange={setPicked} />
        <Button size="lg" className="sticky bottom-0 mt-3 w-full" disabled={picked.length === 0}
          onClick={() => { setRoute({ kind: "teachers", ids: picked }); setPickOpen(false); }}>
          <Check size={22} weight="bold" /> ตกลง ({picked.length} คน)
        </Button>
      </Sheet>

      <Sheet open={confirmOpen} wide onClose={() => { if (!step) setConfirmOpen(false); }} title={isReturn ? "ยืนยันส่งคืนงานธุรการ" : "วางคำเกษียนและยืนยันลงนาม"}>
        <div className="flex flex-col gap-3">
          {!isReturn && <PlacementSection signer={signer} />}
          <dl className="flex flex-col gap-2 text-[0.9375rem]">
            <div><dt className="text-sm text-muted">{isReturn ? "เหตุผล" : "คำสั่งการ"}</dt><dd className="whitespace-pre-wrap font-semibold">{note.trim()}</dd></div>
            <div><dt className="text-sm text-muted">การดำเนินการ</dt><dd className="font-semibold">{routeText}</dd></div>
            {recipients.length > 0 && (
              <div>
                <dt className="text-sm text-muted">ผู้ที่จะได้รับหนังสือฉบับนี้ ({recipients.length} คน)</dt>
                <dd className="flex flex-wrap gap-1.5 pt-1">
                  {recipients.map((id) => <span key={id} className="rounded-lg bg-slate-100 px-2 py-0.5 text-sm">{nameOf.get(id)}</span>)}
                </dd>
              </div>
            )}
            {!isReturn && <div><dt className="text-sm text-muted">ลงนาม</dt><dd>{me.name}{signer.signature ? " (พร้อมลายเซ็น)" : ""}</dd></div>}
          </dl>
          <div className="sticky bottom-0 flex flex-col gap-2 bg-white pt-1">
            <Button size="lg" className="w-full" disabled={!!step || loading} onClick={confirm}>
              {step ? <Busy text={step} /> : <><Check size={22} weight="bold" /> {isReturn ? "ยืนยันส่งคืน" : "ยืนยันลงนาม"}</>}
            </Button>
            <Button variant="secondary" className="w-full" disabled={!!step} onClick={() => setConfirmOpen(false)}>แก้ไข</Button>
          </div>
        </div>
      </Sheet>
    </Card>
  );
}

/** แผ่นยืนยันที่ใช้ร่วม (ธุรการ/หัวหน้า): วางตำแหน่ง แล้วยืนยัน */
function SignSheet({ open, onClose, title, signer, step, onConfirm, children }: {
  open: boolean; onClose: () => void; title: string; signer: Signer; step: string | null; onConfirm: () => void; children?: React.ReactNode;
}) {
  return (
    <Sheet open={open} wide onClose={() => { if (!step) onClose(); }} title={title}>
      <div className="flex flex-col gap-3">
        <PlacementSection signer={signer} />
        {children}
        <div className="sticky bottom-0 flex flex-col gap-2 bg-white pt-1">
          <Button size="lg" className="w-full" disabled={!!step || signer.prep.state === "loading"} onClick={onConfirm}>
            {step ? <Busy text={step} /> : <><Check size={22} weight="bold" /> ยืนยัน</>}
          </Button>
          <Button variant="secondary" className="w-full" disabled={!!step} onClick={onClose}>แก้ไข</Button>
        </div>
      </div>
    </Sheet>
  );
}

/** ธุรการ: คำเสนอ ผอ. (เช่น "เรียน ผอ." / "เพื่อทราบ/ประชาสัมพันธ์") แตะวางในพื้นที่ว่างของหนังสือ */
function ClerkPanel({ detail, me, presets }: { detail: BookDetail; me: Me; presets: Preset[] }) {
  const router = useRouter();
  const toast = useToast();
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const running = useRef(false);
  const signer = useSigner(detail, me);
  const returned = [...detail.actions].reverse().find((a) => a.action === "return" || a.action === "propose");

  async function confirm() {
    if (running.current) return;
    running.current = true;
    try {
      setStep("กำลังลงนามลงไฟล์…");
      const fileId = await signer.commit(note);
      if (fileId === false) return;
      setStep("กำลังเสนอ…");
      const res = await proposeBook(detail.book.id, note, fileId);
      if (!res.ok) return toast(res.error, "error");
      signer.done();
      setOpen(false);
      toast("เสนอ ผอ. แล้ว");
      router.refresh();
    } finally {
      running.current = false;
      setStep(null);
    }
  }

  return (
    <Card className="flex flex-col gap-3 border-2 border-navy-700/20">
      <SectionTitle>เสนอผู้อำนวยการ</SectionTitle>
      {returned?.action === "return" && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <strong>ผอ. ส่งคืน:</strong> {returned.note} — แก้ไขหรือแนบไฟล์แล้วเสนอใหม่
        </p>
      )}
      <PresetChips texts={presetTexts(presets, "clerk")} note={note} onChange={setNote} bullet="" />
      <NoteBox id="propose-note" label="ข้อความเสนอ" value={note} onChange={setNote} />
      <SignatureHint signature={signer.signature} />
      <Button size="lg" className="w-full" disabled={!note.trim()} onClick={() => { setOpen(true); signer.prepare(note, { side: "left" }); }}>
        เสนอ ผอ.
      </Button>
      <SignSheet open={open} onClose={() => setOpen(false)} title="วางคำเสนอและยืนยัน" signer={signer} step={step} onConfirm={confirm} />
    </Card>
  );
}

/** หัวหน้ากลุ่มงาน: มอบหมายครูในกลุ่มงานของตน */
function HeadPanel({ detail, me, staff, presets }: { detail: BookDetail; me: Me; staff: StaffOption[]; presets: Preset[] }) {
  const router = useRouter();
  const toast = useToast();
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const running = useRef(false);
  const signer = useSigner(detail, me);
  const members = useMemo(() => staff.filter((s) => s.id !== me.id && !!me.workGroup && s.work_group === me.workGroup), [staff, me]);

  async function confirm() {
    if (running.current || picked.length === 0) return;
    running.current = true;
    try {
      setStep("กำลังลงนามลงไฟล์…");
      const fileId = await signer.commit(note);
      if (fileId === false) return;
      setStep("กำลังมอบหมาย…");
      const res = await forwardBook(detail.book.id, note, picked, fileId);
      if (!res.ok) return toast(res.error, "error");
      signer.done();
      setOpen(false);
      toast(`มอบหมายแล้ว ${picked.length} คน`);
      router.refresh();
    } finally {
      running.current = false;
      setStep(null);
    }
  }

  return (
    <Card className="flex flex-col gap-3 border-2 border-navy-700/20">
      <SectionTitle>มอบหมายครูในกลุ่มงาน{me.workGroup ? ` (${me.workGroup})` : ""}</SectionTitle>
      {members.length === 0 ? (
        <p className="text-muted">ยังไม่มีครูในกลุ่มงานของท่าน (กำหนดกลุ่มงานได้ที่ทะเบียนครู)</p>
      ) : (
        <StaffPicker options={members} selected={picked} onChange={setPicked} />
      )}
      <PresetChips texts={presetTexts(presets, "head")} note={note} onChange={setNote} bullet="- " />
      <NoteBox id="forward-note" label="ข้อความถึงผู้รับ" value={note} onChange={setNote} />
      <SignatureHint signature={signer.signature} />
      <Button size="lg" className="w-full" disabled={picked.length === 0}
        onClick={() => { setOpen(true); signer.prepare(note, { side: "left", newPage: true }); }}>
        {`มอบหมาย${picked.length ? ` (${picked.length} คน)` : ""}`}
      </Button>
      <SignSheet open={open} onClose={() => setOpen(false)} title="วางข้อความและยืนยันมอบหมาย" signer={signer} step={step} onConfirm={confirm}>
        <p className="text-sm"><span className="text-muted">ผู้รับ ({picked.length} คน): </span>{members.filter((m) => picked.includes(m.id)).map((m) => m.name).join(", ")}</p>
      </SignSheet>
    </Card>
  );
}
