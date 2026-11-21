"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FilePdf, LockSimple, UploadSimple, WarningCircle, X } from "@phosphor-icons/react";
import { Button, Card, Field, SectionTitle } from "@/components/ui";
import { useToast } from "@/components/toast";
import { formatThaiDate, todayISO } from "@/lib/thai-date";
import { URGENCY_LABEL, type Urgency } from "@/lib/saraban/types";
import { validateRegister, type RegisterInput } from "@/lib/saraban/register";
import { findDuplicates, orgSuggestions, registerBook, type DuplicateBook } from "../actions";
import { attachPdf, readPdf, type Picked } from "../pdf-client";

type Errors = Partial<Record<keyof RegisterInput | "file", string>>;

const URGENCY_ACTIVE: Record<Urgency, string> = {
  0: "border-slate-600 bg-slate-600 text-white",
  1: "border-amber-500 bg-amber-500 text-white",
  2: "border-orange-600 bg-orange-600 text-white",
  3: "border-red-600 bg-red-600 text-white",
};

function fmtSize(n: number) {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function RegisterForm({ schoolName }: { schoolName: string }) {
  const router = useRouter();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [reading, setReading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [f, setF] = useState({
    docNo: "", docDate: "", fromOrg: "", toText: `ผู้อำนวยการ${schoolName}`, subject: "",
    urgency: 0 as Urgency, secret: false, dueDate: "", receiveNo: "",
  });
  const [errors, setErrors] = useState<Errors>({});
  const [orgs, setOrgs] = useState<string[]>([]);
  const [dupes, setDupes] = useState<DuplicateBook[]>([]);
  const [step, setStep] = useState<string | null>(null);
  const busy = step !== null;
  const submitting = useRef(false); // กันกดซ้ำก่อน state อัปเดต

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  // รายชื่อหน่วยงานที่เคยส่ง (เติมช่อง "จาก" อัตโนมัติ)
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      orgSuggestions(f.fromOrg.trim()).then((r) => alive && setOrgs(r)).catch(() => {});
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [f.fromOrg]);

  // เตือนเลขที่หนังสือซ้ำ (ไม่ห้ามลงรับ)
  useEffect(() => {
    let alive = true;
    if (!f.docNo.trim()) { setDupes([]); return; }
    const t = setTimeout(() => {
      findDuplicates(f.docNo, f.fromOrg).then((r) => alive && setDupes(r)).catch(() => {});
    }, 400);
    return () => { alive = false; clearTimeout(t); };
  }, [f.docNo, f.fromOrg]);

  // กันปิดหน้าระหว่างอัปโหลด
  useEffect(() => {
    if (!busy) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [busy]);

  async function pick(file: File | undefined) {
    if (!file || busy) return;
    setReading(true);
    setErrors((e) => ({ ...e, file: undefined }));
    try {
      setPicked(await readPdf(file));
    } catch (err) {
      setPicked(null);
      setErrors((e) => ({ ...e, file: err instanceof Error ? err.message : "เปิดไฟล์ไม่ได้" }));
    } finally {
      setReading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || submitting.current) return;
    submitting.current = true;
    try {
      await doSubmit();
    } finally {
      submitting.current = false;
    }
  }

  async function doSubmit() {
    const receiveNo = f.receiveNo.trim() ? Number(f.receiveNo) : null;
    const input: RegisterInput = {
      docNo: f.docNo, docDate: f.docDate, fromOrg: f.fromOrg, toText: f.toText, subject: f.subject,
      urgency: f.urgency, secret: f.secret, dueDate: f.dueDate, receiveNo,
    };
    const errs: Errors = validateRegister(input);
    if (!picked) errs.file = "กรุณาแนบไฟล์หนังสือ (PDF)";
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) {
      toast("กรุณาตรวจข้อมูลที่ทำเครื่องหมายสีแดง", "error");
      return;
    }
    const pdf = picked!;

    setStep("กำลังออกเลขรับ…");
    const res = await registerBook(input);
    if (!res.ok) {
      setStep(null);
      if (receiveNo != null && res.error.includes("เลขรับ")) setErrors((x) => ({ ...x, receiveNo: res.error }));
      toast(res.error, "error");
      return;
    }
    const no = `${res.receiveNo}/${res.year}`;
    const go = () => router.push(`/saraban/book/${res.id}`);

    // ได้เลขรับแล้ว: อัปโหลดล้มเหลวก็ยังไปหน้าหนังสือ (มีปุ่ม "แนบไฟล์อีกครั้ง")
    const r = await attachPdf(pdf, { schoolName, receiveNo: res.receiveNo, year: res.year, receivedAt: res.receivedAt, bookId: res.id },
      (t) => setStep(`ได้เลขรับ ${no} · ${t}`));
    if (!r.ok) {
      const what = r.stage === "upload" ? "อัปโหลดไฟล์ไม่สำเร็จ" : "ประทับตรารับไม่สำเร็จ";
      toast(`ลงรับแล้ว เลขรับ ${no} แต่${what} (${r.error}) กรุณากด "แนบไฟล์อีกครั้ง" ในหน้าหนังสือ`, "error");
      return go();
    }
    if (!r.stamped) {
      toast(`ลงรับแล้ว เลขรับ ${no} — ไฟล์ PDF ถูกล็อกไว้ จึงประทับตรารับลงไฟล์ไม่ได้ (เก็บต้นฉบับไว้แล้ว)`, "info");
      return go();
    }
    toast(`ลงรับแล้ว เลขรับ ${no}`);
    go();
  }

  const invalid = (k: keyof Errors) => (errors[k] ? true : undefined);

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Card>
        <SectionTitle>1. ไฟล์หนังสือ</SectionTitle>
        {picked ? (
          <div className="flex items-center gap-3 rounded-2xl border-[1.5px] border-line p-3">
            <FilePdf size={40} weight="duotone" className="shrink-0 text-red-600" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{picked.file.name}</p>
              <p className="text-sm text-muted">{picked.pages} หน้า · {fmtSize(picked.file.size)}
                {picked.encrypted && <span className="text-amber-800"> · ไฟล์ถูกล็อก ประทับตรารับลงไฟล์ไม่ได้</span>}</p>
            </div>
            <button type="button" aria-label="เอาไฟล์ออก" disabled={busy} onClick={() => setPicked(null)}
              className="flex size-11 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 disabled:opacity-40">
              <X size={20} />
            </button>
          </div>
        ) : (
          <label htmlFor="saraban-file"
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); pick(e.dataTransfer.files[0]); }}
            className={`flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-6 text-center ${dragOver ? "border-navy-700 bg-sky-50" : errors.file ? "border-red-400 bg-red-50" : "border-sky-300 bg-white hover:bg-sky-50"}`}>
            <UploadSimple size={36} weight="duotone" className="text-navy-700" />
            <span className="font-semibold">{reading ? "กำลังตรวจไฟล์…" : "ลากไฟล์ PDF มาวางที่นี่ หรือแตะเพื่อเลือกไฟล์"}</span>
            <span className="text-sm text-muted">ไฟล์ PDF ไม่เกิน 30 MB</span>
          </label>
        )}
        <input ref={fileInput} id="saraban-file" type="file" accept="application/pdf,.pdf" className="sr-only" disabled={busy}
          onChange={(e) => pick(e.target.files?.[0])} />
        {errors.file && <p className="mt-2 text-sm font-medium text-red-700" role="alert">{errors.file}</p>}
      </Card>

      <Card className="flex flex-col gap-4">
        <SectionTitle>2. รายละเอียดหนังสือ</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Field label="เลขที่หนังสือ" htmlFor="docNo" error={errors.docNo} hint="เช่น ศธ 04147/ว 123">
              <input id="docNo" className="field-input" value={f.docNo} maxLength={100} aria-invalid={invalid("docNo")} onChange={(e) => set("docNo", e.target.value)} />
            </Field>
            {dupes.length > 0 && (
              <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
                <p className="flex items-center gap-1.5 font-semibold"><WarningCircle size={18} weight="fill" /> เลขที่หนังสือนี้ลงรับแล้วในปีนี้</p>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {dupes.slice(0, 3).map((d) => (
                    <li key={d.id}>
                      <Link href={`/saraban/book/${d.id}`} target="_blank" className="underline">รับที่ {d.receive_no}</Link> · {d.subject} ({formatThaiDate(todayISO(new Date(d.received_at)))})
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <Field label="ลงวันที่" htmlFor="docDate" error={errors.docDate}>
            <input id="docDate" type="date" className="field-input" value={f.docDate} aria-invalid={invalid("docDate")} onChange={(e) => set("docDate", e.target.value)} />
          </Field>
        </div>
        <Field label="จาก (หน่วยงานที่ส่ง)" htmlFor="fromOrg" required error={errors.fromOrg} hint="พิมพ์บางส่วนแล้วเลือกจากหน่วยงานที่เคยส่ง">
          <input id="fromOrg" className="field-input" list="saraban-orgs" autoComplete="off" value={f.fromOrg} maxLength={300}
            aria-invalid={invalid("fromOrg")} onChange={(e) => set("fromOrg", e.target.value)} />
          <datalist id="saraban-orgs">{orgs.map((o) => <option key={o} value={o} />)}</datalist>
        </Field>
        <Field label="ถึง" htmlFor="toText" error={errors.toText}>
          <input id="toText" className="field-input" value={f.toText} maxLength={300} aria-invalid={invalid("toText")} onChange={(e) => set("toText", e.target.value)} />
        </Field>
        <Field label="เรื่อง" htmlFor="subject" required error={errors.subject}>
          <textarea id="subject" className="field-input" rows={2} value={f.subject} maxLength={1000} aria-invalid={invalid("subject")} onChange={(e) => set("subject", e.target.value)} />
        </Field>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-sm font-semibold">ชั้นความเร็ว</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {([0, 1, 2, 3] as Urgency[]).map((u) => (
              <label key={u} className={`flex min-h-12 cursor-pointer items-center justify-center rounded-xl border-[1.5px] px-3 font-semibold ${f.urgency === u ? URGENCY_ACTIVE[u] : "border-slate-300 bg-white text-slate-700"}`}>
                <input type="radio" name="urgency" className="sr-only" checked={f.urgency === u} onChange={() => set("urgency", u)} />
                {URGENCY_LABEL[u]}
              </label>
            ))}
          </div>
          {errors.urgency && <p className="text-sm font-medium text-red-700" role="alert">{errors.urgency}</p>}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="กำหนดเสร็จ" htmlFor="dueDate" error={errors.dueDate} hint="ถ้ามี ระบบจะเตือนผู้รับเมื่อใกล้ครบกำหนด">
            <input id="dueDate" type="date" className="field-input" value={f.dueDate} aria-invalid={invalid("dueDate")} onChange={(e) => set("dueDate", e.target.value)} />
          </Field>
          <label className="flex min-h-12 cursor-pointer items-center gap-3 self-start rounded-xl border-[1.5px] border-line px-3 py-2 sm:mt-7">
            <input type="checkbox" className="size-5" checked={f.secret} onChange={(e) => set("secret", e.target.checked)} />
            <span>
              <span className="flex items-center gap-1.5 font-semibold"><LockSimple size={18} weight="fill" className="text-red-700" /> หนังสือลับ</span>
              <span className="block text-sm text-muted">เห็นเฉพาะ ผอ. ธุรการ และผู้ได้รับมอบหมาย</span>
            </span>
          </label>
        </div>

        <details className="rounded-xl border-[1.5px] border-line px-3 py-2" open={!!errors.receiveNo || undefined}>
          <summary className="flex min-h-10 cursor-pointer items-center text-sm font-semibold">กำหนดเลขรับเอง (ปกติไม่ต้องกรอก ระบบออกเลขถัดไปให้)</summary>
          <div className="pt-2">
            <Field label="เลขรับ" htmlFor="receiveNo" error={errors.receiveNo}>
              <input id="receiveNo" type="number" inputMode="numeric" min={1} className="field-input" value={f.receiveNo}
                aria-invalid={invalid("receiveNo")} onChange={(e) => set("receiveNo", e.target.value)} />
            </Field>
          </div>
        </details>
      </Card>

      <div className="sticky bottom-20 z-10 md:bottom-4">
        <Button type="submit" size="lg" className="w-full shadow-lg" disabled={busy || reading}>
          {busy ? <><span className="size-5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden /> {step}</> : "ลงรับ"}
        </Button>
      </div>
    </form>
  );
}
