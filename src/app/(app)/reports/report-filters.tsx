"use client";

import { useRouter } from "next/navigation";
import { THAI_MONTHS } from "@/lib/thai-date";

/** เลือกห้องและเดือน (เปลี่ยนแล้วโหลดรายงานใหม่ทันที) */
export function ReportFilters({ classrooms, classroom, month }: { classrooms: { id: number; label: string }[]; classroom: number; month: string }) {
  const router = useRouter();
  const go = (c: number, m: string) => router.push(`/reports?c=${c}&m=${m}`);
  const [y, mo] = month.split("-").map(Number);
  // 12 เดือนย้อนหลังจากเดือนปัจจุบัน
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
  if (!months.includes(month)) months.push(month);
  return (
    <div className="grid flex-1 gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-sm font-semibold">ห้อง
        <select className="field-input" value={classroom} onChange={(e) => go(Number(e.target.value), month)}>
          {classrooms.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold">เดือน
        <select className="field-input" value={month} onChange={(e) => go(classroom, e.target.value)}>
          {months.map((m) => { const [yy, mm] = m.split("-").map(Number); return <option key={m} value={m}>{THAI_MONTHS[mm - 1]} {yy + 543}</option>; })}
        </select>
      </label>
      <span className="sr-only">{THAI_MONTHS[mo - 1]} {y + 543}</span>
    </div>
  );
}
