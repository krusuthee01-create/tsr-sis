// อ่านผลการเรียนจากไฟล์โปรแกรม ปพ.5-6 (ไฟล์ .xlsb รายห้อง) — ทำงานบนเครื่องผู้ใช้ ไม่ส่งไฟล์ขึ้นเซิร์ฟเวอร์
import { gradeFromPp5, parsePp5Subjects, type Pp5Subject } from "./pp5.ts";

export const GRADES = ["4", "3.5", "3", "2.5", "2", "1.5", "1", "0", "ร", "มส"] as const;
export const RESULT_LEVELS = ["ไม่ผ่าน", "ผ่าน", "ดี", "ดีเยี่ยม"] as const;
export type AssessmentKind = "trait" | "rtw" | "values" | "competency" | "activity";
export const ASSESSMENT_LABELS: Record<AssessmentKind, string> = {
  trait: "คุณลักษณะอันพึงประสงค์",
  rtw: "การอ่าน คิดวิเคราะห์ และเขียน",
  values: "ค่านิยมหลัก 12 ประการ",
  competency: "สมรรถนะสำคัญของผู้เรียน",
  activity: "กิจกรรมพัฒนาผู้เรียน",
};
export const TRAIT_ITEMS = ["รักชาติ ศาสน์ กษัตริย์", "ซื่อสัตย์สุจริต", "มีวินัย", "ใฝ่เรียนรู้", "อยู่อย่างพอเพียง", "มุ่งมั่นในการทำงาน", "รักความเป็นไทย", "มีจิตสาธารณะ"];
export const TERM_LABEL: Record<number, string> = { 1: "ภาคเรียนที่ 1", 2: "ภาคเรียนที่ 2", 0: "ทั้งปี" };

export type Pp5Result = { code: string; term: 0 | 1 | 2; mid: number | null; final: number | null; total: number | null; percent: number | null; grade: string };
export type Pp5Assessment = { term: 0 | 1 | 2; kind: AssessmentKind; items: (number | null)[] | Record<string, string>; result: string | null };
export type Pp5Student = { number: number; student_code: string; name: string; citizen_id: string; results: Pp5Result[]; assessments: Pp5Assessment[] };
export type Pp5File = { grade: string | null; room: number | null; year: number | null; term: number | null; subjects: Pp5Subject[]; students: Pp5Student[]; warnings: string[] };

type Rows = unknown[][];
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || str(v) === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** ระดับผลการเรียน: ตัวเลข 0–4 (ขั้นละ 0.5) หรือ ร / มส */
export function normalizeGrade(v: unknown): string | null {
  const s = str(v).replace(/\s/g, "");
  if (!s) return null;
  if (s === "ร" || s === "มส") return s;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 4 || (n * 2) % 1 !== 0) return null;
  return String(n);
}

/** "ประถมศึกษาปีที่ 6/2" → { grade: "ป.6", room: 2 } */
export function classFromPp5(label: unknown): { grade: string | null; room: number | null } {
  const m = str(label).match(/\/\s*(\d+)/);
  return { grade: gradeFromPp5(label), room: m ? Number(m[1]) : null };
}

// ตำแหน่งคอลัมน์ในชีต "วิชาที่ n" (นับจาก 0): ภาค 1 = AB–AF, ภาค 2 = BF–BJ, ทั้งปี = BS–BU
const TERM_COLS = { 1: [27, 28, 29, 30, 31], 2: [57, 58, 59, 60, 61] } as const;
const YEAR_COLS = [70, 71, 72] as const;

function subjectSheet(rows: Rows, code: string, byNumber: Map<number, Pp5Student>, warnings: string[], sheetName: string) {
  if (str(rows[3]?.[28]) !== "สอบปลายภาค" || str(rows[3]?.[58]) !== "สอบปลายภาค" || str(rows[4]?.[70]) !== "รวมรายปี") {
    warnings.push(`${sheetName}: รูปแบบตารางไม่ตรงกับโปรแกรม ปพ.5 ที่รองรับ จึงข้ามวิชานี้`);
    return;
  }
  const head = str(rows[1]?.[2]);
  if (!head.includes(code)) warnings.push(`${sheetName}: หัวตาราง "${head}" ไม่ตรงกับรหัสวิชา ${code} ในชีตรายวิชา`);
  for (const r of rows.slice(6)) {
    const no = num(r[0]);
    const st = no === null ? undefined : byNumber.get(no);
    if (!st) continue;
    for (const term of [1, 2] as const) {
      const [m, f, t, p, g] = TERM_COLS[term];
      const grade = normalizeGrade(r[g]);
      // ช่องระหว่างภาค/ปลายภาคว่าง = ยังไม่ได้กรอก (โปรแกรมใส่ 0 ในช่องรวมไว้ล่วงหน้า)
      const entered = num(r[m]) !== null || num(r[f]) !== null || grade === "ร" || grade === "มส";
      if (!entered || grade === null) continue;
      st.results.push({ code, term, mid: num(r[m]), final: num(r[f]), total: num(r[t]), percent: num(r[p]), grade });
    }
    const [yt, yp, yg] = YEAR_COLS;
    const yearGrade = normalizeGrade(r[yg]);
    if (yearGrade !== null && st.results.some((x) => x.code === code && x.term === 2))
      st.results.push({ code, term: 0, mid: null, final: null, total: num(r[yt]), percent: num(r[yp]), grade: yearGrade });
  }
}

function marked(r: unknown[], from: number): string | null {
  for (let i = 0; i < 4; i++) if (str(r[from + i])) return RESULT_LEVELS[i];
  return null;
}
function scores(r: unknown[], from: number, n: number) {
  return Array.from({ length: n }, (_, i) => num(r[from + i]));
}

/** ชีตคุณลักษณะ/ค่านิยม/กิจกรรม: ข้อมูลเริ่มแถวที่ 5 คอลัมน์ B = เลขที่ */
function assessmentSheet(rows: Rows, kind: "trait" | "values" | "activity", term: 0 | 1 | 2, byNumber: Map<number, Pp5Student>) {
  const actNames = kind === "activity" ? [2, 4, 6, 8].map((c) => str(rows[1]?.[c]).replace(/\s+/g, " ")) : [];
  for (const r of rows.slice(4)) {
    const no = num(r[1]);
    const st = no === null ? undefined : byNumber.get(no);
    if (!st) continue;
    const push = (k: AssessmentKind, items: Pp5Assessment["items"], result: string | null) => {
      // ต้องมีคะแนนรายข้อ (ช่องผลประเมินในโปรแกรมเป็นสูตร ขึ้น "ไม่ผ่าน" เองเมื่อยังไม่กรอก)
      const hasItems = Array.isArray(items) ? items.some((x) => x !== null) : Object.keys(items).length > 0;
      if (hasItems) st.assessments.push({ term, kind: k, items, result });
    };
    if (kind === "trait") {
      push("trait", scores(r, 2, 8), marked(r, 12));
      push("rtw", scores(r, 16, 5), marked(r, 21));
    } else if (kind === "values") {
      push("values", scores(r, 2, 12), marked(r, 14));
      push("competency", scores(r, 18, 5), marked(r, 23));
    } else {
      const items: Record<string, string> = {};
      [2, 4, 6, 8].forEach((c, i) => {
        if (str(r[c + 1])) items[actNames[i] || `กิจกรรม ${i + 1}`] = "ผ่าน";
        else if (str(r[c])) items[actNames[i] || `กิจกรรม ${i + 1}`] = "ไม่ผ่าน";
      });
      const vals = Object.values(items);
      push("activity", items, vals.length ? (vals.includes("ไม่ผ่าน") ? "ไม่ผ่าน" : "ผ่าน") : null);
    }
  }
}

/** sheet(name) คืนแถวของชีต (หรือ null ถ้าไม่มีชีตนั้น) */
export function parsePp5Workbook(sheet: (name: string) => Rows | null): Pp5File {
  const warnings: string[] = [];
  const subjRows = sheet("รายวิชา");
  const nameRows = sheet("ชื่อนักเรียน");
  if (!subjRows || !nameRows) throw new Error("ไม่พบชีต \"รายวิชา\" หรือ \"ชื่อนักเรียน\" — กรุณาเลือกไฟล์โปรแกรม ปพ.5-6 (.xlsb) ของห้องเรียน");
  const label = subjRows.find((r) => str(r[0]) === "ชั้น")?.[1];
  const { grade, room } = classFromPp5(label);
  const year = num(subjRows.find((r) => str(r[0]) === "ปีการศึกษา")?.[1]);
  const term = num(subjRows.find((r) => str(r[0]) === "ภาคเรียนที่")?.[1]);
  const subjects = parsePp5Subjects(subjRows);

  const students: Pp5Student[] = [];
  for (const r of nameRows.slice(2)) {
    const number = num(r[0]);
    const citizen = str(r[3]).replace(/\D/g, "");
    const name = str(r[2]);
    if (number === null || !name) continue;
    if (citizen.length !== 13) { warnings.push(`เลขที่ ${number}: ไม่มีเลขประจำตัวประชาชน 13 หลัก จึงนำเข้าไม่ได้`); continue; }
    students.push({ number, student_code: str(r[1]), name, citizen_id: citizen, results: [], assessments: [] });
  }
  const byNumber = new Map(students.map((s) => [s.number, s]));

  // รายวิชาลำดับที่ n อยู่ในชีต "วิชาที่ n"
  const subjectIndex = subjRows.filter((r) => num(r[0]) !== null && str(r[1])).map((r) => ({ i: num(r[0])!, code: str(r[1]) }));
  for (const { i, code } of subjectIndex) {
    const rows = sheet(`วิชาที่ ${i}`);
    if (rows) subjectSheet(rows, code, byNumber, warnings, `วิชาที่ ${i}`);
  }
  for (const [suffix, t] of [["1", 1], ["2", 2], ["รวม", 0]] as const) {
    const a = sheet(`คุณลักษณะ ${suffix}`); if (a) assessmentSheet(a, "trait", t, byNumber);
    const v = sheet(`ค่านิยม ${suffix}`); if (v) assessmentSheet(v, "values", t, byNumber);
    const g = sheet(`กิจกรรม ${suffix}`); if (g) assessmentSheet(g, "activity", t, byNumber);
  }
  // ผลทั้งปีนับเมื่อกรอกภาคเรียนที่ 2 ของด้านนั้นแล้วเท่านั้น
  for (const st of students) st.assessments = st.assessments.filter((a) => a.term !== 0 || st.assessments.some((b) => b.term === 2 && b.kind === a.kind));
  return { grade, room, year, term, subjects, students, warnings };
}

/** ชื่อชีตที่ต้องอ่าน (ให้อ่านเฉพาะชีตที่ใช้ ไฟล์จะเปิดเร็วขึ้น) */
export const PP5_SHEETS = ["รายวิชา", "ชื่อนักเรียน", ...Array.from({ length: 20 }, (_, i) => `วิชาที่ ${i + 1}`),
  ...["1", "2", "รวม"].flatMap((s) => [`คุณลักษณะ ${s}`, `ค่านิยม ${s}`, `กิจกรรม ${s}`])];

/** เกรดเฉลี่ยถ่วงน้ำหนักด้วยชั่วโมง (ร/มส ไม่นำมาคิด ตามโปรแกรม ปพ.5) */
export function gpa(rows: { grade: string; hours: number | null }[]): number | null {
  let w = 0, s = 0;
  for (const r of rows) {
    const g = Number(r.grade);
    if (!Number.isFinite(g) || r.grade === "" || !r.hours) continue;
    w += r.hours; s += g * r.hours;
  }
  return w ? Math.floor((s / w) * 100 + 1e-9) / 100 : null; // ตัดทศนิยม 2 ตำแหน่งแบบโปรแกรม ปพ.5
}
