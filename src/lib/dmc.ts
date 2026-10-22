// แปลงไฟล์ "รายชื่อนักเรียนในโรงเรียน" ที่ส่งออกจาก DMC ให้เป็นข้อมูลพร้อมนำเข้า
// ไฟล์จริงมี 91 คอลัมน์ และมีชื่อคอลัมน์ซ้ำ (จำนวนพี่ชาย/น้องชาย/น้องสาว) จึงเติม " (2)" ให้ชุดที่สอง

import { GRADE_CODES, isValidCitizenId } from "./domain.ts";
import { parseDmcDate } from "./thai-date.ts";

export type DmcRow = {
  citizen_id: string;
  student_code: string | null;
  prefix: string | null;
  first_name: string;
  last_name: string;
  first_name_en: string | null;
  last_name_en: string | null;
  gender: "ช" | "ญ" | null;
  birth_date: string | null;
  blood_group: string | null;
  nationality: string | null;
  religion: string | null;
  father_name: string | null;
  father_phone: string | null;
  mother_name: string | null;
  mother_phone: string | null;
  guardian_name: string | null;
  guardian_relation: string | null;
  guardian_phone: string | null;
  address_registered: string | null;
  address_current: string | null;
  weight: number | null;
  height: number | null;
  grade: string;
  room: number;
  raw: Record<string, unknown>;
};

export type DmcIssue = { row: number; level: "error" | "warning"; message: string };

export type DmcParseResult = {
  rows: DmcRow[];
  issues: DmcIssue[];
  headers: string[];
  missingHeaders: string[];
  schoolCode: string | null;
};

export const REQUIRED_HEADERS = ["เลขประจำตัวประชาชน", "ชั้น", "ห้อง", "ชื่อ", "นามสกุล"];

/** ทำให้ชื่อคอลัมน์ไม่ซ้ำ: คอลัมน์ที่ซ้ำครั้งที่ 2 จะเป็น "ชื่อ (2)" */
export function uniqueHeaders(headers: unknown[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((h) => {
    const name = String(h ?? "").trim();
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return n === 1 ? name : `${name} (${n})`;
  });
}

function clean(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === "" || s === "-") return null;
  return s;
}

function cleanPhone(v: unknown): string | null {
  const s = clean(v);
  if (!s) return null;
  const digits = s.replace(/\D/g, "");
  if (digits.length < 9) return null;
  return s;
}

function num(v: unknown): number | null {
  const s = clean(v);
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function joinName(...parts: unknown[]): string | null {
  const s = parts.map(clean).filter(Boolean).join(" ").trim();
  return s || null;
}

function address(r: Record<string, unknown>, suffix: string): string | null {
  const g = (k: string) => clean(r[`${k} (${suffix})`]);
  const parts = [
    g("เลขที่บ้าน") && `${g("เลขที่บ้าน")}`,
    g("หมู่") && `หมู่ ${g("หมู่")}`,
    g("ถนน") && `ถ.${g("ถนน")}`,
    g("ตำบล") && `ต.${g("ตำบล")}`,
    g("อำเภอ") && `อ.${g("อำเภอ")}`,
    g("จังหวัด") && `จ.${g("จังหวัด")}`,
    g("รหัสไปรษณีย์"),
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

/** sheet = แถวทั้งหมดของชีตแรก (แถวแรกเป็นหัวคอลัมน์) */
export function parseDmcSheet(sheet: unknown[][]): DmcParseResult {
  const issues: DmcIssue[] = [];
  const headerIndex = sheet.findIndex((row) => row.some((c) => String(c ?? "").trim() === "เลขประจำตัวประชาชน"));
  if (headerIndex === -1) {
    return { rows: [], issues: [], headers: [], missingHeaders: REQUIRED_HEADERS, schoolCode: null };
  }
  const headers = uniqueHeaders(sheet[headerIndex]);
  const missingHeaders = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
  if (missingHeaders.length) return { rows: [], issues: [], headers, missingHeaders, schoolCode: null };

  const rows: DmcRow[] = [];
  const seenIds = new Map<string, number>();
  let schoolCode: string | null = null;

  for (let i = headerIndex + 1; i < sheet.length; i++) {
    const line = sheet[i];
    if (!line || line.every((c) => c === null || c === undefined || String(c).trim() === "")) continue;
    const rowNo = i + 1; // เลขแถวตามที่เห็นใน Excel
    const r: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      if (h) r[h] = line[idx] ?? null;
    });
    schoolCode ??= clean(r["รหัสโรงเรียน"]);

    const citizenId = (clean(r["เลขประจำตัวประชาชน"]) ?? "").replace(/[\s-]/g, "");
    const firstName = clean(r["ชื่อ"]);
    const lastName = clean(r["นามสกุล"]) ?? "";
    const grade = clean(r["ชั้น"]) ?? "";
    const room = Number(clean(r["ห้อง"]));

    if (!citizenId) {
      issues.push({ row: rowNo, level: "error", message: "ไม่มีเลขประจำตัวประชาชน — ข้ามแถวนี้" });
      continue;
    }
    if (!firstName) {
      issues.push({ row: rowNo, level: "error", message: "ไม่มีชื่อนักเรียน — ข้ามแถวนี้" });
      continue;
    }
    if (!GRADE_CODES.includes(grade as (typeof GRADE_CODES)[number])) {
      issues.push({ row: rowNo, level: "error", message: `ชั้น "${grade}" ไม่อยู่ในช่วง อ.1–ป.6 — ข้ามแถวนี้` });
      continue;
    }
    if (!Number.isInteger(room) || room < 1 || room > 20) {
      issues.push({ row: rowNo, level: "error", message: `ห้อง "${String(r["ห้อง"])}" ไม่ถูกต้อง — ข้ามแถวนี้` });
      continue;
    }
    if (seenIds.has(citizenId)) {
      issues.push({ row: rowNo, level: "error", message: `เลขประชาชนซ้ำกับแถว ${seenIds.get(citizenId)} — ข้ามแถวนี้` });
      continue;
    }
    seenIds.set(citizenId, rowNo);
    if (/^\d{13}$/.test(citizenId) && !isValidCitizenId(citizenId)) {
      issues.push({ row: rowNo, level: "warning", message: `เลขประชาชน ${citizenId} หลักตรวจสอบไม่ถูกต้อง (นำเข้าได้ แต่ควรตรวจที่ DMC)` });
    }

    const genderRaw = clean(r["เพศ"]);
    const birth = parseDmcDate(r["วันเกิด"]);
    if (r["วันเกิด"] && !birth) {
      issues.push({ row: rowNo, level: "warning", message: `อ่านวันเกิด "${String(r["วันเกิด"])}" ไม่ได้` });
    }

    rows.push({
      citizen_id: citizenId,
      student_code: clean(r["รหัสนักเรียน"]),
      prefix: clean(r["คำนำหน้าชื่อ"]),
      first_name: firstName,
      last_name: lastName,
      first_name_en: clean(r["ชื่อ (อังกฤษ)"]),
      last_name_en: clean(r["นามสกุล (อังกฤษ)"]),
      gender: genderRaw === "ช" || genderRaw === "ญ" ? genderRaw : null,
      birth_date: birth,
      blood_group: clean(r["หมู่โลหิต"]),
      nationality: clean(r["สัญชาติ"]),
      religion: clean(r["ศาสนา"]),
      father_name: joinName(r["คำนำหน้าชื่อบิดา"], r["ชื่อบิดา"], r["นามสกุลบิดา"]),
      father_phone: cleanPhone(r["หมายเลขโทรศัพท์ของบิดา"]),
      mother_name: joinName(r["คำนำหน้าชื่อมารดา"], r["ชื่อมารดา"], r["นามสกุลมารดา"]),
      mother_phone: cleanPhone(r["หมายเลขโทรศัพท์ของมารดา"]),
      guardian_name: joinName(r["คำนำหน้าชื่อผู้ปกครอง"], r["ชื่อผู้ปกครอง"], r["นามสกุลผู้ปกครอง"]),
      guardian_relation: clean(r["ความเกี่ยวข้องของผู้ปกครองกับนักเรียน"]),
      guardian_phone: cleanPhone(r["หมายเลขโทรศัพท์ของผู้ปกครอง"]),
      address_registered: address(r, "ทะเบียนบ้าน"),
      address_current: address(r, "ที่อยู่ปัจจุบัน"),
      weight: num(r["น้ำหนัก"]),
      height: num(r["ส่วนสูง"]),
      grade,
      room,
      raw: r,
    });
  }
  return { rows, issues, headers, missingHeaders: [], schoolCode };
}

/** ฟิลด์ที่ใช้เทียบว่าข้อมูลเปลี่ยนหรือไม่ (ชื่อภาษาไทยไว้แสดงในหน้าตรวจผล) */
export const COMPARE_FIELDS: { key: keyof DmcRow; label: string }[] = [
  { key: "student_code", label: "รหัสนักเรียน" },
  { key: "prefix", label: "คำนำหน้า" },
  { key: "first_name", label: "ชื่อ" },
  { key: "last_name", label: "นามสกุล" },
  { key: "birth_date", label: "วันเกิด" },
  { key: "gender", label: "เพศ" },
  { key: "guardian_name", label: "ผู้ปกครอง" },
  { key: "guardian_phone", label: "เบอร์ผู้ปกครอง" },
  { key: "father_phone", label: "เบอร์บิดา" },
  { key: "mother_phone", label: "เบอร์มารดา" },
  { key: "address_current", label: "ที่อยู่ปัจจุบัน" },
];

export type ExistingStudent = Partial<Record<keyof DmcRow, unknown>> & {
  id: string;
  citizen_id: string;
  classroom?: string | null; // เช่น "ป.3/1" ของปีที่นำเข้า
  status?: string;
  first_name: string;
  last_name: string;
  prefix?: string | null;
};

export type DmcChange =
  | { kind: "new"; row: DmcRow }
  | { kind: "changed"; row: DmcRow; existing: ExistingStudent; fields: { label: string; from: string; to: string }[] }
  | { kind: "same"; row: DmcRow; existing: ExistingStudent }
  | { kind: "missing"; existing: ExistingStudent };

/** เทียบข้อมูลในไฟล์กับข้อมูลในระบบ เพื่อแสดงตัวอย่างก่อนยืนยันนำเข้า */
export function diffDmc(rows: DmcRow[], existing: ExistingStudent[]): DmcChange[] {
  const byId = new Map(existing.map((e) => [e.citizen_id, e]));
  const inFile = new Set(rows.map((r) => r.citizen_id));
  const out: DmcChange[] = [];
  for (const row of rows) {
    const ex = byId.get(row.citizen_id);
    if (!ex) {
      out.push({ kind: "new", row });
      continue;
    }
    const fields: { label: string; from: string; to: string }[] = [];
    for (const f of COMPARE_FIELDS) {
      const a = ex[f.key] ?? null;
      const b = row[f.key] ?? null;
      if (String(a ?? "") !== String(b ?? "")) fields.push({ label: f.label, from: String(a ?? "-"), to: String(b ?? "-") });
    }
    const room = `${row.grade}/${row.room}`;
    if ((ex.classroom ?? null) !== room) fields.push({ label: "ห้อง", from: ex.classroom ?? "-", to: room });
    out.push(fields.length ? { kind: "changed", row, existing: ex, fields } : { kind: "same", row, existing: ex });
  }
  for (const ex of existing) {
    if (ex.status === "studying" && !inFile.has(ex.citizen_id)) out.push({ kind: "missing", existing: ex });
  }
  return out;
}

/** ข้อมูลที่ส่งให้ RPC import_dmc */
export function toImportPayload(row: DmcRow) {
  return { ...row, room: String(row.room), weight: row.weight, height: row.height };
}
