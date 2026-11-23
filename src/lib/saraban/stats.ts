// สรุปสารบรรณรายปี (ผอ./ธุรการ): นับรายเดือน เวลาตั้งแต่ลงรับถึง ผอ. สั่งการ งานค้าง และการอ่าน — ฟังก์ชันล้วน ทดสอบด้วย node ได้
import type { BookStatus } from "./types.ts";

export type StatBook = { id: string; received_at: string; status: BookStatus; urgency: number; doc_type: string };
export type StatAction = { book_id: string; action: string; created_at: string };
export type StatRecipient = { book_id: string; assigned_at: string; read_at: string | null };
export type StatOut = { series: string; doc_date: string; deleted_at: string | null };

export type MonthRow = { month: number; received: number; internal: number; urgent: number; out: number; order: number; announce: number; memo: number };

export type SarabanStats = {
  months: MonthRow[];
  received: number;
  internal: number;
  outgoing: number;
  /** ค่ากลางชั่วโมงจากลงรับถึง ผอ. สั่งการ/จัดเก็บ (null = ยังไม่มีเล่มที่สั่งการ) */
  decisionHours: number | null;
  decided: number;
  waitingClerk: number;
  waitingDirector: number;
  /** อายุ (วัน) ของเล่มที่รอนานที่สุด */
  oldestWaitingDays: number | null;
  recipients: number;
  read: number;
  /** ค่ากลางชั่วโมงจากได้รับมอบถึงเปิดอ่าน */
  readHours: number | null;
  unreadOver2Days: number;
};

const HOUR = 3_600_000;
const DECISION = new Set(["endorse", "close"]);

/** เดือน (1–12) ตามเวลาไทย */
export function thaiMonth(ts: string): number {
  return new Date(Date.parse(ts) + 7 * HOUR).getUTCMonth() + 1;
}

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** ชั่วโมง → ข้อความสั้น: "45 นาที" · "5.5 ชม." · "2.3 วัน" */
export function formatDuration(hours: number | null): string {
  if (hours == null) return "–";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} นาที`;
  if (hours < 24) return `${Math.round(hours * 10) / 10} ชม.`;
  return `${Math.round((hours / 24) * 10) / 10} วัน`;
}

export function sarabanStats(
  d: { books: StatBook[]; actions: StatAction[]; recipients: StatRecipient[]; outgoing: StatOut[] },
  now: Date = new Date(),
): SarabanStats {
  const months: MonthRow[] = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, received: 0, internal: 0, urgent: 0, out: 0, order: 0, announce: 0, memo: 0 }));
  const row = (m: number) => months[m - 1];

  for (const b of d.books) {
    const r = row(thaiMonth(b.received_at));
    r.received++;
    if (b.doc_type === "internal") r.internal++;
    if (b.urgency >= 2) r.urgent++;
  }
  let outgoing = 0;
  for (const o of d.outgoing) {
    if (o.deleted_at) continue;
    const m = Number(o.doc_date.slice(5, 7));
    if (!(m >= 1 && m <= 12)) continue;
    if (o.series === "out" || o.series === "order" || o.series === "announce" || o.series === "memo") {
      row(m)[o.series]++;
      outgoing++;
    }
  }

  // เวลาตัดสินใจ: การสั่งการครั้งแรกของแต่ละเล่ม
  const firstDecision = new Map<string, number>();
  for (const a of d.actions) {
    if (!DECISION.has(a.action)) continue;
    const t = Date.parse(a.created_at);
    const prev = firstDecision.get(a.book_id);
    if (prev === undefined || t < prev) firstDecision.set(a.book_id, t);
  }
  const decisionHours: number[] = [];
  const nowMs = now.getTime();
  let waitingClerk = 0, waitingDirector = 0, oldest: number | null = null;
  for (const b of d.books) {
    const t = firstDecision.get(b.id);
    if (t !== undefined) decisionHours.push(Math.max(0, (t - Date.parse(b.received_at)) / HOUR));
    if (b.status === "registered" || b.status === "proposed") {
      if (b.status === "registered") waitingClerk++;
      else waitingDirector++;
      const days = (nowMs - Date.parse(b.received_at)) / (24 * HOUR);
      oldest = oldest === null ? days : Math.max(oldest, days);
    }
  }

  const readHours: number[] = [];
  let read = 0, unreadOver2Days = 0;
  for (const r of d.recipients) {
    if (r.read_at) {
      read++;
      readHours.push(Math.max(0, (Date.parse(r.read_at) - Date.parse(r.assigned_at)) / HOUR));
    } else if (nowMs - Date.parse(r.assigned_at) > 48 * HOUR) {
      unreadOver2Days++;
    }
  }

  return {
    months,
    received: d.books.length,
    internal: d.books.filter((b) => b.doc_type === "internal").length,
    outgoing,
    decisionHours: median(decisionHours),
    decided: decisionHours.length,
    waitingClerk,
    waitingDirector,
    oldestWaitingDays: oldest === null ? null : Math.floor(oldest),
    recipients: d.recipients.length,
    read,
    readHours: median(readHours),
    unreadOver2Days,
  };
}
