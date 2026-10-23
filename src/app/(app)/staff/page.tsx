import Link from "next/link";
import { CaretRight } from "@phosphor-icons/react/dist/ssr";
import { can, getProfile, supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { Badge, Card, SectionTitle } from "@/components/ui";
import { ExportButton } from "@/components/export-button";
import { ROLES } from "@/lib/domain";
import { AddStaff, ApproveButtons } from "./staff-tools";
import { StaffImport } from "./staff-import";

export const metadata = { title: "ทะเบียนครู" };

type Staff = { id: string; prefix: string | null; first_name: string; last_name: string; position: string | null; academic_rank: string | null; learning_area: string | null; phone: string | null; email: string | null; username: string | null; roles: string[]; approved: boolean; active: boolean; user_id: string | null };

export default async function StaffPage() {
  const sb = await supabaseServer();
  const profile = await getProfile();
  const isAdmin = can(profile, "admin");
  const { data } = await sb.from("staff").select("id, prefix, first_name, last_name, position, academic_rank, learning_area, phone, email, username, roles, approved, active, user_id").order("first_name");
  const all = (data ?? []) as Staff[];
  const pending = all.filter((s) => !s.approved && s.active);
  const active = all.filter((s) => s.approved && s.active);
  const inactive = all.filter((s) => !s.active);
  const name = (s: Staff) => `${s.prefix ?? ""}${s.first_name} ${s.last_name}`.trim();

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="ทะเบียนครูและบุคลากร" module="staff" help="staff" subtitle={`${active.length} คน`}
        actions={isAdmin ? <><StaffImport /><AddStaff /></> : undefined} />

      {isAdmin && pending.length > 0 && (
        <Card className="mb-4 border-2 border-amber-300 bg-amber-50">
          <SectionTitle>รออนุมัติ ({pending.length})</SectionTitle>
          <ul className="flex flex-col gap-2">
            {pending.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-white px-3 py-2.5">
                <span className="min-w-0 flex-1"><span className="block font-semibold">{name(s)}</span><span className="text-sm text-muted">{s.email}</span></span>
                <ApproveButtons staffId={s.id} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-0 md:p-0">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <p className="font-semibold">ครูและบุคลากร</p>
          <ExportButton filename="ทะเบียนครู" sheets={[{ name: "ทะเบียนครู", widths: [28, 16, 16, 18, 14, 28],
            rows: [["ชื่อ-สกุล", "ตำแหน่ง", "วิทยฐานะ", "กลุ่มสาระ", "โทรศัพท์", "อีเมล"], ...active.map((s) => [name(s), s.position ?? "", s.academic_rank ?? "", s.learning_area ?? "", s.phone ?? "", s.email ?? ""])] }]} />
        </div>
        <ul className="divide-y divide-slate-100">
          {active.map((s) => (
            <li key={s.id}>
              <Link href={`/staff/${s.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-sky-50">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sky-100 font-display font-semibold text-sky-900">{s.first_name.slice(0, 1)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{name(s)}</span>
                  <span className="block truncate text-sm text-muted">{[s.position, s.academic_rank, s.learning_area].filter(Boolean).join(" · ") || "-"}</span>
                </span>
                <span className="hidden flex-wrap justify-end gap-1 sm:flex">
                  {s.roles.map((r) => <Badge key={r} tone={r === "admin" ? "purple" : "blue"}>{ROLES[r]?.split(" /")[0]}</Badge>)}
                  {!s.user_id && <Badge tone="amber">ยังไม่มีบัญชีเข้าระบบ</Badge>}
                </span>
                <CaretRight size={20} className="text-slate-400" />
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      {isAdmin && inactive.length > 0 && (
        <details className="mt-4 rounded-2xl bg-white p-4">
          <summary className="cursor-pointer font-semibold">ปิดการใช้งานแล้ว ({inactive.length})</summary>
          <ul className="mt-2 flex flex-col gap-1">{inactive.map((s) => <li key={s.id}><Link className="text-navy-700 underline" href={`/staff/${s.id}`}>{name(s)}</Link></li>)}</ul>
        </details>
      )}
    </div>
  );
}
