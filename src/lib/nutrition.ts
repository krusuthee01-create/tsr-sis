// ภาวะโภชนาการ: ป้ายผล สี และการแปลผล (ใช้แสดงผลทันทีขณะกรอก — ค่าที่บันทึกจริงคำนวณที่ฐานข้อมูลด้วยตารางเดียวกัน)

export type Tone = "red" | "amber" | "green" | "blue" | "purple";
type Label = { label: string; short: string; tone: Tone };

export const WFA: Record<number, Label> = {
  1: { label: "น้ำหนักน้อยกว่าเกณฑ์", short: "น้อยกว่าเกณฑ์", tone: "red" },
  2: { label: "น้ำหนักค่อนข้างน้อย", short: "ค่อนข้างน้อย", tone: "amber" },
  3: { label: "น้ำหนักตามเกณฑ์", short: "ตามเกณฑ์", tone: "green" },
  4: { label: "น้ำหนักค่อนข้างมาก", short: "ค่อนข้างมาก", tone: "amber" },
  5: { label: "น้ำหนักมากกว่าเกณฑ์", short: "มากกว่าเกณฑ์", tone: "red" },
};
export const HFA: Record<number, Label> = {
  1: { label: "เตี้ย", short: "เตี้ย", tone: "red" },
  2: { label: "ค่อนข้างเตี้ย", short: "ค่อนข้างเตี้ย", tone: "amber" },
  3: { label: "ส่วนสูงตามเกณฑ์", short: "ตามเกณฑ์", tone: "green" },
  4: { label: "ค่อนข้างสูง", short: "ค่อนข้างสูง", tone: "blue" },
  5: { label: "สูง", short: "สูง", tone: "blue" },
};
export const WFH: Record<number, Label> = {
  1: { label: "ผอม", short: "ผอม", tone: "red" },
  2: { label: "ค่อนข้างผอม", short: "ค่อนข้างผอม", tone: "amber" },
  3: { label: "สมส่วน", short: "สมส่วน", tone: "green" },
  4: { label: "ท้วม", short: "ท้วม", tone: "amber" },
  5: { label: "เริ่มอ้วน", short: "เริ่มอ้วน", tone: "red" },
  6: { label: "อ้วน", short: "อ้วน", tone: "purple" },
};

export const TONE_STYLE: Record<Tone, { bg: string; fg: string }> = {
  red: { bg: "#FEE2E2", fg: "#991B1B" },
  amber: { bg: "#FEF3C7", fg: "#92400E" },
  green: { bg: "#DCFCE7", fg: "#166534" },
  blue: { bg: "#E0F2FE", fg: "#075985" },
  purple: { bg: "#EDE9FE", fg: "#5B21B6" },
};

export type AgeRef = { sex: number; age_months: number; w_m2: number; w_m15: number; w_p15: number; w_p2: number; h_m2: number; h_m15: number; h_p15: number; h_p2: number };
export type HeightRef = { sex: number; height_cm: number; m2: number; m15: number; p15: number; p2: number; p3: number };

/** อายุเป็นเดือนเต็ม (เหมือนฟังก์ชัน age_in_months ในฐานข้อมูล) */
export function ageInMonths(birthISO: string | null | undefined, atISO: string): number | null {
  if (!birthISO) return null;
  const [by, bm, bd] = birthISO.split("-").map(Number);
  const [ay, am, ad] = atISO.split("-").map(Number);
  const m = (ay - by) * 12 + (am - bm) - (ad < bd ? 1 : 0);
  return m < 0 ? null : m;
}

function band5(v: number | null, m2: number, m15: number, p15: number, p2: number): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  if (v < m2) return 1;
  if (v < m15) return 2;
  if (v <= p15) return 3;
  if (v <= p2) return 4;
  return 5;
}

/** แปลผลตามกติกาเดียวกับ classify_growth ในฐานข้อมูล */
export function classify(
  sex: 1 | 2 | null, ageMonths: number | null, weight: number | null, height: number | null,
  ageRef: Map<string, AgeRef>, heightRef: Map<string, HeightRef>,
): { wfa: number | null; hfa: number | null; wfh: number | null } {
  if (!sex) return { wfa: null, hfa: null, wfh: null };
  const a = ageMonths === null ? undefined : ageRef.get(`${sex}:${ageMonths}`);
  const wfa = a ? band5(weight, a.w_m2, a.w_m15, a.w_p15, a.w_p2) : null;
  const hfa = a ? band5(height, a.h_m2, a.h_m15, a.h_p15, a.h_p2) : null;
  let wfh: number | null = null;
  if (weight !== null && height !== null) {
    const h = heightRef.get(`${sex}:${Math.round(height)}`);
    if (h) wfh = weight < h.m2 ? 1 : weight < h.m15 ? 2 : weight <= h.p15 ? 3 : weight <= h.p2 ? 4 : weight <= h.p3 ? 5 : 6;
  }
  return { wfa, hfa, wfh };
}

export function refMaps(age: AgeRef[], height: HeightRef[]) {
  return {
    ageRef: new Map(age.map((r) => [`${r.sex}:${r.age_months}`, r])),
    heightRef: new Map(height.map((r) => [`${r.sex}:${r.height_cm}`, r])),
  };
}

/** แปลงข้อความที่ครูพิมพ์เป็นตัวเลข (รองรับจุลภาคแทนจุด) — ว่าง = null, ผิดรูปแบบ = NaN */
export function parseMeasure(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (t === "") return null;
  return /^\d{1,3}(\.\d{1,2})?$/.test(t) ? Number(t) : NaN;
}

/** ข้อความเตือนเมื่อค่าที่กรอกดูผิดปกติ (ยังบันทึกได้ ยกเว้นค่าที่เป็นไปไม่ได้) */
export function measureWarnings(
  w: number | null, h: number | null,
  prev: { weight: number | null; height: number | null } | undefined,
  alertKg: number,
): { level: "error" | "warning"; text: string }[] {
  const out: { level: "error" | "warning"; text: string }[] = [];
  if (Number.isNaN(w)) out.push({ level: "error", text: "น้ำหนักต้องเป็นตัวเลข เช่น 18.5" });
  if (Number.isNaN(h)) out.push({ level: "error", text: "ส่วนสูงต้องเป็นตัวเลข เช่น 112" });
  if (w !== null && !Number.isNaN(w) && (w < 5 || w > 150)) out.push({ level: "error", text: "น้ำหนักต้องอยู่ระหว่าง 5–150 กก." });
  if (h !== null && !Number.isNaN(h) && (h < 50 || h > 210)) out.push({ level: "error", text: "ส่วนสูงต้องอยู่ระหว่าง 50–210 ซม." });
  if (out.length) return out;
  if (h !== null && w !== null && w > h) out.push({ level: "warning", text: "น้ำหนักมากกว่าส่วนสูง — สลับช่องหรือไม่?" });
  if (prev?.weight != null && w !== null && Math.abs(w - prev.weight) > alertKg) {
    out.push({ level: "warning", text: `น้ำหนักต่างจากครั้งก่อน ${Math.abs(w - prev.weight).toFixed(1)} กก. (ครั้งก่อน ${prev.weight})` });
  }
  if (prev?.height != null && h !== null) {
    if (h < prev.height - 1) out.push({ level: "warning", text: `ส่วนสูงลดลงจากครั้งก่อน (${prev.height} ซม.)` });
    else if (h > prev.height + 8) out.push({ level: "warning", text: `ส่วนสูงเพิ่มมากผิดปกติจากครั้งก่อน (${prev.height} ซม.)` });
  }
  return out;
}

/** ชื่อรอบรายเดือนในปีการศึกษา: เดือนที่อยู่ในภาคเรียน */
export function monthlyRounds(terms: { start_date: string; end_date: string }[]): { name: string; start_date: string; end_date: string }[] {
  const MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const out: { name: string; start_date: string; end_date: string }[] = [];
  for (const t of [...terms].sort((a, b) => a.start_date.localeCompare(b.start_date))) {
    let [y, m] = t.start_date.split("-").map(Number);
    const [ey, em] = t.end_date.split("-").map(Number);
    while (y < ey || (y === ey && m <= em)) {
      const first = `${y}-${String(m).padStart(2, "0")}-01`;
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const last = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      const start = first < t.start_date ? t.start_date : first;
      const end = last > t.end_date ? t.end_date : last;
      const name = `${MONTHS[m - 1]} ${y + 543}`;
      if (!out.some((r) => r.name === name)) out.push({ name, start_date: start, end_date: end });
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
  }
  return out;
}
