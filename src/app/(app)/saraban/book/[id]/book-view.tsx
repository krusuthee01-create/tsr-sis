"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowSquareOut, CheckCircle, Clock, DotsThree, FilePdf, LockSimple, Paperclip } from "@phosphor-icons/react";
import { Badge, Button, Card, SectionTitle } from "@/components/ui";
import { useToast } from "@/components/toast";
import { withBase } from "@/lib/base-path";
import { formatThaiDate, formatThaiDateTime, todayISO } from "@/lib/thai-date";
import { STATUS_LABEL, URGENCY_LABEL, type FileKind } from "@/lib/saraban/types";
import { ACTION_LABEL, FILE_KIND_LABEL, latestFile, type BookDetail, type Preset, type StaffOption } from "@/lib/saraban/book";
import { deleteBook, markRead, renumberBook } from "../../actions";
import { attachPdf, readPdf } from "../../pdf-client";
import { EndorsePanel, Sheet, type Me } from "./endorse-panel";

const URGENCY_TONE = { 0: "gray", 1: "amber", 2: "amber", 3: "red" } as const;

export function BookView({ detail, me, staff, presets, schoolName }: {
  detail: BookDetail; me: Me; staff: StaffOption[]; presets: Preset[]; schoolName: string;
}) {
  const router = useRouter();
  const { book, files, actions, recipients } = detail;
  const latest = latestFile(files);
  const nameOf = useMemo(() => new Map(staff.map((s) => [s.id, s.name])), [staff]);
  const isOffice = me.role === "director" || me.role === "clerk";
  const mine = recipients.find((r) => r.staff_id === me.id);

  // ผู้รับเปิดหน้าครั้งแรก → บันทึกว่าอ่านแล้ว (ครั้งเดียว)
  const marked = useRef(false);
  useEffect(() => {
    if (!mine || mine.read_at || marked.current) return;
    marked.current = true;
    markRead(book.id).then((r) => { if (r.ok) router.refresh(); }).catch(() => {});
  }, [mine, book.id, router]);

  const overdue = book.due_date && book.due_date < todayISO() && book.status !== "closed";

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:items-start">
      <div className="flex min-w-0 flex-col gap-4 xl:col-start-2 xl:row-start-1">
        <Card className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="blue">{STATUS_LABEL[book.status]}</Badge>
            {book.urgency > 0 && <Badge tone={URGENCY_TONE[book.urgency]}>{URGENCY_LABEL[book.urgency]}</Badge>}
            {book.secret && <Badge tone="red"><LockSimple size={14} weight="fill" aria-hidden /> ลับ</Badge>}
            {overdue && <Badge tone="red">เลยกำหนด</Badge>}
            {isOffice && <OfficeMenu bookId={book.id} receiveNo={book.receive_no} />}
          </div>
          <h2 className="text-lg font-semibold leading-snug">{book.subject}</h2>
          <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1 text-[0.9375rem]">
            <dt className="text-muted">เลขที่หนังสือ</dt><dd>{book.doc_no || "-"}{book.doc_date ? ` ลว. ${formatThaiDate(book.doc_date)}` : ""}</dd>
            <dt className="text-muted">จาก</dt><dd>{book.from_org}</dd>
            {book.to_text && <><dt className="text-muted">ถึง</dt><dd>{book.to_text}</dd></>}
            <dt className="text-muted">ลงรับ</dt><dd>{formatThaiDateTime(book.received_at)}</dd>
            {book.due_date && <><dt className="text-muted">กำหนดเสร็จ</dt><dd className={overdue ? "font-semibold text-red-700" : ""}>{formatThaiDate(book.due_date)}</dd></>}
            {book.holder_name && <><dt className="text-muted">อยู่ที่</dt><dd>{book.holder_name}</dd></>}
          </dl>
        </Card>
        <EndorsePanel detail={detail} me={me} staff={staff} presets={presets} schoolName={schoolName} />
      </div>

      <div className="flex min-w-0 flex-col gap-4 xl:col-start-1 xl:row-span-2 xl:row-start-1">
        <Card className="flex flex-col gap-3">
          <SectionTitle action={latest ? (
            <a href={withBase(`/saraban/api/file/${latest.id}`)} target="_blank" rel="noopener"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 font-semibold text-navy-700 hover:bg-navy-50">
              <ArrowSquareOut size={20} /> เปิด PDF
            </a>
          ) : undefined}>ตัวหนังสือ</SectionTitle>
          {latest ? (
            <iframe src={withBase(`/saraban/api/file/${latest.id}`)} title={`ไฟล์หนังสือรับที่ ${book.receive_no}/${book.year}`}
              className="h-[60dvh] w-full rounded-xl border border-line bg-slate-50 xl:h-[82vh]" />
          ) : (
            <p className="rounded-xl bg-slate-50 px-3 py-6 text-center text-muted">ยังไม่มีไฟล์หนังสือ</p>
          )}
          {/* แนบไฟล์อีกครั้งได้เฉพาะก่อนเกษียน (ระบบอนุญาตอัปโหลดฉบับประทับตราเฉพาะขั้นนี้) */}
          {isOffice && latest?.kind !== "stamped" && (book.status === "registered" || book.status === "proposed") && (
            <Reattach stamp={{ schoolName, receiveNo: book.receive_no, year: book.year, receivedAt: book.received_at, bookId: book.id }} />
          )}
          {files.length > 1 && (
            <details className="text-sm">
              <summary className="flex min-h-11 cursor-pointer items-center font-semibold">ไฟล์ทั้งหมด ({files.length})</summary>
              <ul className="flex flex-col gap-1">
                {[...files].sort((a, b) => a.created_at.localeCompare(b.created_at)).map((f) => (
                  <li key={f.id}>
                    <a href={withBase(`/saraban/api/file/${f.id}`)} target="_blank" rel="noopener" className="inline-flex min-h-10 items-center gap-1.5 text-navy-700 underline">
                      <FilePdf size={18} /> {FILE_KIND_LABEL[f.kind]} รุ่น {f.version}
                    </a> <span className="text-muted">· {formatThaiDateTime(f.created_at)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Card>
      </div>

      <div className="flex min-w-0 flex-col gap-4 xl:col-start-2 xl:row-start-2">
        {recipients.length > 0 && (
          <Card>
            <SectionTitle>ผู้รับ ({recipients.filter((r) => r.read_at).length}/{recipients.length} อ่านแล้ว)</SectionTitle>
            <ul className="flex flex-col divide-y divide-line">
              {recipients.map((r) => (
                <li key={r.staff_id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">{r.name}</span>
                  {r.read_at ? (
                    <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-green-700">
                      <CheckCircle size={18} weight="fill" aria-hidden /> อ่านแล้ว <span className="font-normal text-muted">{formatThaiDateTime(r.read_at)}</span>
                    </span>
                  ) : (
                    <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-amber-800"><Clock size={18} aria-hidden /> ยังไม่อ่าน</span>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}
        <Card>
          <SectionTitle>ประวัติ</SectionTitle>
          <ol className="flex flex-col gap-3 border-l-2 border-sky-200 pl-4">
            {[...actions].reverse().map((a) => (
              <li key={a.id} className="relative">
                <span className="absolute -left-[1.4rem] top-1.5 size-3 rounded-full bg-navy-700" aria-hidden />
                <p className="font-semibold">{ACTION_LABEL[a.action] ?? a.action}
                  <span className="font-normal text-muted"> · {a.actor_name ?? "ระบบ"}</span></p>
                <p className="text-sm text-muted">{formatThaiDateTime(a.created_at)}</p>
                {a.action === "upload" ? (
                  <p className="text-sm">{FILE_KIND_LABEL[a.note as FileKind] ?? a.note}</p>
                ) : a.note ? (
                  <p className="whitespace-pre-wrap text-[0.9375rem]">“{a.note}”</p>
                ) : null}
                {a.targets.length > 0 && a.action !== "propose" && (
                  <p className="text-sm">ถึง {a.targets.map((t) => nameOf.get(t) ?? "ไม่ทราบชื่อ").join(", ")}</p>
                )}
                {a.file_id && a.action !== "upload" && (
                  <a href={withBase(`/saraban/api/file/${a.file_id}`)} target="_blank" rel="noopener" className="inline-flex min-h-10 items-center gap-1 text-sm text-navy-700 underline">
                    <Paperclip size={16} /> ไฟล์ที่ลงนาม
                  </a>
                )}
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}

/** แนบไฟล์อีกครั้ง (ลงรับแล้วแต่อัปโหลด/ประทับตราไม่สำเร็จ): ขั้นตอนเดียวกับหน้าลงรับ */
function Reattach({ stamp }: { stamp: Parameters<typeof attachPdf>[1] }) {
  const router = useRouter();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<string | null>(null);
  const running = useRef(false);

  async function pick(file: File | undefined) {
    if (!file || running.current) return;
    running.current = true;
    try {
      setStep("กำลังตรวจไฟล์…");
      const pdf = await readPdf(file).catch((err: unknown) => {
        toast(err instanceof Error ? err.message : "เปิดไฟล์ไม่ได้", "error");
        return null;
      });
      if (!pdf) return;
      const r = await attachPdf(pdf, stamp, setStep);
      if (!r.ok) toast(`${r.stage === "upload" ? "อัปโหลดไฟล์ไม่สำเร็จ" : "ประทับตรารับไม่สำเร็จ"} (${r.error})`, "error");
      else if (!r.stamped) toast("แนบไฟล์แล้ว — ไฟล์ PDF ถูกล็อกไว้ จึงประทับตรารับลงไฟล์ไม่ได้", "info");
      else toast("แนบไฟล์และประทับตรารับแล้ว");
      router.refresh();
    } finally {
      running.current = false;
      setStep(null);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div>
      <input ref={input} id="reattach-file" type="file" accept="application/pdf,.pdf" className="sr-only" disabled={!!step}
        onChange={(e) => pick(e.target.files?.[0])} />
      <label htmlFor="reattach-file" aria-disabled={!!step}
        className={`inline-flex min-h-[2.875rem] w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-[1.5px] border-slate-300 bg-white px-4 font-semibold hover:bg-slate-50 ${step ? "pointer-events-none opacity-60" : ""}`}>
        <Paperclip size={20} /> {step ?? "แนบไฟล์อีกครั้ง"}
      </label>
    </div>
  );
}

/** เมนูรอง (ผอ./ธุรการ): แก้เลขรับ, ลบ (ระบุเหตุผล) */
function OfficeMenu({ bookId, receiveNo }: { bookId: string; receiveNo: number }) {
  const router = useRouter();
  const toast = useToast();
  const [menu, setMenu] = useState(false);
  const [sheet, setSheet] = useState<"renumber" | "delete" | null>(null);
  const [no, setNo] = useState(String(receiveNo));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string, after: () => void) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fn();
      if (!r.ok) return toast(r.error, "error");
      toast(done);
      setSheet(null);
      after();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative ml-auto">
      <button type="button" aria-label="เมนูเพิ่มเติม" aria-expanded={menu} onClick={() => setMenu((m) => !m)}
        className="flex size-11 items-center justify-center rounded-xl hover:bg-slate-100"><DotsThree size={26} weight="bold" /></button>
      {menu && (
        <div className="absolute right-0 top-12 z-20 flex w-52 flex-col rounded-2xl border border-line bg-white p-1 shadow-xl">
          <button type="button" className="min-h-11 rounded-xl px-3 text-left hover:bg-slate-50" onClick={() => { setMenu(false); setNo(String(receiveNo)); setSheet("renumber"); }}>แก้เลขรับ</button>
          <button type="button" className="min-h-11 rounded-xl px-3 text-left text-red-700 hover:bg-red-50" onClick={() => { setMenu(false); setReason(""); setSheet("delete"); }}>ลบ (ระบุเหตุผล)</button>
        </div>
      )}
      <Sheet open={sheet === "renumber"} onClose={() => setSheet(null)} title="แก้เลขรับ">
        <label htmlFor="renumber" className="text-sm font-semibold">เลขรับใหม่</label>
        <input id="renumber" type="number" inputMode="numeric" min={1} className="field-input mt-1.5 w-full" value={no} onChange={(e) => setNo(e.target.value)} />
        <Button size="lg" className="mt-4 w-full" disabled={busy || !/^\d+$/.test(no.trim())}
          onClick={() => run(() => renumberBook(bookId, Number(no)), "แก้เลขรับแล้ว", () => router.refresh())}>บันทึก</Button>
      </Sheet>
      <Sheet open={sheet === "delete"} onClose={() => setSheet(null)} title="ลบหนังสือ">
        <p className="mb-3 text-[0.9375rem] text-muted">หนังสือจะถูกซ่อนจากทุกคน (ข้อมูลยังเก็บไว้ตามระเบียบ)</p>
        <label htmlFor="delete-reason" className="text-sm font-semibold">เหตุผลที่ลบ <span className="text-red-600">*</span></label>
        <textarea id="delete-reason" className="field-input mt-1.5 w-full" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button variant="danger" size="lg" className="mt-4 w-full" disabled={busy || !reason.trim()}
          onClick={() => run(() => deleteBook(bookId, reason), "ลบหนังสือแล้ว", () => router.push("/saraban"))}>ลบหนังสือ</Button>
      </Sheet>
    </div>
  );
}
