"use client";

import { useState } from "react";
import { MicrosoftExcelLogo, Printer } from "@phosphor-icons/react";
import { downloadXlsx } from "@/lib/excel";
import { btnClass } from "./ui";

export function ExportButton({ filename, sheets, label = "ส่งออก Excel", variant = "secondary" }: {
  filename: string; sheets: { name: string; rows: (string | number | null)[][]; widths?: number[] }[]; label?: string; variant?: "secondary" | "primary";
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" disabled={busy} className={btnClass(variant)}
      onClick={async () => { setBusy(true); try { await downloadXlsx(filename, sheets); } finally { setBusy(false); } }}>
      <MicrosoftExcelLogo size={22} weight="duotone" /> {busy ? "กำลังสร้างไฟล์…" : label}
    </button>
  );
}

export function PrintButton({ label = "พิมพ์ / PDF" }: { label?: string }) {
  return (
    <button type="button" className={btnClass("secondary")} onClick={() => window.print()}>
      <Printer size={22} weight="duotone" /> {label}
    </button>
  );
}
