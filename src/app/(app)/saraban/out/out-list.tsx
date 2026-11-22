"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, FilePdf, LockSimple, Paperclip, Plus, Prohibit } from "@phosphor-icons/react";
import { Button, Card, EmptyState, Field, btnClass } from "@/components/ui";
import { ExportButton, PrintButton } from "@/components/export-button";
import { useToast } from "@/components/toast";
import { withBase } from "@/lib/base-path";
import { formatThaiDate, todayISO } from "@/lib/thai-date";
import { safeMessage } from "@/lib/saraban/book";
import { OUT_KIND_LABEL, SERIES_KINDS, type OutKind, type OutRow, type OutSeries } from "@/lib/saraban/outgoing";
import { Sheet } from "../book/[id]/endorse-panel";
import { readPdf } from "../pdf-client";
import { uploadOutPdf } from "../upload";
import { cancelOut, issueOut } from "./actions";

export type OutItem = OutRow & { requester: string; fileId: string | null; cells: string[] };

/** รายการทะเบียน + ขอเลข + แนบสำเนา + ยกเลิกเลข + ส่งออก */
export function OutList(props: {
  series: OutSeries; year: number; thisYear: number; items: OutItem[]; head: string[];
  me: string; office: boolean; prefix: string; fileName: string; error: string | null;
}) {
  const { series, year, thisYear, items, head, me, office, fileName, error } = props;
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const term = q.trim();
  const shown = useMemo(() => (!term ? items : items.filter((o) =>
    o.doc_no.includes(term) || o.subject.includes(term) || (o.to_text ?? "").includes(term) || o.requester.includes(term))), [items, term]);

  return (
    <>
      <Card className="no-print mb-3 flex flex-wrap items-end gap-3">
        <Button onClick={() => setOpen(true)} disabled={year !== thisYear} title={year !== thisYear ? "ขอเลขได้เฉพาะปีปัจจุบัน" : undefined}>
          <Plus size={20} weight="bold" /> ขอเลข{series === "out" ? "หนังสือส่ง" : OUT_KIND_LABEL[SERIES_KINDS[series][0]]}
        </Button>
        <label className="flex flex-col gap-1 text-sm font-semibold">ปี พ.ศ.
          <select className="field-input" value={year} onChange={(e) => router.push(`/saraban/out?s=${series}&y=${e.target.value}`)}>
            {Array.from({ length: 6 }, (_, i) => thisYear - i).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <input type="search" className="field-input w-full sm:w-auto sm:min-w-48 sm:flex-1" placeholder="ค้นหาเลขที่ เรื่อง ถึง ผู้ขอ" aria-label="ค้นหา" value={q} onChange={(e) => setQ(e.target.value)} />
        <ExportButton filename={fileName} sheets={[{ name: "ทะเบียน", rows: [head, ...shown.map((o) => o.cells)], widths: series === "out" ? [10, 24, 14, 26, 26, 60, 26, 26] : [12, 14, 70, 26, 30] }]} />
        <PrintButton />
      </Card>
      {error && <Card className="mb-3 bg-red-50 text-red-900">{error}</Card>}

      {shown.length === 0 ? (
        <EmptyState title={term ? "ไม่พบรายการที่ค้นหา" : "ยังไม่มีรายการในปีนี้"} />
      ) : (
        <>
          <ul className="no-print flex flex-col gap-2">
            {shown.map((o) => <OutCard key={o.id} o={o} canEdit={!o.deleted_at && (office || o.requested_by === me)} office={office} />)}
          </ul>
          {/* ตารางสำหรับพิมพ์ (แบบทะเบียนตามระเบียบงานสารบรรณ) */}
          <table className="data-table print-only w-full table-fixed border-collapse text-left">
            <colgroup>{(series === "out" ? ["7%", "13%", "9%", "12%", "16%", "23%", "11%", "9%"] : ["10%", "12%", "48%", "15%", "15%"]).map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
            <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{[...shown].reverse().map((o) => <tr key={o.id} style={{ breakInside: "avoid" }}>{o.cells.map((c, j) => <td key={j} className="break-words">{c}</td>)}</tr>)}</tbody>
          </table>
        </>
      )}
      <IssueSheet open={open} onClose={() => setOpen(false)} series={series} />
    </>
  );
}

function OutCard({ o, canEdit, office }: { o: OutItem; canEdit: boolean; office: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");

  async function attach(file: File) {
    setBusy("กำลังแนบสำเนา…");
    try {
      const pdf = await readPdf(file);
      await uploadOutPdf(o.id, `${o.doc_no} ${pdf.file.name}`.replace(/\//g, "-").slice(0, 200), pdf.file);
      toast("แนบสำเนาแล้ว");
      router.refresh();
    } catch (e) {
      toast(safeMessage(e, "แนบสำเนาไม่สำเร็จ"), "error");
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    setBusy("กำลังยกเลิก…");
    const r = await cancelOut(o.id, reason);
    setBusy(null);
    if (!r.ok) return toast(r.error, "error");
    setCancelOpen(false);
    toast(`ยกเลิกเลข ${o.doc_no} แล้ว`);
    router.refresh();
  }

  return (
    <li>
      <Card className={`flex flex-col gap-2 ${o.deleted_at ? "opacity-60" : ""}`}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className={`text-lg font-bold ${o.deleted_at ? "line-through" : ""}`}>{o.doc_no}</span>
          <span className="text-sm text-muted">{formatThaiDate(o.doc_date)}</span>
          {o.kind === "circular" && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-900">หนังสือเวียน</span>}
          {o.secret && <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800"><LockSimple size={12} weight="fill" aria-hidden /> ลับ</span>}
          {o.deleted_at && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold">ยกเลิก: {o.deleted_reason}</span>}
        </div>
        <p className="font-semibold leading-snug">{o.subject}</p>
        <p className="text-sm text-muted">{o.to_text ? `ถึง ${o.to_text} · ` : ""}ขอเลขโดย {o.requester}{o.note ? ` · ${o.note}` : ""}</p>
        <div className="flex flex-wrap gap-2">
          {o.fileId && (
            <a href={withBase(`/saraban/api/file/${o.fileId}`)} target="_blank" rel="noopener" className={btnClass("secondary", "sm")}>
              <FilePdf size={18} /> สำเนา
            </a>
          )}
          {canEdit && (
            <>
              <input ref={fileInput} type="file" accept="application/pdf,.pdf" className="sr-only" aria-label="เลือกไฟล์ PDF"
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) attach(f); }} />
              <button type="button" className={btnClass("secondary", "sm")} disabled={!!busy} onClick={() => fileInput.current?.click()}>
                <Paperclip size={18} /> {busy ?? (o.fileId ? "แนบฉบับใหม่" : "แนบสำเนา PDF")}
              </button>
            </>
          )}
          {office && !o.deleted_at && (
            <button type="button" className={btnClass("ghost", "sm")} onClick={() => setCancelOpen(true)}><Prohibit size={18} /> ยกเลิกเลข</button>
          )}
        </div>
      </Card>
      <Sheet open={cancelOpen} onClose={() => setCancelOpen(false)} title={`ยกเลิกเลข ${o.doc_no}`}>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">เลขที่ยกเลิกยังอยู่ในทะเบียนพร้อมเหตุผล (ไม่นำเลขกลับมาใช้ใหม่)</p>
          <Field label="เหตุผล" htmlFor={`cancel-${o.id}`} required>
            <input id={`cancel-${o.id}`} className="field-input" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Button variant="danger" disabled={!reason.trim() || !!busy} onClick={cancel}>{busy ?? "ยืนยันยกเลิกเลข"}</Button>
        </div>
      </Sheet>
    </li>
  );
}

/** ขอเลข: กรอกเรื่อง (และถึง) → ได้เลขทันที แนบ PDF ได้เลยหรือภายหลัง */
function IssueSheet({ open, onClose, series }: { open: boolean; onClose: () => void; series: OutSeries }) {
  const router = useRouter();
  const toast = useToast();
  const kinds = SERIES_KINDS[series];
  const [f, setF] = useState({ kind: kinds[0] as OutKind, docDate: todayISO(), toText: "", subject: "", secret: false, note: "" });
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [issued, setIssued] = useState<string | null>(null);
  const running = useRef(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  function close() {
    if (step) return;
    onClose();
    setIssued(null);
    setFile(null);
    setF({ kind: kinds[0], docDate: todayISO(), toText: "", subject: "", secret: false, note: "" });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (running.current) return;
    running.current = true;
    try {
      // ตรวจไฟล์ก่อนออกเลข (เลขที่ออกแล้วไม่นำกลับมาใช้)
      const pdf = file ? await readPdf(file).catch((err) => { toast(safeMessage(err, "ไฟล์ไม่ถูกต้อง"), "error"); return null; }) : null;
      if (file && !pdf) return;
      setStep("กำลังขอเลข…");
      const r = await issueOut({ ...f, kind: kinds.includes(f.kind) ? f.kind : kinds[0] });
      if (!r.ok) return toast(r.error, "error");
      if (pdf) {
        setStep("กำลังแนบสำเนา…");
        await uploadOutPdf(r.id, `${r.docNo} ${pdf.file.name}`.replace(/\//g, "-").slice(0, 200), pdf.file)
          .catch((err) => toast(`ได้เลขแล้ว แต่แนบสำเนาไม่สำเร็จ (${safeMessage(err, "ไม่ทราบสาเหตุ")}) แนบใหม่ได้ในรายการ`, "error"));
      }
      setIssued(r.docNo);
      router.refresh();
    } finally {
      running.current = false;
      setStep(null);
    }
  }

  return (
    <Sheet open={open} onClose={close} title={issued ? "ได้เลขหนังสือแล้ว" : "ขอเลข"}>
      {issued ? (
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <p className="text-sm text-muted">เลขที่หนังสือ</p>
          <p className="text-3xl font-bold" aria-live="polite">{issued}</p>
          <div className="flex w-full flex-col gap-2">
            <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(issued).then(() => toast("คัดลอกแล้ว"), () => {})}>
              <Copy size={20} /> คัดลอกเลข
            </Button>
            <Button onClick={close}>เสร็จสิ้น</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          {kinds.length > 1 && (
            <fieldset className="grid grid-cols-2 gap-2">
              <legend className="mb-1.5 text-sm font-semibold">ชนิด</legend>
              {kinds.map((k) => (
                <label key={k} className={`flex min-h-12 cursor-pointer items-center justify-center rounded-xl border-[1.5px] font-semibold ${f.kind === k ? "border-navy-700 bg-navy-700 text-white" : "border-slate-300 bg-white"}`}>
                  <input type="radio" name="kind" className="sr-only" checked={f.kind === k} onChange={() => set("kind", k)} />
                  {OUT_KIND_LABEL[k]}
                </label>
              ))}
            </fieldset>
          )}
          <Field label="ลงวันที่" htmlFor="out-date">
            <input id="out-date" type="date" className="field-input" value={f.docDate} onChange={(e) => set("docDate", e.target.value)} />
          </Field>
          {series === "out" && (
            <Field label="ถึง (เรียน)" htmlFor="out-to">
              <input id="out-to" className="field-input" maxLength={300} value={f.toText} onChange={(e) => set("toText", e.target.value)} />
            </Field>
          )}
          <Field label="เรื่อง" htmlFor="out-subject" required>
            <textarea id="out-subject" className="field-input" rows={2} maxLength={1000} value={f.subject} onChange={(e) => set("subject", e.target.value)} />
          </Field>
          <Field label="หมายเหตุ (ถ้ามี)" htmlFor="out-note">
            <input id="out-note" className="field-input" maxLength={1000} value={f.note} onChange={(e) => set("note", e.target.value)} />
          </Field>
          <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border-[1.5px] border-line px-3 py-2">
            <input type="checkbox" className="size-5" checked={f.secret} onChange={(e) => set("secret", e.target.checked)} />
            <span><span className="font-semibold">หนังสือลับ</span> <span className="block text-sm text-muted">เห็นเฉพาะ ผอ. ธุรการ และผู้ขอเลข</span></span>
          </label>
          <Field label="สำเนา PDF (ไม่บังคับ แนบภายหลังได้)" htmlFor="out-file">
            <input id="out-file" type="file" accept="application/pdf,.pdf" className="field-input" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
          <Button type="submit" size="lg" disabled={!!step || !f.subject.trim()}>{step ?? "ขอเลข"}</Button>
        </form>
      )}
    </Sheet>
  );
}
