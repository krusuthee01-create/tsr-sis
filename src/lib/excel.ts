"use client";

/** สร้างและดาวน์โหลดไฟล์ Excel (โหลดไลบรารีเฉพาะตอนกดส่งออก เพื่อให้หน้าเว็บเบา) */
export async function downloadXlsx(filename: string, sheets: { name: string; rows: (string | number | null)[][]; widths?: number[] }[]) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    if (s.widths) ws["!cols"] = s.widths.map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  const data = XLSX.write(wb, { bookType: "xlsx", type: "array", compression: true });
  const url = URL.createObjectURL(new Blob([data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** อ่านไฟล์ Excel (.xlsx / .xlsb / .xls) เป็นตารางของชีตแรก หรือชีตที่ระบุชื่อ */
export async function readSheet(file: File, sheetName?: string): Promise<{ rows: unknown[][]; sheetNames: string[] }> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false, dense: true });
  const name = sheetName && wb.SheetNames.includes(sheetName) ? sheetName : wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false });
  return { rows, sheetNames: wb.SheetNames };
}
