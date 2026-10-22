// สร้างตารางสำหรับส่งออก Excel

import { ATTENDANCE_STATUSES } from "./domain.ts";

export type DailyRecord = { student_id: string; date: string; status: number };
export type RosterLite = { student_id: string; number: number | null; name: string };

/**
 * ตารางเวลาเรียนรายเดือน เรียงคอลัมน์ให้ตรงกับชีต "เวลาเรียน" ของโปรแกรม ปพ.5
 * (ชื่อ-สกุล, เลขที่, วันที่ 1..สิ้นเดือน) ครูคัดลอกช่องวันที่ไปวางทั้งช่วงได้ในครั้งเดียว
 * ช่องว่าง = มาเรียน, ส = สาย, ป = ลาป่วย, ก = ลากิจ, ข = ขาด
 */
export function buildPp5Grid(students: RosterLite[], days: string[], records: DailyRecord[]): (string | number)[][] {
  const map = new Map<string, number>();
  for (const r of records) map.set(`${r.student_id}|${r.date}`, r.status);
  const header: (string | number)[] = ["ชื่อ-สกุล", "เลขที่", ...days.map((d) => Number(d.slice(8, 10))), "มา", "ขาด/ลา"];
  const rows = students.map((s) => {
    let present = 0;
    let away = 0;
    const cells = days.map((d) => {
      const st = map.get(`${s.student_id}|${d}`);
      if (st === undefined) return "";
      if (st <= 1) present += 1;
      else away += 1;
      return st === 0 ? "" : ATTENDANCE_STATUSES[st].short;
    });
    return [s.name, s.number ?? "", ...cells, present, away];
  });
  return [header, ...rows];
}

export type SummaryRow = {
  number: number | null;
  name: string;
  present: number;
  late: number;
  sick: number;
  personal: number;
  absent: number;
};

/** ร้อยละการมาเรียน (มา + สาย) เทียบกับจำนวนวันเรียน */
export function attendancePercent(row: Pick<SummaryRow, "present" | "late">, schoolDays: number): number | null {
  if (!schoolDays) return null;
  return Math.round(((row.present + row.late) / schoolDays) * 1000) / 10;
}

export function buildSummaryGrid(rows: SummaryRow[], schoolDays: number): (string | number)[][] {
  return [
    ["เลขที่", "ชื่อ-สกุล", "มา", "สาย", "ลาป่วย", "ลากิจ", "ขาด", "ร้อยละการมาเรียน"],
    ...rows.map((r) => [
      r.number ?? "", r.name, r.present, r.late, r.sick, r.personal, r.absent,
      attendancePercent(r, schoolDays) ?? "",
    ]),
  ];
}
