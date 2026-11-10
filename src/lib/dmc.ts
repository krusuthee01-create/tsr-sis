// แปลงไฟล์ "รายชื่อนักเรียนในโรงเรียน" ที่ส่งออกจาก DMC ให้เป็นข้อมูลพร้อมนำเข้า
// รองรับ 2 รูปแบบ:
//  - แบบเต็ม 91 คอลัมน์ มีชื่อคอลัมน์ซ้ำ (จำนวนพี่ชาย/น้องชาย/น้องสาว) จึงเติม " (2)" ให้ชุดที่สอง
//  - แบบย่อ 39 คอลัมน์ ไม่มีหัว "เลขประจำตัวประชาชน" (เลข 13 หลักอยู่ในคอลัมน์ที่ชื่อ "เลขประจำตัวนักเรียน")
//    และไม่มีเบอร์โทร ชื่ออังกฤษ ที่อยู่ทะเบียนบ้าน — ช่องที่ไฟล์ไม่มีจะไม่ถูกส่งไปทับข้อมูลเดิม

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
  format: "full" | "short";
  /** ฟิลด์ที่ไฟล์นี้มีข้อมูล (ฟิลด์อื่นคงค่าเดิมในระบบ) */
  present: (keyof DmcRow)[];
};

export const REQUIRED_HEADERS = ["เลขประจำตัวประชาชน", "ชั้น", "ห้อง", "ชื่อ", "นามสกุล"];

// ฟิลด์ → คอลัมน์ที่ต้องมีอย่างน้อย 1 คอลัมน์ ฟิลด์จึงนับว่าไฟล์มีข้อมูล
const FIELD_SOURCES: Partial<Record<keyof DmcRow, string[]>> = {
  student_code: ["รหัสนักเรียน"],
  first_name_en: ["ชื่อ (อังกฤษ)"],
  last_name_en: ["นามสกุล (อังกฤษ)"],
  birth_date: ["วันเกิด"],
  blood_group: ["หมู่โลหิต"],
  nationality: ["สัญชาติ"],
  religion: ["ศาสนา"],
  father_name: ["ชื่อบิดา"],
  father_phone: ["หมายเลขโทรศัพท์ของบิดา"],
  mother_name: ["ชื่อมารดา"],
  mother_phone: ["หมายเลขโทรศัพท์ของมารดา"],
  guardian_name: ["ชื่อผู้ปกครอง"],
  guardian_relation: ["ความเกี่ยวข้องของผู้ปกครองกับนักเรียน"],
  guardian_phone: ["หมายเลขโทรศัพท์ของผู้ปกครอง"],
  address_registered: ["ตำบล (ทะเบียนบ้าน)"],
  address_current: ["ตำบล (ที่อยู่ปัจจุบัน)"],
  weight: ["น้ำหนัก"],
  height: ["ส่วนสูง"],
};
const ALWAYS: (keyof DmcRow)[] = ["citizen_id", "prefix", "first_name", "last_name", "gender", "grade", "room", "raw"];

const isCitizenLike = (v: unknown) => /^(\d{13}|G\d{12})$/i.test(String(v ?? "").replace(/[\s-]/g, ""));

/** หาคอลัมน์เลขประจำตัวประชาชน: ใช้ชื่อหัวคอลัมน์ก่อน ไม่พบจึงดูจากค่า (คอลัมน์ "เลขประจำตัว…" ที่ค่าเป็นเลข 13 หลัก) */
function findCitizenColumn(headers: string[], body: unknown[][]): string | null {
  if (headers.includes("เลขประจำตัวประชาชน")) return "เลขประจำตัวประชาชน";
  const sample = body.filter((r) => r.some((c) => c !== null && String(c).trim() !== "")).slice(0, 50);
  for (const [i, h] of headers.entries()) {
    if (!h.startsWith("เลขประจำตัว") && !h.startsWith("เลขบัตรประชาชน")) continue;
    const vals = sample.map((r) => r[i]).filter((v) => v !== null && String(v).trim() !== "");
    if (vals.length && vals.filter(isCitizenLike).length / vals.length >= 0.9) return h;
  }
  return null;
}

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
  const has = (row: unknown[], name: string) => row.some((c) => String(c ?? "").trim() === name);
  const headerIndex = sheet.findIndex((row) => ["ชั้น", "ห้อง", "ชื่อ", "นามสกุล"].every((n) => has(row, n)));
  if (headerIndex === -1) {
    return { rows: [], issues: [], headers: [], missingHeaders: REQUIRED_HEADERS, schoolCode: null, format: "full", present: [] };
  }
  const headers = uniqueHeaders(sheet[headerIndex]);
  const citizenCol = findCitizenColumn(headers, sheet.slice(headerIndex + 1));
  const missingHeaders = REQUIRED_HEADERS.filter((h) => (h === "เลขประจำตัวประชาชน" ? !citizenCol : !headers.includes(h)));
  const format = headers.includes("เลขประจำตัวประชาชน") ? "full" : "short";
  if (missingHeaders.length) return { rows: [], issues: [], headers, missingHeaders, schoolCode: null, format, present: [] };
  // แบบย่อ: รหัสนักเรียนอยู่ในคอลัมน์ "เลขประจำตัวนักเรียน" อีกคอลัมน์ (ไม่ใช่คอลัมน์เลข 13 หลัก)
  const codeCol = headers.includes("รหัสนักเรียน") ? "รหัสนักเรียน" : headers.find((h) => h.startsWith("เลขประจำตัวนักเรียน") && h !== citizenCol) ?? null;
  // ชื่อคอลัมน์แบบย่อ → ชื่อแบบเต็ม
  const ALIAS: Record<string, string> = { "กลุ่มเลือด": "หมู่โลหิต", "บ้านเลขที่": "เลขที่บ้าน (ที่อยู่ปัจจุบัน)", "หมู่": "หมู่ (ที่อยู่ปัจจุบัน)",
    "ถนน/ซอย": "ถนน (ที่อยู่ปัจจุบัน)", "ตำบล": "ตำบล (ที่อยู่ปัจจุบัน)", "อำเภอ": "อำเภอ (ที่อยู่ปัจจุบัน)", "จังหวัด": "จังหวัด (ที่อยู่ปัจจุบัน)" };
  const known = new Set([...headers, ...headers.map((h) => ALIAS[h]).filter(Boolean), ...(codeCol ? ["รหัสนักเรียน"] : [])]);
  const present = [...ALWAYS, ...(Object.keys(FIELD_SOURCES) as (keyof DmcRow)[]).filter((k) => FIELD_SOURCES[k]!.some((h) => known.has(h)))];

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
    const value = (h: string) => r[h];
    const lookup: Record<string, unknown> = { ...r };
    for (const [from, to] of Object.entries(ALIAS)) if (from in r && !(to in r)) lookup[to] = r[from];
    lookup["เลขประจำตัวประชาชน"] = value(citizenCol!);
    if (codeCol) lookup["รหัสนักเรียน"] = value(codeCol);
    schoolCode ??= clean(lookup["รหัสโรงเรียน"]);

    const citizenId = (clean(lookup["เลขประจำตัวประชาชน"]) ?? "").replace(/[\s-]/g, "");
    const firstName = clean(lookup["ชื่อ"]);
    const lastName = clean(lookup["นามสกุล"]) ?? "";
    const grade = clean(lookup["ชั้น"]) ?? "";
    const room = Number(clean(lookup["ห้อง"]));

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
      issues.push({ row: rowNo, level: "error", message: `ห้อง "${String(lookup["ห้อง"])}" ไม่ถูกต้อง — ข้ามแถวนี้` });
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

    const genderRaw = clean(lookup["เพศ"]);
    const birth = parseDmcDate(lookup["วันเกิด"]);
    if (lookup["วันเกิด"] && !birth) {
      issues.push({ row: rowNo, level: "warning", message: `อ่านวันเกิด "${String(lookup["วันเกิด"])}" ไม่ได้` });
    }

    rows.push({
      citizen_id: citizenId,
      student_code: clean(lookup["รหัสนักเรียน"]),
      prefix: clean(lookup["คำนำหน้าชื่อ"]),
      first_name: firstName,
      last_name: lastName,
      first_name_en: clean(lookup["ชื่อ (อังกฤษ)"]),
      last_name_en: clean(lookup["นามสกุล (อังกฤษ)"]),
      gender: genderRaw === "ช" || genderRaw === "ญ" ? genderRaw : null,
      birth_date: birth,
      blood_group: clean(lookup["หมู่โลหิต"]),
      nationality: clean(lookup["สัญชาติ"]),
      religion: clean(lookup["ศาสนา"]),
      father_name: joinName(lookup["คำนำหน้าชื่อบิดา"], lookup["ชื่อบิดา"], lookup["นามสกุลบิดา"]),
      father_phone: cleanPhone(lookup["หมายเลขโทรศัพท์ของบิดา"]),
      mother_name: joinName(lookup["คำนำหน้าชื่อมารดา"], lookup["ชื่อมารดา"], lookup["นามสกุลมารดา"]),
      mother_phone: cleanPhone(lookup["หมายเลขโทรศัพท์ของมารดา"]),
      guardian_name: joinName(lookup["คำนำหน้าชื่อผู้ปกครอง"], lookup["ชื่อผู้ปกครอง"], lookup["นามสกุลผู้ปกครอง"]),
      guardian_relation: clean(lookup["ความเกี่ยวข้องของผู้ปกครองกับนักเรียน"]),
      guardian_phone: cleanPhone(lookup["หมายเลขโทรศัพท์ของผู้ปกครอง"]),
      address_registered: address(lookup, "ทะเบียนบ้าน"),
      address_current: address(lookup, "ที่อยู่ปัจจุบัน"),
      weight: num(lookup["น้ำหนัก"]),
      height: num(lookup["ส่วนสูง"]),
      grade,
      room,
      raw: r,
    });
  }
  return { rows, issues, headers, missingHeaders: [], schoolCode, format, present };
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
export function diffDmc(rows: DmcRow[], existing: ExistingStudent[], present?: (keyof DmcRow)[]): DmcChange[] {
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
      if (present && !present.includes(f.key)) continue;
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
export function toImportPayload(row: DmcRow, present?: (keyof DmcRow)[]) {
  const full = { ...row, room: String(row.room), weight: row.weight, height: row.height };
  if (!present) return full;
  // ส่งเฉพาะฟิลด์ที่ไฟล์มี ฟิลด์ที่ไม่ส่ง ระบบคงค่าเดิมไว้
  return Object.fromEntries(Object.entries(full).filter(([k]) => present.includes(k as keyof DmcRow)));
}
