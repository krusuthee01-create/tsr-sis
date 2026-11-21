"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CaretRight, LockSimple, MagnifyingGlass, Tray, X } from "@phosphor-icons/react";
import { Button, Card, EmptyState, LinkTabs } from "@/components/ui";
import { useToast } from "@/components/toast";
import { STATUS_LABEL, URGENCY_LABEL, type BookStatus, type Urgency } from "@/lib/saraban/types";
import { formatThaiDate, todayISO } from "@/lib/thai-date";
import { loadInbox, type InboxRow } from "./actions";

export type InboxFilter = "all" | "todo" | "unread";

// สีป้ายตามชั้นความเร็ว: ปกติ เทา / ด่วน เหลือง / ด่วนมาก ส้ม / ด่วนที่สุด แดง
const URGENCY_STYLE: Record<Urgency, string> = {
  0: "bg-slate-100 text-slate-700",
  1: "bg-amber-100 text-amber-900",
  2: "bg-orange-100 text-orange-900",
  3: "bg-red-100 text-red-800",
};

const EMPTY_TEXT: Record<InboxFilter, string> = {
  todo: "ไม่มีงานค้างของท่าน",
  all: "ยังไม่มีหนังสือ",
  unread: "อ่านหนังสือครบทุกฉบับแล้ว",
};

function hrefFor(filter: InboxFilter, q: string) {
  const sp = new URLSearchParams({ f: filter });
  if (q) sp.set("q", q);
  return `/saraban?${sp}`;
}

export function Inbox({ rows, q, filter, offset, error }: { rows: InboxRow[]; q: string; filter: InboxFilter; offset: number; error: string | null }) {
  return (
    <>
      <Card className="mb-3 flex flex-col gap-3">
        <SearchBox q={q} filter={filter} />
        <LinkTabs current={filter} tabs={[
          { id: "todo", label: "งานของฉัน", href: hrefFor("todo", q) },
          { id: "all", label: "ทั้งหมด", href: hrefFor("all", q) },
          { id: "unread", label: "ยังไม่อ่าน", href: hrefFor("unread", q) },
        ]} />
      </Card>
      {error && <p className="mb-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{error}</p>}
      {/* key: เปลี่ยนคำค้น/ตัวกรอง เริ่มรายการใหม่ (ช่องค้นหาไม่ถูกสร้างใหม่ จึงไม่หลุดโฟกัส) */}
      <BookList key={`${filter}|${q}|${offset}`} initial={rows} q={q} filter={filter} offset={offset} />
    </>
  );
}

/** ช่องค้นหา: พิมพ์แล้วรอ 250ms ค่อยอัปเดต ?q= */
function SearchBox({ q, filter }: { q: string; filter: InboxFilter }) {
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState(q);
  const [pending, startTransition] = useTransition();
  const first = useRef(true);
  const pushed = useRef(q); // คำค้นล่าสุดที่ช่องนี้ส่งไปเอง

  // คำค้นเปลี่ยนจากที่อื่น (เช่น กดเมนูสารบรรณใหม่) → ให้ช่องตรงกับ URL
  useEffect(() => {
    if (q !== pushed.current) {
      pushed.current = q;
      setValue(q);
    }
  }, [q]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      const v = value.trim();
      if (v === pushed.current) return;
      pushed.current = v;
      const sp = new URLSearchParams({ f: filter });
      if (v) sp.set("q", v);
      startTransition(() => router.replace(`${pathname}?${sp}`, { scroll: false }));
    }, 250);
    return () => clearTimeout(t);
    // สั่งค้นเฉพาะเมื่อผู้ใช้พิมพ์ (filter อ่านค่าล่าสุดตอนครบเวลา)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="relative">
      <label htmlFor="saraban-q" className="sr-only">ค้นหาหนังสือ</label>
      <MagnifyingGlass size={20} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input id="saraban-q" type="search" value={value} onChange={(e) => setValue(e.target.value)} maxLength={200}
        className="field-input pl-10 pr-12" placeholder="ค้นหาเลขรับ เลขที่หนังสือ เรื่อง หรือหน่วยงาน" enterKeyHint="search" />
      {pending ? (
        <span className="absolute right-3.5 top-1/2 size-5 -translate-y-1/2 animate-spin rounded-full border-2 border-sky-200 border-t-navy-700" role="status"><span className="sr-only">กำลังค้นหา</span></span>
      ) : value ? (
        <button type="button" aria-label="ล้างคำค้น" onClick={() => setValue("")}
          className="absolute right-1 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100">
          <X size={18} />
        </button>
      ) : null}
    </div>
  );
}

function BookList({ initial, q, filter, offset }: { initial: InboxRow[]; q: string; filter: InboxFilter; offset: number }) {
  const toast = useToast();
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState(false);
  const total = Number(initial[0]?.total ?? 0);
  const hasMore = offset + rows.length < total && rows.length > 0;
  const today = todayISO();

  async function more() {
    setBusy(true);
    const res = await loadInbox(q, filter, offset + rows.length);
    setBusy(false);
    if (!res.ok) return toast(res.error, "error");
    setRows((r) => [...r, ...res.rows.filter((x) => !r.some((y) => y.id === x.id))]);
  }

  if (!rows.length) {
    return <EmptyState icon={<Tray size={40} weight="duotone" className="text-sky-400" />} title={q ? "ไม่พบหนังสือที่ค้นหา" : EMPTY_TEXT[filter]} />;
  }

  return (
    <Card className="p-0 md:p-0">
      <p className="border-b border-line px-4 py-3 text-sm text-muted">
        {q ? <>ผลการค้นหา &ldquo;{q}&rdquo; </> : null}{total.toLocaleString("th-TH")} ฉบับ
        {offset > 0 && <> · <Link href={hrefFor(filter, q)} className="font-semibold text-navy-700 underline">กลับไปรายการแรก</Link></>}
      </p>
      <ul className="divide-y divide-slate-100">
        {rows.map((b) => {
          const urgency = (b.urgency in URGENCY_LABEL ? b.urgency : 0) as Urgency;
          const overdue = !!b.due_date && b.due_date < today && b.status !== "closed";
          return (
            <li key={b.id}>
              <Link href={`/saraban/book/${b.id}`} className={`flex items-center gap-3 px-4 py-3 hover:bg-sky-50 ${b.unread ? "bg-sky-50/50" : ""}`}>
                <span className="flex min-w-14 shrink-0 flex-col items-center rounded-xl bg-red-50 px-2 py-1 text-red-900">
                  <span className="font-display text-lg font-bold leading-tight">{b.receive_no}</span>
                  <span className="text-[0.6875rem] leading-tight">/{b.year}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`flex items-center gap-1.5 ${b.unread ? "font-bold" : "font-semibold"}`}>
                    {b.unread && <><span className="size-2 shrink-0 rounded-full bg-sky-600" aria-hidden /><span className="sr-only">ยังไม่อ่าน</span></>}
                    {b.secret && <><LockSimple size={18} weight="fill" className="shrink-0 text-red-700" aria-hidden /><span className="sr-only">หนังสือลับ</span></>}
                    <span className="line-clamp-2">{b.subject}</span>
                  </span>
                  <span className={`block truncate text-sm text-muted ${b.unread ? "font-semibold" : ""}`}>
                    {b.from_org}{b.doc_no ? ` · ${b.doc_no}` : ""}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                    <span className={`rounded-full px-2.5 py-0.5 font-bold ${URGENCY_STYLE[urgency]}`}>{URGENCY_LABEL[urgency]}</span>
                    <span className="rounded-full bg-sky-100 px-2.5 py-0.5 font-bold text-sky-900">{STATUS_LABEL[b.status as BookStatus] ?? b.status}</span>
                    {b.due_date && (
                      <span className={`rounded-full px-2.5 py-0.5 font-bold ${overdue ? "bg-red-600 text-white" : "bg-slate-100 text-slate-700"}`}>
                        {overdue ? "เลยกำหนด " : "กำหนด "}{formatThaiDate(b.due_date)}
                      </span>
                    )}
                    <span className="text-muted">รับ {formatThaiDate(todayISO(new Date(b.received_at)))}{b.holder_name ? ` · อยู่ที่ ${b.holder_name}` : ""}</span>
                  </span>
                </span>
                <CaretRight size={20} className="shrink-0 text-slate-400" />
              </Link>
            </li>
          );
        })}
      </ul>
      {hasMore && (
        <div className="border-t border-line p-3">
          <Button variant="secondary" className="w-full" onClick={more} disabled={busy}>
            {busy ? "กำลังโหลด…" : `โหลดเพิ่ม (เหลือ ${(total - offset - rows.length).toLocaleString("th-TH")} ฉบับ)`}
          </Button>
        </div>
      )}
    </Card>
  );
}
