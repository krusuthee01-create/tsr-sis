// ค่าคงที่ของระบบที่ใช้ร่วมกันทั้งฝั่งหน้าเว็บและรายงาน

export const GRADE_CODES = ["อ.1", "อ.2", "อ.3", "ป.1", "ป.2", "ป.3", "ป.4", "ป.5", "ป.6"] as const;
export type GradeCode = (typeof GRADE_CODES)[number];

export function isKindergarten(grade: string): boolean {
  return grade.startsWith("อ.");
}

export function gradeSort(grade: string): number {
  const i = GRADE_CODES.indexOf(grade as GradeCode);
  return i === -1 ? 99 : i;
}

export function nextGrade(grade: string): string | null {
  const i = GRADE_CODES.indexOf(grade as GradeCode);
  if (i === -1 || i === GRADE_CODES.length - 1) return null;
  return GRADE_CODES[i + 1];
}

export function classroomName(c: { grade: string; room: number }): string {
  return `${c.grade}/${c.room}`;
}

/** สถานะการมาเรียน: 0 มา, 1 สาย, 2 ลาป่วย, 3 ลากิจ, 4 ขาด */
export const ATTENDANCE_STATUSES = [
  { value: 0, label: "มา", short: "มา", bg: "#DCFCE7", fg: "#166534", border: "#86EFAC" },
  { value: 1, label: "สาย", short: "ส", bg: "#FEF3C7", fg: "#92400E", border: "#FCD34D" },
  { value: 2, label: "ลาป่วย", short: "ป", bg: "#E0F2FE", fg: "#075985", border: "#7DD3FC" },
  { value: 3, label: "ลากิจ", short: "ก", bg: "#EDE9FE", fg: "#5B21B6", border: "#C4B5FD" },
  { value: 4, label: "ขาด", short: "ข", bg: "#FEE2E2", fg: "#991B1B", border: "#FCA5A5" },
] as const;

export function nextAttendanceStatus(v: number): number {
  return (v + 1) % ATTENDANCE_STATUSES.length;
}

export function isPresent(status: number | null | undefined): boolean {
  return status === null || status === undefined || status <= 1;
}

export const STUDENT_STATUSES: Record<string, { label: string; tone: "green" | "gray" | "amber" | "red" | "blue" }> = {
  studying: { label: "กำลังศึกษา", tone: "green" },
  moved_out: { label: "ย้ายออก", tone: "gray" },
  dropped: { label: "ลาออก", tone: "gray" },
  graduated: { label: "จบการศึกษา", tone: "blue" },
  suspended: { label: "พักการเรียน", tone: "amber" },
  long_absent: { label: "ขาดเรียนนาน (ติดตาม)", tone: "amber" },
  deceased: { label: "เสียชีวิต", tone: "red" },
};

export const ROLES: Record<string, string> = {
  admin: "ผู้ดูแลระบบ / งานทะเบียน",
  executive: "ผู้บริหาร",
  health: "งานอนามัย / โภชนาการ",
  guidance: "งานแนะแนว / ดูแลช่วยเหลือ",
  academic: "งานวิชาการ / ผลการเรียน",
};

export type RecordKind = "line" | "milk" | "brush";
export const RECORD_KINDS: { id: RecordKind; label: string }[] = [
  { id: "line", label: "เข้าแถว" },
  { id: "milk", label: "ดื่มนม" },
  { id: "brush", label: "แปรงฟัน" },
];

export function fullName(p: { prefix?: string | null; first_name: string; last_name?: string | null }, short = false): string {
  const prefix = short ? shortPrefix(p.prefix) : p.prefix ?? "";
  return `${prefix}${p.first_name} ${p.last_name ?? ""}`.trim();
}

export function shortPrefix(prefix?: string | null): string {
  if (!prefix) return "";
  const map: Record<string, string> = { "เด็กชาย": "ด.ช.", "เด็กหญิง": "ด.ญ.", "นาย": "นาย", "นางสาว": "น.ส.", "นาง": "นาง" };
  return map[prefix] ?? prefix;
}

/** เรียงเลขที่แบบที่โรงเรียนใช้ทั่วไป: ชายก่อนหญิง แล้วเรียงชื่อตามพจนานุกรมไทย */
export function compareForNumbering(
  a: { gender?: string | null; first_name: string; last_name?: string | null },
  b: { gender?: string | null; first_name: string; last_name?: string | null },
): number {
  const ga = a.gender === "ญ" ? 1 : 0;
  const gb = b.gender === "ญ" ? 1 : 0;
  if (ga !== gb) return ga - gb;
  return (a.first_name + " " + (a.last_name ?? "")).localeCompare(b.first_name + " " + (b.last_name ?? ""), "th");
}

/** ตรวจเลขประชาชน 13 หลัก (หลักสุดท้ายเป็นตัวตรวจสอบ) */
export function isValidCitizenId(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(id[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(id[12]);
}

export function formatCitizenId(id: string | null | undefined): string {
  if (!id) return "-";
  if (!/^\d{13}$/.test(id)) return id;
  return `${id[0]}-${id.slice(1, 5)}-${id.slice(5, 10)}-${id.slice(10, 12)}-${id[12]}`;
}

export function maskCitizenId(id: string | null | undefined): string {
  if (!id) return "-";
  if (!/^\d{13}$/.test(id)) return id;
  return `${id[0]}-${id.slice(1, 5)}-xxxxx-xx-${id[12]}`;
}
