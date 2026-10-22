// ชิ้นส่วนหน้าจอที่ใช้ซ้ำทั้งระบบ
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost" | "success";

const BTN: Record<Variant, string> = {
  primary: "bg-navy-700 text-white hover:bg-navy-800 disabled:bg-slate-300",
  secondary: "bg-white text-ink border-[1.5px] border-slate-300 hover:bg-slate-50 disabled:text-slate-400",
  danger: "bg-red-600 text-white hover:bg-red-700 disabled:bg-slate-300",
  ghost: "text-navy-700 hover:bg-navy-50",
  success: "bg-green-600 text-white hover:bg-green-700 disabled:bg-slate-300",
};

export function btnClass(variant: Variant = "primary", size: "md" | "lg" | "sm" = "md") {
  const s = size === "lg" ? "min-h-[3.25rem] px-5 text-base" : size === "sm" ? "min-h-[2.5rem] px-3 text-sm" : "min-h-[2.875rem] px-4 text-[0.9375rem]";
  return `inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors disabled:cursor-not-allowed ${s} ${BTN[variant]}`;
}

export function Button({ variant = "primary", size = "md", className = "", ...props }: ComponentProps<"button"> & { variant?: Variant; size?: "md" | "lg" | "sm" }) {
  return <button type="button" className={`${btnClass(variant, size)} ${className}`} {...props} />;
}

export function LinkButton({ variant = "primary", size = "md", className = "", ...props }: ComponentProps<typeof Link> & { variant?: Variant; size?: "md" | "lg" | "sm" }) {
  return <Link className={`${btnClass(variant, size)} ${className}`} {...props} />;
}

export function Card({ className = "", children, ...props }: ComponentProps<"div">) {
  return (
    <div className={`print-card rounded-[var(--radius-card)] bg-white p-4 shadow-[0_2px_12px_rgba(30,58,138,0.07)] md:p-5 ${className}`} {...props}>
      {children}
    </div>
  );
}

const TONES = {
  green: "bg-green-100 text-green-800",
  gray: "bg-slate-100 text-slate-700",
  amber: "bg-amber-100 text-amber-900",
  red: "bg-red-100 text-red-800",
  blue: "bg-sky-100 text-sky-900",
  pink: "bg-pink-100 text-pink-900",
  purple: "bg-violet-100 text-violet-900",
};

export function Badge({ tone = "gray", children, className = "" }: { tone?: keyof typeof TONES; children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${TONES[tone]} ${className}`}>{children}</span>;
}

/** ช่องกรอกพร้อมป้าย คำแนะนำใต้ช่อง และข้อความผิดพลาด */
export function Field({ label, hint, error, htmlFor, children, required }: {
  label: string; hint?: ReactNode; error?: string | null; htmlFor: string; children: ReactNode; required?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-semibold">
        {label}{required && <span className="text-red-600"> *</span>}
      </label>
      {children}
      {error ? (
        <p className="text-sm font-medium text-red-700" role="alert">{error}</p>
      ) : hint ? (
        <p className="text-[0.8125rem] text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[var(--radius-card)] border-2 border-dashed border-sky-200 bg-white px-6 py-10 text-center">
      {icon}
      <p className="font-display text-lg font-semibold">{title}</p>
      {children && <div className="max-w-md text-[0.9375rem] text-muted">{children}</div>}
      {action}
    </div>
  );
}

export function Spinner({ label = "กำลังโหลด" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-muted" role="status">
      <span className="size-6 animate-spin rounded-full border-[3px] border-sky-200 border-t-navy-700" aria-hidden />
      {label}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">{children}</h2>
      {action}
    </div>
  );
}

export function Stat({ label, value, sub, tone = "gray" }: { label: string; value: ReactNode; sub?: ReactNode; tone?: keyof typeof STAT }) {
  return (
    <div className={`flex flex-col rounded-2xl px-3 py-2.5 ${STAT[tone]}`}>
      <span className="font-display text-2xl font-bold leading-tight">{value}</span>
      <span className="text-sm font-medium">{label}</span>
      {sub && <span className="text-xs opacity-80">{sub}</span>}
    </div>
  );
}

const STAT = {
  green: "bg-green-100 text-green-900",
  amber: "bg-amber-100 text-amber-900",
  blue: "bg-sky-100 text-sky-900",
  red: "bg-red-100 text-red-900",
  gray: "bg-slate-100 text-slate-800",
  orange: "bg-orange-100 text-orange-900",
};

/** แถบขั้นตอนของงานหลายขั้น */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="grid gap-2" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }} aria-label="ขั้นตอน">
      {steps.map((s, i) => {
        const n = i + 1;
        const state = n < current ? "done" : n === current ? "current" : "todo";
        return (
          <li key={s} aria-current={state === "current" ? "step" : undefined}
            className={`flex items-center gap-2 rounded-2xl px-3 py-2.5 ${state === "current" ? "bg-navy-700 text-white" : state === "done" ? "bg-green-100 text-green-900" : "border-[1.5px] border-line bg-white text-muted"}`}>
            <span className={`flex size-8 shrink-0 items-center justify-center rounded-xl font-bold ${state === "current" ? "bg-sky-300 text-sky-950" : state === "done" ? "bg-green-600 text-white" : "bg-slate-100 text-slate-700"}`}>{n}</span>
            <span className="hidden min-w-0 flex-col sm:flex">
              <span className="text-xs opacity-80">ขั้นที่ {n}/{steps.length}</span>
              <span className="truncate text-sm font-bold">{s}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** แถบเลือกแบบปุ่ม (แท็บ) ที่ใช้ลิงก์ เพื่อให้ย้อนกลับด้วยปุ่ม back ได้ */
export function LinkTabs({ tabs, current }: { tabs: { id: string; label: string; href: string }[]; current: string }) {
  return (
    <nav className="no-print -mx-1 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="หมวด">
      {tabs.map((t) => (
        <Link key={t.id} href={t.href} aria-current={t.id === current ? "page" : undefined}
          className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${t.id === current ? "bg-navy-700 text-white" : "border-[1.5px] border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
