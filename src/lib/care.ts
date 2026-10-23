// ระบบดูแลช่วยเหลือนักเรียน: ป้ายระดับ ด้านคัดกรอง และการคิดคะแนน SDQ
// (คะแนนที่บันทึกจริงคิดที่ฐานข้อมูลด้วยสูตรเดียวกัน — ฟังก์ชันนี้ใช้แสดงผลทันทีขณะกรอก)

export const LEVELS: Record<number, { label: string; tone: "green" | "amber" | "red"; bg: string; fg: string }> = {
  1: { label: "ปกติ", tone: "green", bg: "#DCFCE7", fg: "#166534" },
  2: { label: "เสี่ยง", tone: "amber", bg: "#FEF3C7", fg: "#92400E" },
  3: { label: "มีปัญหา", tone: "red", bg: "#FEE2E2", fg: "#991B1B" },
};

export const DOMAINS = [
  { key: "learning", label: "การเรียน", hint: "เสนอจากร้อยละการมาเรียน (ผลการเรียนจะเพิ่มในเฟส 3)" },
  { key: "health", label: "สุขภาพ", hint: "เสนอจากภาวะโภชนาการครั้งล่าสุด" },
  { key: "economic", label: "เศรษฐกิจ", hint: "เสนอจากรายได้ต่อคนต่อเดือนจากการเยี่ยมบ้าน" },
  { key: "safety", label: "ความปลอดภัย", hint: "เสนอจากความเสี่ยงที่พบตอนเยี่ยมบ้าน" },
  { key: "behavior", label: "พฤติกรรม/อารมณ์", hint: "เสนอจาก SDQ ฉบับครูครั้งล่าสุด" },
] as const;
export type DomainKey = (typeof DOMAINS)[number]["key"];

export const INFORMANTS: Record<string, string> = { teacher: "ครูประเมิน", parent: "ผู้ปกครองประเมิน", self: "นักเรียนประเมินตนเอง" };

export const SDQ_SCALES = [
  { key: "emotional", label: "ด้านอารมณ์", items: [3, 8, 13, 16, 24] },
  { key: "conduct", label: "ด้านความประพฤติ/เกเร", items: [5, 7, 12, 18, 22] },
  { key: "hyperactivity", label: "ด้านพฤติกรรมอยู่ไม่นิ่ง/สมาธิสั้น", items: [2, 10, 15, 21, 25] },
  { key: "peer", label: "ด้านความสัมพันธ์กับเพื่อน", items: [6, 11, 14, 19, 23] },
  { key: "prosocial", label: "ด้านสัมพันธภาพทางสังคม (จุดแข็ง)", items: [1, 4, 9, 17, 20] },
] as const;
export const SDQ_REVERSED = [7, 11, 14, 21, 25];

export type SdqCutoffs = Record<string, Record<string, number[]>>;

function band(v: number, cut?: number[]): number | null {
  if (!cut || !cut.length) return null;
  if (v <= cut[0]) return 1;
  if (cut.length > 1 && v <= cut[1]) return 2;
  return 3;
}

/** answers = คำตอบตามช่องที่ทำเครื่องหมายในแบบประเมิน (0 ไม่จริง, 1 ค่อนข้างจริง, 2 จริงแน่นอน) ข้อ 1–25 */
export function sdqScore(answers: (number | null)[], cutoffs?: Record<string, number[]>) {
  if (answers.length !== 25 || answers.some((a) => a === null || a < 0 || a > 2)) return null;
  const r = answers.map((a, i) => (SDQ_REVERSED.includes(i + 1) ? 2 - (a as number) : (a as number)));
  const sum = (items: readonly number[]) => items.reduce((s, n) => s + r[n - 1], 0);
  const scores = Object.fromEntries(SDQ_SCALES.map((s) => [s.key, sum(s.items)])) as Record<(typeof SDQ_SCALES)[number]["key"], number>;
  const total = scores.emotional + scores.conduct + scores.hyperactivity + scores.peer;
  const levels: Record<string, number | null> = {
    total: band(total, cutoffs?.total),
    emotional: band(scores.emotional, cutoffs?.emotional),
    conduct: band(scores.conduct, cutoffs?.conduct),
    hyperactivity: band(scores.hyperactivity, cutoffs?.hyperactivity),
    peer: band(scores.peer, cutoffs?.peer),
    prosocial: cutoffs?.prosocial?.length ? (scores.prosocial <= cutoffs.prosocial[0] ? 3 : 1) : null,
  };
  return { ...scores, total, levels };
}

export const EQ_DOMAINS = [
  { key: "good", label: "ดี" },
  { key: "smart", label: "เก่ง" },
  { key: "happy", label: "สุข" },
] as const;
export const EQ_LEVELS: Record<number, { label: string; bg: string; fg: string }> = {
  0: { label: "ต่ำกว่าปกติ", bg: "#FEE2E2", fg: "#991B1B" },
  1: { label: "ปกติ", bg: "#DCFCE7", fg: "#166534" },
  2: { label: "สูงกว่าปกติ", bg: "#E0F2FE", fg: "#075985" },
};

export const INTERVENTION_STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  ongoing: { label: "กำลังดำเนินการ", bg: "#FEF3C7", fg: "#92400E" },
  improved: { label: "ดีขึ้น", bg: "#DCFCE7", fg: "#166534" },
  referred_internal: { label: "ส่งต่อภายใน", bg: "#E0F2FE", fg: "#075985" },
  referred_external: { label: "ส่งต่อภายนอก", bg: "#EDE9FE", fg: "#5B21B6" },
  closed: { label: "ปิดกรณี", bg: "#F1F5F9", fg: "#334155" },
};
export const INTERVENTION_DOMAINS: Record<string, string> = {
  learning: "การเรียน", health: "สุขภาพ", economic: "เศรษฐกิจ", safety: "ความปลอดภัย",
  behavior: "พฤติกรรม/อารมณ์", attendance: "การมาเรียน", talent: "ส่งเสริมความสามารถ", other: "อื่น ๆ",
};

/** หัวข้อแบบบันทึกการเยี่ยมบ้าน (ตามแนวแบบบันทึกของ สพฐ.) */
export const VISIT_OPTIONS = {
  living_with: ["บิดาและมารดา", "บิดา", "มารดา", "ปู่ย่า/ตายาย", "ญาติ", "ผู้อื่น"],
  house_owner: ["บ้านของตนเอง", "บ้านเช่า", "อาศัยผู้อื่น", "หอพัก/ที่พักของนายจ้าง"],
  house_condition: ["มั่นคง ถาวร", "ชำรุดบางส่วน", "ทรุดโทรม ไม่ปลอดภัย"],
  utilities: ["มีไฟฟ้า", "มีน้ำประปา/น้ำสะอาด", "มีห้องน้ำ", "มีมุมอ่านหนังสือ", "มีอินเทอร์เน็ต"],
  travel: ["เดิน", "จักรยาน", "ผู้ปกครองรับส่ง", "รถโรงเรียน/รถรับจ้าง", "รถโดยสารประจำทาง"],
  risks: ["สมาชิกในครอบครัวใช้สารเสพติด", "ความรุนแรงในครอบครัว", "ถูกทอดทิ้ง/อยู่ลำพังบ่อย", "การพนันในครอบครัว", "สภาพแวดล้อมรอบบ้านไม่ปลอดภัย", "ทำงานหารายได้ช่วยครอบครัว"],
  needs: ["ทุนการศึกษา", "อุปกรณ์การเรียน/เครื่องแบบ", "อาหาร", "ที่อยู่อาศัย", "การรักษาพยาบาล", "การดูแลด้านจิตใจ"],
} as const;

export type VisitData = {
  living_with?: string; parents_status?: string; guardian_name?: string; guardian_phone?: string; guardian_job?: string;
  house_owner?: string; house_condition?: string; utilities?: string[]; address?: string;
  travel?: string; distance_km?: number | null; travel_minutes?: number | null;
  risks?: string[]; needs?: string[]; home_behavior?: string; parent_comment?: string; teacher_summary?: string;
};

/** ย่อรูปให้ด้านยาวไม่เกิน maxSide และไฟล์ไม่เกินประมาณ targetKB (ลดคุณภาพทีละขั้น) */
export function compressionPlan(width: number, height: number, maxSide = 1280): { w: number; h: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { w: Math.round(width * scale), h: Math.round(height * scale) };
}

/** แปลผล EQ รายด้านจากช่วงปกติ [ต่ำสุด, สูงสุด] — สูตรเดียวกับ eq_level ในฐานข้อมูล */
export function eqLevel(v: number | null, range?: number[]): number | null {
  if (v === null || !range || range.length < 2) return null;
  return v < range[0] ? 0 : v > range[1] ? 2 : 1;
}
