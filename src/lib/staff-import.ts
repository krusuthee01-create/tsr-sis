// นำเข้ารายชื่อครูจากไฟล์ Excel (ใช้แม่แบบที่ดาวน์โหลดจากระบบ หรือไฟล์ที่มีหัวคอลัมน์ใกล้เคียง)

export type StaffRow = {
  row: number;
  prefix: string | null;
  first_name: string;
  last_name: string;
  position: string | null;
  academic_rank: string | null;
  learning_area: string | null;
  phone: string | null;
  email: string | null;
};

export type StaffIssue = { row: number; level: "error" | "warning"; message: string };

export const TEMPLATE_HEADERS = ["คำนำหน้า", "ชื่อ", "นามสกุล", "ตำแหน่ง", "วิทยฐานะ", "กลุ่มสาระ", "โทรศัพท์", "อีเมล Google"];

const ALIASES: Record<keyof Omit<StaffRow, "row">, string[]> = {
  prefix: ["คำนำหน้า", "คำนำหน้าชื่อ"],
  first_name: ["ชื่อ"],
  last_name: ["นามสกุล", "สกุล"],
  position: ["ตำแหน่ง"],
  academic_rank: ["วิทยฐานะ"],
  learning_area: ["กลุ่มสาระ", "กลุ่มสาระการเรียนรู้"],
  phone: ["โทรศัพท์", "เบอร์โทร", "เบอร์โทรศัพท์", "โทร"],
  email: ["อีเมล Google", "อีเมล", "email", "e-mail", "gmail"],
};

const PREFIXES = ["ว่าที่ร้อยตรีหญิง", "ว่าที่ร้อยตรี", "ว่าที่ ร.ต.", "นางสาว", "นาง", "นาย", "ดร.", "น.ส."];

const norm = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ").toLowerCase();

function clean(v: unknown): string | null {
  const s = String(v ?? "").trim().replace(/\s+/g, " ");
  return s && s !== "-" ? s : null;
}

/** แยก "นางสมใจ รักเรียน" เป็นคำนำหน้า ชื่อ นามสกุล */
export function splitFullName(full: string): { prefix: string | null; first_name: string; last_name: string } {
  let s = full.trim().replace(/\s+/g, " ");
  let prefix: string | null = null;
  for (const p of PREFIXES) {
    if (s.startsWith(p)) {
      prefix = p === "น.ส." ? "นางสาว" : p;
      s = s.slice(p.length).trim();
      break;
    }
  }
  const [first, ...rest] = s.split(" ");
  return { prefix, first_name: first ?? "", last_name: rest.join(" ") };
}

/** sheet = ทุกแถวของชีต (แถวหัวคอลัมน์อยู่แถวใดก็ได้ใน 10 แถวแรก) */
export function parseStaffSheet(sheet: unknown[][]): { rows: StaffRow[]; issues: StaffIssue[]; missingHeaders: string[] } {
  const headerIndex = sheet.slice(0, 10).findIndex((r) => r.some((c) => ["ชื่อ", "ชื่อ-สกุล", "ชื่อ - สกุล"].includes(String(c ?? "").trim())));
  if (headerIndex === -1) return { rows: [], issues: [], missingHeaders: ["ชื่อ"] };
  const headers = sheet[headerIndex].map(norm);
  const col = (key: keyof typeof ALIASES) => headers.findIndex((h) => ALIASES[key].some((a) => norm(a) === h));
  const idx = Object.fromEntries((Object.keys(ALIASES) as (keyof typeof ALIASES)[]).map((k) => [k, col(k)])) as Record<keyof typeof ALIASES, number>;
  const fullIdx = headers.findIndex((h) => h === "ชื่อ-สกุล" || h === "ชื่อ - สกุล");

  const rows: StaffRow[] = [];
  const issues: StaffIssue[] = [];
  const emails = new Map<string, number>();
  for (let i = headerIndex + 1; i < sheet.length; i++) {
    const r = sheet[i] ?? [];
    if (r.every((c) => clean(c) === null)) continue;
    const rowNo = i + 1;
    const get = (k: keyof typeof ALIASES) => (idx[k] >= 0 ? clean(r[idx[k]]) : null);

    let prefix = get("prefix");
    let first = get("first_name");
    let last = get("last_name");
    if (!first && fullIdx >= 0 && clean(r[fullIdx])) {
      const s = splitFullName(clean(r[fullIdx])!);
      prefix ??= s.prefix;
      first = s.first_name;
      last ??= s.last_name;
    }
    if (!first) {
      issues.push({ row: rowNo, level: "error", message: "ไม่มีชื่อ — ข้ามแถวนี้" });
      continue;
    }
    if (prefix === "น.ส.") prefix = "นางสาว";

    let email = get("email")?.toLowerCase() ?? null;
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      issues.push({ row: rowNo, level: "warning", message: `อีเมล "${email}" รูปแบบไม่ถูกต้อง — นำเข้าโดยไม่ใส่อีเมล` });
      email = null;
    }
    if (email && emails.has(email)) {
      issues.push({ row: rowNo, level: "error", message: `อีเมลซ้ำกับแถว ${emails.get(email)} — ข้ามแถวนี้` });
      continue;
    }
    if (email) emails.set(email, rowNo);

    let phone = get("phone");
    if (phone && phone.replace(/\D/g, "").length === 9 && !phone.startsWith("0")) phone = "0" + phone; // Excel ตัดเลข 0 นำหน้า

    rows.push({
      row: rowNo, prefix, first_name: first, last_name: last ?? "",
      position: get("position"), academic_rank: get("academic_rank"), learning_area: get("learning_area"), phone, email,
    });
  }
  return { rows, issues, missingHeaders: [] };
}

export type ExistingStaff = { id: string; prefix: string | null; first_name: string; last_name: string; position: string | null; academic_rank: string | null; learning_area: string | null; phone: string | null; email: string | null };

export type StaffChange =
  | { kind: "new"; row: StaffRow }
  | { kind: "update"; row: StaffRow; existing: ExistingStaff; fields: string[] }
  | { kind: "same"; row: StaffRow; existing: ExistingStaff };

const FIELDS: [keyof ExistingStaff & keyof StaffRow, string][] = [
  ["prefix", "คำนำหน้า"], ["first_name", "ชื่อ"], ["last_name", "นามสกุล"], ["position", "ตำแหน่ง"],
  ["academic_rank", "วิทยฐานะ"], ["learning_area", "กลุ่มสาระ"], ["phone", "โทรศัพท์"], ["email", "อีเมล"],
];

/** จับคู่กับทะเบียนครูเดิมด้วยอีเมล หรือชื่อ-นามสกุล — ช่องว่างในไฟล์ไม่ลบข้อมูลเดิม */
export function diffStaff(rows: StaffRow[], existing: ExistingStaff[]): StaffChange[] {
  const byEmail = new Map(existing.filter((e) => e.email).map((e) => [e.email!.toLowerCase(), e]));
  const byName = new Map(existing.map((e) => [norm(`${e.first_name} ${e.last_name}`), e]));
  return rows.map((row) => {
    const ex = (row.email && byEmail.get(row.email)) || byName.get(norm(`${row.first_name} ${row.last_name}`));
    if (!ex) return { kind: "new", row };
    const fields = FIELDS.filter(([k]) => row[k] !== null && row[k] !== "" && String(row[k]) !== String(ex[k] ?? "")).map(([, label]) => label);
    return fields.length ? { kind: "update", row, existing: ex, fields } : { kind: "same", row, existing: ex };
  });
}

/** ค่าที่จะบันทึก (ไม่ส่งช่องที่ว่างในไฟล์ เพื่อไม่ทับข้อมูลเดิม) */
export function toStaffRecord(row: StaffRow): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k] of FIELDS) {
    const v = row[k];
    if (v !== null && v !== "") out[k] = String(v);
  }
  return out;
}
