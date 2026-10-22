// วันที่แบบไทย (พ.ศ.) — ทุกฟังก์ชันใช้สตริง ISO "YYYY-MM-DD" เพื่อไม่ให้เพี้ยนตามเขตเวลา

export const THAI_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];
export const THAI_MONTHS_SHORT = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];
export const THAI_WEEKDAYS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
export const THAI_WEEKDAYS_SHORT = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];

/** วันนี้ตามเวลาประเทศไทย เป็น ISO */
export function todayISO(now: Date = new Date()): string {
  const th = new Date(now.getTime() + 7 * 3600_000);
  return th.toISOString().slice(0, 10);
}

export function parseISO(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

export function weekdayOf(iso: string): number {
  const { y, m, d } = parseISO(iso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(iso: string, days: number): string {
  const { y, m, d } = parseISO(iso);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function isWeekend(iso: string): boolean {
  const w = weekdayOf(iso);
  return w === 0 || w === 6;
}

/** "22 ต.ค. 2569" หรือแบบเต็ม "22 ตุลาคม 2569" */
export function formatThaiDate(iso: string | null | undefined, style: "short" | "long" | "weekday" = "short"): string {
  if (!iso) return "-";
  const { y, m, d } = parseISO(iso.slice(0, 10));
  const be = y + 543;
  if (style === "long") return `${d} ${THAI_MONTHS[m - 1]} ${be}`;
  if (style === "weekday") return `${THAI_WEEKDAYS[weekdayOf(iso)]} ${d} ${THAI_MONTHS_SHORT[m - 1]} ${be}`;
  return `${d} ${THAI_MONTHS_SHORT[m - 1]} ${be}`;
}

export function formatThaiDateTime(ts: string | null | undefined): string {
  if (!ts) return "-";
  const t = new Date(ts);
  const th = new Date(t.getTime() + 7 * 3600_000);
  const iso = th.toISOString();
  return `${formatThaiDate(iso.slice(0, 10))} ${iso.slice(11, 16)} น.`;
}

export function formatTime(ts: string | null | undefined): string {
  if (!ts) return "";
  const th = new Date(new Date(ts).getTime() + 7 * 3600_000);
  return th.toISOString().slice(11, 16);
}

/**
 * แปลงวันที่จาก DMC เช่น "30/03/2566" (วว/ดด/ปปปป พ.ศ.) เป็น ISO "2023-03-30"
 * รองรับเลขซีเรียลวันที่ของ Excel และปี ค.ศ. ด้วย คืนค่า null ถ้าแปลงไม่ได้
 */
export function parseDmcDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    // เลขซีเรียลของ Excel (นับจาก 1899-12-30)
    const ms = Math.round((value - 25569) * 86400_000);
    const iso = new Date(ms).toISOString().slice(0, 10);
    return fixBuddhistYear(iso);
  }
  const s = String(value).trim();
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    let y = Number(m[3]);
    if (y > 2400) y -= 543;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const date = new Date(Date.UTC(y, mo - 1, d));
    if (date.getUTCMonth() !== mo - 1) return null;
    return date.toISOString().slice(0, 10);
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return fixBuddhistYear(s.slice(0, 10));
  return null;
}

function fixBuddhistYear(iso: string): string {
  const { y, m, d } = parseISO(iso);
  if (y > 2400) return `${y - 543}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return iso;
}

/** อายุเป็น ปี เดือน ณ วันที่กำหนด */
export function ageOf(birthISO: string | null | undefined, atISO: string = todayISO()): string {
  if (!birthISO) return "-";
  const b = parseISO(birthISO);
  const a = parseISO(atISO);
  let months = (a.y - b.y) * 12 + (a.m - b.m);
  if (a.d < b.d) months -= 1;
  if (months < 0) return "-";
  return `${Math.floor(months / 12)} ปี ${months % 12} เดือน`;
}

/** ปีการศึกษาไทย: เริ่ม 16 พ.ค. ของปี */
export function academicYearOf(iso: string): number {
  const { y, m, d } = parseISO(iso);
  const be = y + 543;
  return m > 5 || (m === 5 && d >= 16) ? be : be - 1;
}

export function monthRange(year: number, month: number): { from: string; to: string } {
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from, to: `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}` };
}
