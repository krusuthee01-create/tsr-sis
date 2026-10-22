// อ่านข้อมูลจากไฟล์โปรแกรม ปพ.5-6 (สรุปรายเทอม) ที่โรงเรียนใช้อยู่

export type Pp5Subject = { code: string; name: string; hours: number | null; area: string | null; grade: string | null };

/** "ประถมศึกษาปีที่ 1/1" → "ป.1" */
export function gradeFromPp5(label: unknown): string | null {
  const s = String(label ?? "");
  const p = s.match(/ประถมศึกษาปีที่\s*(\d)/);
  if (p) return `ป.${p[1]}`;
  const k = s.match(/อนุบาล(?:ปีที่)?\s*(\d)/);
  if (k) return `อ.${k[1]}`;
  return null;
}

/** ชีต "รายวิชา": แถว "ชั้น" บอกระดับชั้น และตารางรายวิชาเริ่มหลังแถวหัว "รหัสวิชา" */
export function parsePp5Subjects(rows: unknown[][]): Pp5Subject[] {
  const gradeRow = rows.find((r) => String(r[0] ?? "").trim() === "ชั้น");
  const grade = gradeFromPp5(gradeRow?.[1]);
  const head = rows.findIndex((r) => r.some((c) => String(c ?? "").trim() === "รหัสวิชา"));
  if (head === -1) return [];
  const cols = rows[head].map((c) => String(c ?? "").trim());
  const iCode = cols.indexOf("รหัสวิชา");
  const iName = cols.indexOf("รายวิชา");
  const iHours = cols.findIndex((c) => c.startsWith("เวลาเรียน"));
  const iArea = cols.indexOf("กลุ่มสาระการเรียนรู้");
  const out: Pp5Subject[] = [];
  for (const r of rows.slice(head + 1)) {
    const code = String(r[iCode] ?? "").trim();
    const name = String(r[iName] ?? "").trim();
    if (!code || !name) continue;
    const hours = Number(r[iHours]);
    out.push({ code, name, hours: Number.isFinite(hours) && hours > 0 ? hours : null, area: iArea >= 0 ? String(r[iArea] ?? "").trim() || null : null, grade });
  }
  return out;
}
