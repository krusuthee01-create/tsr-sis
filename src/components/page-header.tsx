import Link from "next/link";
import { CaretLeft } from "@phosphor-icons/react/dist/ssr";
import { HelpButton } from "./help";

export const MODULE_COLORS = {
  home: "#1E3A8A",
  attendance: "#16A34A",
  nutrition: "#EA580C",
  registry: "#0284C7",
  staff: "#0369A1",
  reports: "#7C3AED",
  system: "#334155",
  manual: "#DB2777",
} as const;

/** หัวหน้าจอสีประจำโมดูล พร้อมปุ่มย้อนกลับและปุ่ม ? */
export function PageHeader({ title, subtitle, module = "home", help, back, actions }: {
  title: string;
  subtitle?: React.ReactNode;
  module?: keyof typeof MODULE_COLORS;
  help?: string;
  back?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="no-print relative mb-4 overflow-hidden rounded-[1.5rem] px-4 py-4 text-white md:px-6 md:py-5" style={{ background: MODULE_COLORS[module] }}>
      <div className="pointer-events-none absolute -right-14 -top-16 size-48 rounded-full bg-white/15" aria-hidden />
      <div className="relative flex flex-wrap items-center gap-3">
        {back && (
          <Link href={back} aria-label="ย้อนกลับ" className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white/20 hover:bg-white/30">
            <CaretLeft size={24} weight="bold" />
          </Link>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold md:text-2xl">{title}</h1>
          {subtitle && <div className="mt-0.5 text-sm text-white/85">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        {help && <HelpButton topic={help} />}
      </div>
    </div>
  );
}

/** หัวรายงานสำหรับตอนพิมพ์ */
export function PrintHeader({ title, school, lines }: { title: string; school: string; lines?: string[] }) {
  return (
    <div className="print-only mb-4 text-center">
      <p style={{ fontSize: "18pt", fontWeight: 700 }}>{title}</p>
      <p style={{ fontSize: "16pt" }}>{school}</p>
      {lines?.map((l) => <p key={l} style={{ fontSize: "14pt" }}>{l}</p>)}
    </div>
  );
}

export function PrintSignatures({ roles }: { roles: { label: string; name?: string | null }[] }) {
  return (
    <div className="print-only mt-10">
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${roles.length}, 1fr)`, gap: "2rem", textAlign: "center", fontSize: "14pt" }}>
        {roles.map((r) => (
          <div key={r.label}>
            <p>ลงชื่อ ......................................................</p>
            <p>({r.name || "......................................................"})</p>
            <p>{r.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
