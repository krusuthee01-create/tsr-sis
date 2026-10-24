// พัฒนาการเด็กปฐมวัย: อ่านจากไฟล์สมุดบันทึกพัฒนาการ (Google Sheets ที่ดาวน์โหลดเป็น .xlsx)
// 4 ด้าน 33 ตัวบ่งชี้ คะแนน 1–3 (3 ดี, 2 พอใช้, 1 ควรส่งเสริม) แยกภาคเรียนที่ 1 และ 2

export const KG_DOMAINS = [
  { key: "physical", label: "ด้านสุขภาวะทางกาย", from: 0, count: 4 },
  { key: "emotional", label: "ด้านอารมณ์ จิตใจ และสังคม", from: 4, count: 8 },
  { key: "civic", label: "ด้านความเป็นพลเมืองและความเป็นไทย", from: 12, count: 6 },
  { key: "intellectual", label: "ด้านสติปัญญา", from: 18, count: 15 },
] as const;
export type KgDomain = (typeof KG_DOMAINS)[number]["key"];
export const KG_INDICATORS = 33;
export const KG_LEVELS: Record<number, { label: string; bg: string; fg: string }> = {
  3: { label: "ดี", bg: "#DCFCE7", fg: "#166534" },
  2: { label: "พอใช้", bg: "#FEF3C7", fg: "#92400E" },
  1: { label: "ควรส่งเสริม", bg: "#FEE2E2", fg: "#991B1B" },
};

/** ระดับจากค่าเฉลี่ย ตามสูตรในสมุดบันทึกพัฒนาการ: < 1.5 = 1, < 2.5 = 2, อื่น ๆ = 3 */
export function kgLevel(avg: number | null): number | null {
  if (avg === null || !Number.isFinite(avg)) return null;
  return avg < 1.5 ? 1 : avg < 2.5 ? 2 : 3;
}

/** ระดับรายด้านจากคะแนนตัวบ่งชี้ (รวมได้หลายภาคเรียน — ทั้งปีใช้ค่าเฉลี่ยของทั้ง 2 ภาค) */
export function kgDomainLevels(...terms: (number | null)[][]): Record<KgDomain, number | null> {
  return Object.fromEntries(KG_DOMAINS.map((d) => {
    const vals = terms.flatMap((t) => t.slice(d.from, d.from + d.count)).filter((v): v is number => v !== null);
    return [d.key, vals.length ? kgLevel(vals.reduce((a, b) => a + b, 0) / vals.length) : null];
  })) as Record<KgDomain, number | null>;
}

export type KgStudent = { number: number | null; name: string; t1: (number | null)[]; t2: (number | null)[] };
export type KgFile = { grade: string | null; room: number | null; year: number | null; indicators: string[]; students: KgStudent[]; warnings: string[] };

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const score = (v: unknown): number | null => {
  const n = Number(str(v));
  return str(v) !== "" && [1, 2, 3].includes(n) ? n : null;
};

export const KG_SHEETS = ["นำเข้าคะแนน", "ส่วนกรอกคะแนน", "นำเข้าข้อมูลทั่วไป "];

/** ไฟล์นี้เป็นสมุดบันทึกพัฒนาการหรือไม่ */
export function isKgWorkbook(sheet: (name: string) => unknown[][] | null) {
  return !!(sheet("นำเข้าคะแนน") ?? sheet("ส่วนกรอกคะแนน"));
}

export function parseKgWorkbook(sheet: (name: string) => unknown[][] | null): KgFile {
  const rows = sheet("นำเข้าคะแนน") ?? sheet("ส่วนกรอกคะแนน");
  if (!rows) throw new Error("ไม่พบชีต \"นำเข้าคะแนน\" หรือ \"ส่วนกรอกคะแนน\" ในไฟล์สมุดบันทึกพัฒนาการ");
  const warnings: string[] = [];
  const head = rows.findIndex((r) => str(r[1]) === "เลขที่");
  if (head === -1) throw new Error("ไม่พบแถวหัวตาราง \"เลขที่\" ในชีตคะแนน");
  // ตัวบ่งชี้อยู่คอลัมน์ P เป็นต้นไป คอลัมน์ละ 2 ช่อง (เทอม 1, เทอม 2)
  const indicators = Array.from({ length: KG_INDICATORS }, (_, i) => str(rows[head]?.[15 + i * 2]).replace(/\s+/g, " "));
  if (!indicators[0] || !indicators[KG_INDICATORS - 1]) throw new Error("รูปแบบตารางคะแนนไม่ตรงกับสมุดบันทึกพัฒนาการ (ต้องมีตัวบ่งชี้ 33 ข้อ เริ่มที่คอลัมน์ P)");
  const students: KgStudent[] = [];
  // ข้อมูลนักเรียน 50 แถวถัดจากหัวตาราง (ใต้ตารางมีแถวช่วยคำนวณของไฟล์ ไม่ใช่ข้อมูล)
  for (const r of rows.slice(head + 5, head + 55)) {
    const name = str(r[2]);
    if (!name || /^\d+$/.test(name)) continue;
    const n = Number(str(r[1]));
    const t1 = Array.from({ length: KG_INDICATORS }, (_, i) => score(r[15 + i * 2]));
    const t2 = Array.from({ length: KG_INDICATORS }, (_, i) => score(r[16 + i * 2]));
    const bad = Array.from({ length: KG_INDICATORS * 2 }, (_, i) => r[15 + i]).filter((v) => str(v) !== "" && score(v) === null).length;
    if (bad) warnings.push(`${name}: มีคะแนนที่ไม่ใช่ 1–3 จำนวน ${bad} ช่อง (ข้ามช่องเหล่านั้น)`);
    students.push({ number: Number.isFinite(n) && str(r[1]) !== "" ? n : null, name, t1, t2 });
  }

  // ชั้น ห้อง ปีการศึกษา จากชีตข้อมูลทั่วไป (ไฟล์ส่วนกรอกคะแนนอาจไม่มี — ผู้ใช้เลือกห้องเอง)
  let grade: string | null = null, room: number | null = null, year: number | null = null;
  const info = sheet("นำเข้าข้อมูลทั่วไป ");
  for (const r of info ?? []) {
    if (str(r[0]) === "ปีการศึกษา" && Number(r[1]) > 2500) year = Number(r[1]);
    for (const c of r) {
      const m = str(c).match(/อนุบาล(?:ปีที่)?\s*(\d)\s*\/\s*(\d+)/);
      if (m && !grade) { grade = `อ.${m[1]}`; room = Number(m[2]); }
    }
  }
  return { grade, room, year, indicators, students, warnings };
}
