// อ่านตารางเกณฑ์อ้างอิงการเจริญเติบโตจากไฟล์ Excel
// รูปแบบเดียวกับชีต "age" และ "ht" ของโปรแกรม ปพ.5-6: คอลัมน์ code = เพศ (1 ชาย, 2 หญิง) ตามด้วยอายุเป็นเดือน หรือส่วนสูงเป็นซม.

export type AgeRefRow = { sex: number; age_months: number; w_median: number | null; w_m2: number; w_m15: number; w_p15: number; w_p2: number; h_median: number | null; h_m2: number; h_m15: number; h_p15: number; h_p2: number };
export type HeightRefRow = { sex: number; height_cm: number; median: number | null; m2: number; m15: number; p15: number; p2: number; p3: number };

const num = (v: unknown) => (v === null || v === undefined || v === "" ? NaN : Math.round(Number(v) * 100) / 100);

function table(rows: unknown[][], required: string[]): { idx: Record<string, number>; body: unknown[][] } | string {
  const head = rows.findIndex((r) => r.some((c) => String(c ?? "").trim().toLowerCase() === "code"));
  if (head === -1) return "ไม่พบหัวคอลัมน์ code";
  const names = rows[head].map((c) => String(c ?? "").trim().toLowerCase());
  const idx: Record<string, number> = {};
  for (const r of required) {
    const i = names.indexOf(r);
    if (i === -1) return `ไม่พบคอลัมน์ ${r}`;
    idx[r] = i;
  }
  return { idx, body: rows.slice(head + 1).filter((r) => r && String(r[idx.code] ?? "").trim() !== "") };
}

function splitCode(code: unknown): [number, number] | null {
  const s = String(code ?? "").trim().replace(/\.0+$/, "");
  if (!/^[12]\d{1,3}$/.test(s)) return null;
  return [Number(s[0]), Number(s.slice(1))];
}

export function parseAgeSheet(rows: unknown[][]): { rows: AgeRefRow[]; error?: string; warnings: string[] } {
  const t = table(rows, ["code", "median_wt", "sd_2_wt", "sd_15_wt", "sd15_wt", "sd2_wt", "median_ht", "sd_2_ht", "sd_15_ht", "sd15_ht", "sd2_ht"]);
  if (typeof t === "string") return { rows: [], error: `ชีต age: ${t}`, warnings: [] };
  const out: AgeRefRow[] = [];
  const warnings: string[] = [];
  for (const r of t.body) {
    const c = splitCode(r[t.idx.code]);
    if (!c) return { rows: [], error: `ชีต age: รหัส "${String(r[t.idx.code])}" ไม่ถูกต้อง`, warnings };
    const row: AgeRefRow = { sex: c[0], age_months: c[1],
      w_median: num(r[t.idx.median_wt]), w_m2: num(r[t.idx.sd_2_wt]), w_m15: num(r[t.idx.sd_15_wt]), w_p15: num(r[t.idx.sd15_wt]), w_p2: num(r[t.idx.sd2_wt]),
      h_median: num(r[t.idx.median_ht]), h_m2: num(r[t.idx.sd_2_ht]), h_m15: num(r[t.idx.sd_15_ht]), h_p15: num(r[t.idx.sd15_ht]), h_p2: num(r[t.idx.sd2_ht]) };
    if ([row.w_m2, row.w_m15, row.w_p15, row.w_p2, row.h_m2, row.h_m15, row.h_p15, row.h_p2].some((v) => Number.isNaN(v))) {
      return { rows: [], error: `ชีต age: แถวรหัส ${String(r[t.idx.code])} มีค่าว่างหรือไม่ใช่ตัวเลข`, warnings };
    }
    if (!(row.w_m2 <= row.w_m15 && row.w_m15 <= row.w_p15 && row.w_p15 <= row.w_p2 && row.h_m2 <= row.h_m15 && row.h_m15 <= row.h_p15 && row.h_p15 <= row.h_p2)) {
      warnings.push(`ชีต age แถวรหัส ${String(r[t.idx.code])}: ค่า SD ไม่เรียงจากน้อยไปมาก (น่าจะพิมพ์ผิดในไฟล์ต้นทาง)`);
    }
    out.push(row);
  }
  return { rows: out, warnings };
}

export function parseHeightSheet(rows: unknown[][]): { rows: HeightRefRow[]; error?: string; warnings: string[] } {
  const t = table(rows, ["code", "median", "sd_2", "sd_15", "sd15", "sd2", "sd3"]);
  if (typeof t === "string") return { rows: [], error: `ชีต ht: ${t}`, warnings: [] };
  const out: HeightRefRow[] = [];
  const warnings: string[] = [];
  for (const r of t.body) {
    const c = splitCode(r[t.idx.code]);
    if (!c) return { rows: [], error: `ชีต ht: รหัส "${String(r[t.idx.code])}" ไม่ถูกต้อง`, warnings };
    const row: HeightRefRow = { sex: c[0], height_cm: c[1], median: num(r[t.idx.median]), m2: num(r[t.idx.sd_2]), m15: num(r[t.idx.sd_15]), p15: num(r[t.idx.sd15]), p2: num(r[t.idx.sd2]), p3: num(r[t.idx.sd3]) };
    if ([row.m2, row.m15, row.p15, row.p2, row.p3].some((v) => Number.isNaN(v))) return { rows: [], error: `ชีต ht: แถวรหัส ${String(r[t.idx.code])} มีค่าว่าง`, warnings };
    if (!(row.m2 <= row.m15 && row.m15 <= row.p15 && row.p15 <= row.p2 && row.p2 <= row.p3)) {
      warnings.push(`ชีต ht แถวรหัส ${String(r[t.idx.code])}: ค่า SD ไม่เรียงจากน้อยไปมาก (น่าจะพิมพ์ผิดในไฟล์ต้นทาง)`);
    }
    out.push(row);
  }
  return { rows: out, warnings };
}
