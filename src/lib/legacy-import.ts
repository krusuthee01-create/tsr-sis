// นำเข้าข้อมูลจากระบบเช็กชื่อเดิม (Google Sheets + Apps Script): ชีต Attendance และ น้ำหนักส่วนสูง
// อ่านบนเครื่องผู้ใช้ ไม่อ่านชีต Teachers / Settings (มีรหัสผ่านและลายเซ็น)

export const LEGACY_SHEETS = ["Attendance", "น้ำหนักส่วนสูง"];
export const LEAVE_NOTE = "ลา (นำเข้าจากระบบเดิม ไม่ระบุประเภท)";
const THAI_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

/** วันที่จากชีต: เลขวันที่ของ Excel (บางแถวเก็บปีเป็น พ.ศ.) หรือข้อความ dd/mm/yyyy → "YYYY-MM-DD" (ค.ศ.) */
export function legacyDate(v: unknown): string | null {
  if (typeof v === "number" && v > 0) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
    let y = d.getUTCFullYear();
    if (y > 2400) y -= 543;
    return `${y}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  const m = str(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    let y = Number(m[3]);
    if (y > 2400) y -= 543;
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  const iso = str(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) { const y = Number(iso[1]); return `${y > 2400 ? y - 543 : y}-${iso[2]}-${iso[3]}`; }
  return null;
}

/** "อนุบาล 1/1" → "อ.1/1", "ป.2/2" → "ป.2/2" */
export function legacyClass(v: unknown): string {
  const s = str(v).replace(/\s+/g, "");
  const k = s.match(/^อนุบาล(?:ปีที่)?(\d)\/(\d+)/);
  if (k) return `อ.${k[1]}/${k[2]}`;
  const p = s.match(/^(?:ป\.|ประถมศึกษาปีที่)(\d)\/(\d+)/);
  return p ? `ป.${p[1]}/${p[2]}` : s;
}

export function roundName(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${THAI_MONTHS[m - 1]} ${y + 543}`;
}

const STATUS: Record<string, number> = { "มา": 0, "สาย": 1, "ลาป่วย": 2, "ลากิจ": 3, "ลา": 3, "ขาด": 4 };

export type LegacyAttendance = { code: string; cls: string; date: string; status: number; leave: boolean; milk: boolean | null; brush: boolean | null; at: number };
export type LegacyMeasure = { code: string; cls: string; date: string; month: string; weight: number; height: number; swapped: boolean };
export type LegacyIssue = { sheet: string; row: number; code: string; reason: string };
export type LegacyFile = {
  attendance: LegacyAttendance[]; measures: LegacyMeasure[]; issues: LegacyIssue[];
  stats: { rows: number; duplicates: number; weekend: number; days: number; from: string | null; to: string | null; swapped: number; measureRows: number };
};

const bool = (v: unknown, yes: string, no: string) => (str(v) === yes ? true : str(v) === no ? false : null);
const weekend = (d: string) => [0, 6].includes(new Date(d + "T00:00:00Z").getUTCDay());

export function parseLegacyWorkbook(sheet: (name: string) => unknown[][] | null): LegacyFile {
  const att = sheet("Attendance");
  if (!att) throw new Error("ไม่พบชีต \"Attendance\" — กรุณาเลือกไฟล์ที่ดาวน์โหลดจาก Google Sheets ของระบบเช็กชื่อเดิม");
  const head = att[0]?.map(str) ?? [];
  const col = (name: string) => head.indexOf(name);
  const [cTime, cDate, cId, cClass, cAtt, cMilk, cBrush] = ["Timestamp", "Date", "StudentID", "Class", "Att_Status", "Milk_Status", "Brush_Status"].map(col);
  if ([cDate, cId, cAtt].some((c) => c < 0)) throw new Error("ชีต Attendance ไม่มีคอลัมน์ Date / StudentID / Att_Status");

  const issues: LegacyIssue[] = [];
  const latest = new Map<string, LegacyAttendance>();
  let rows = 0, wk = 0;
  att.slice(1).forEach((r, i) => {
    const code = str(r[cId]);
    if (!code) return;
    rows += 1;
    const date = legacyDate(r[cDate]);
    const status = STATUS[str(r[cAtt])];
    if (!date || status === undefined) { issues.push({ sheet: "Attendance", row: i + 2, code, reason: !date ? "วันที่อ่านไม่ได้" : `สถานะ "${str(r[cAtt])}" ไม่รู้จัก` }); return; }
    if (weekend(date)) { wk += 1; return; }
    const at = typeof r[cTime] === "number" ? (r[cTime] as number) : i;
    const rec: LegacyAttendance = { code, cls: legacyClass(r[cClass]), date, status, leave: str(r[cAtt]) === "ลา", milk: bool(r[cMilk], "ดื่ม", "ไม่ดื่ม"), brush: bool(r[cBrush], "แปรง", "ไม่แปรง"), at };
    const key = `${code}|${date}`;
    const old = latest.get(key);
    if (!old || at >= old.at) latest.set(key, rec);
  });
  const attendance = [...latest.values()].sort((a, b) => a.date.localeCompare(b.date) || a.code.localeCompare(b.code));
  const days = [...new Set(attendance.map((a) => a.date))].sort();

  const measures: LegacyMeasure[] = [];
  let measureRows = 0;
  const ws = sheet("น้ำหนักส่วนสูง");
  if (ws) {
    const h = ws[0]?.map(str) ?? [];
    const [mDate, mId, mClass, mW, mH, mMonth] = ["Date", "StudentID", "Class", "Weight (kg)", "Height (cm)", "RecordedMonth"].map((n) => h.indexOf(n));
    const byKey = new Map<string, LegacyMeasure>();
    ws.slice(1).forEach((r, i) => {
      const code = str(r[mId]);
      if (!code) return;
      measureRows += 1;
      const date = legacyDate(r[mDate]);
      const month = (legacyDate(r[mMonth]) ?? date)?.slice(0, 7);
      let w = Number(r[mW]), ht = Number(r[mH]);
      if (!date || !month || !Number.isFinite(w) || !Number.isFinite(ht) || w <= 0 || ht <= 0) {
        issues.push({ sheet: "น้ำหนักส่วนสูง", row: i + 2, code, reason: "น้ำหนัก/ส่วนสูง/วันที่ว่างหรืออ่านไม่ได้" });
        return;
      }
      // เด็กอนุบาล-ประถม ส่วนสูงมากกว่าน้ำหนักเสมอ ถ้ากลับกันแปลว่ากรอกสลับช่อง
      let swapped = false;
      if (w > ht) { [w, ht] = [ht, w]; swapped = true; }
      // ตรวจความสมเหตุสมผล: ช่วงค่า, ดัชนีมวลกาย และเด็กอนุบาลไม่ควรหนักเกิน 45 กก.
      const bmi = w / (ht / 100) ** 2;
      if (w < 8 || w > 120 || ht < 70 || ht > 200 || bmi < 9 || bmi > 40 || (legacyClass(r[mClass]).startsWith("อ.") && w > 45)) {
        issues.push({ sheet: "น้ำหนักส่วนสูง", row: i + 2, code, reason: `ค่าไม่สมเหตุสมผล (น้ำหนัก ${r[mW]} ส่วนสูง ${r[mH]}) — กรอกเองในเมนูภาวะโภชนาการ` });
        return;
      }
      // เดือนเดียวกันมีหลายครั้ง ใช้ครั้งล่าสุด
      const prev = byKey.get(`${code}|${month}`);
      if (!prev || date >= prev.date) byKey.set(`${code}|${month}`, { code, cls: legacyClass(r[mClass]), date, month, weight: w, height: ht, swapped });
    });
    measures.push(...[...byKey.values()].sort((a, b) => a.month.localeCompare(b.month) || a.code.localeCompare(b.code)));
  }

  return {
    attendance, measures, issues,
    stats: { rows, duplicates: rows - wk - attendance.length - issues.filter((x) => x.sheet === "Attendance").length, weekend: wk, days: days.length,
      from: days[0] ?? null, to: days.at(-1) ?? null, swapped: measures.filter((m) => m.swapped).length, measureRows },
  };
}
