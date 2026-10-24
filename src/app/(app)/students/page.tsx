import Link from "next/link";
import { UploadSimple, ArrowFatLinesUp, MagnifyingGlass, CaretRight, ListNumbers } from "@phosphor-icons/react/dist/ssr";
import { can, getProfile, getSettings, supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { Badge, Card, EmptyState, LinkButton } from "@/components/ui";
import { ExportButton } from "@/components/export-button";
import { classroomName, fullName, gradeSort, STUDENT_STATUSES } from "@/lib/domain";

export const metadata = { title: "ทะเบียนนักเรียน" };

type Row = { student_id: string; number: number | null; prefix: string | null; first_name: string; last_name: string; nickname: string | null; gender: string | null; student_code: string | null; status: string; classroom?: string };

export default async function StudentsPage({ searchParams }: { searchParams: Promise<{ c?: string; q?: string; y?: string }> }) {
  const sp = await searchParams;
  const sb = await supabaseServer();
  const [profile, settings] = await Promise.all([getProfile(), getSettings()]);
  const isAdmin = can(profile, "admin");
  const fullAccess = can(profile, "admin", "executive", "guidance", "health");
  const year = Number(sp.y) || settings?.current_year || 0;

  const [{ data: classData }, { data: years }, { data: teach }] = await Promise.all([
    sb.from("classrooms").select("id, grade, room").eq("year", year),
    sb.from("academic_years").select("year").order("year", { ascending: false }),
    fullAccess ? Promise.resolve({ data: [] }) : sb.from("teaching_assignments").select("classroom_id").eq("staff_id", profile?.id ?? ""),
  ]);
  const allowed = new Set<number>([...(profile?.homerooms ?? []).map((h) => h.classroom_id), ...((teach ?? []) as { classroom_id: number }[]).map((t) => t.classroom_id)]);
  const classrooms = ((classData ?? []) as { id: number; grade: string; room: number }[])
    .filter((c) => fullAccess || allowed.has(c.id))
    .sort((a, b) => gradeSort(a.grade) - gradeSort(b.grade) || a.room - b.room);

  const q = sp.q?.trim() ?? "";
  let rows: Row[] = [];
  let current: { id: number; grade: string; room: number } | undefined;
  let searchError: string | null = null;

  if (q && can(profile, "admin", "executive", "guidance")) {
    const like = `%${q.replace(/[%_,()]/g, "")}%`;
    const digits = q.replace(/\D/g, "");
    let query = sb.from("students").select("id, prefix, first_name, last_name, nickname, gender, student_code, status, enrollments(year, number, classrooms(grade, room))")
      .or([`first_name.ilike.${like}`, `last_name.ilike.${like}`, `nickname.ilike.${like}`, digits ? `student_code.eq.${digits}` : null, digits.length === 13 ? `citizen_id.eq.${digits}` : null].filter(Boolean).join(","))
      .limit(60);
    query = query.order("first_name");
    const { data, error } = await query;
    if (error) searchError = error.message;
    rows = ((data ?? []) as unknown as (Omit<Row, "student_id" | "number"> & { id: string; enrollments: { year: number; number: number | null; classrooms: { grade: string; room: number } }[] })[]).map((s) => {
      const e = s.enrollments.find((x) => x.year === year) ?? s.enrollments.sort((a, b) => b.year - a.year)[0];
      return { ...s, student_id: s.id, number: e?.number ?? null, classroom: e ? `${classroomName(e.classrooms)}${e.year !== year ? ` (${e.year})` : ""}` : "-" };
    });
  } else {
    current = classrooms.find((c) => String(c.id) === sp.c) ?? classrooms.find((c) => profile?.homerooms.some((h) => h.classroom_id === c.id)) ?? classrooms[0];
    if (current) {
      const { data } = await sb.rpc("roster", { p_classroom: current.id, p_only_active: !isAdmin });
      rows = (data ?? []) as Row[];
    }
  }

  const canNumber = isAdmin || (!!current && year === settings?.current_year && !!profile?.homerooms.some((h) => h.classroom_id === current!.id && h.kind === "homeroom"));
  const exportRows = [["เลขที่", "รหัสนักเรียน", "ชื่อ-สกุล", "ชื่อเล่น", "เพศ", "สถานะ"], ...rows.map((r) => [r.number ?? "", r.student_code ?? "", fullName(r), r.nickname ?? "", r.gender ?? "", STUDENT_STATUSES[r.status]?.label ?? r.status])];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="ทะเบียนนักเรียน" module="registry" help="students" subtitle={`ปีการศึกษา ${year || "-"}`}
        actions={isAdmin || canNumber ? (
          <>
            {canNumber && <LinkButton href={`/students/numbers${current ? `?c=${current.id}` : ""}`} variant="secondary" size="sm"><ListNumbers size={20} weight="duotone" /> จัดเลขที่</LinkButton>}
            {isAdmin && <>
            <LinkButton href="/students/import" variant="secondary" size="sm"><UploadSimple size={20} weight="duotone" /> นำเข้าจาก DMC</LinkButton>
            <LinkButton href="/students/promote" variant="secondary" size="sm"><ArrowFatLinesUp size={20} weight="duotone" /> เลื่อนชั้นสิ้นปี</LinkButton></>}
          </>
        ) : undefined} />

      <Card className="mb-3 flex flex-col gap-3">
        {can(profile, "admin", "executive", "guidance") && (
          <form className="flex gap-2" action="/students">
            <input type="hidden" name="y" value={year} />
            <label htmlFor="q" className="sr-only">ค้นหานักเรียน</label>
            <input id="q" name="q" defaultValue={q} className="field-input" placeholder="ค้นหาชื่อ ชื่อเล่น รหัสนักเรียน หรือเลขประชาชน 13 หลัก" />
            <button type="submit" className="flex min-h-[2.875rem] shrink-0 items-center gap-2 rounded-xl bg-navy-700 px-4 font-semibold text-white">
              <MagnifyingGlass size={20} weight="bold" /> <span className="hidden sm:inline">ค้นหา</span>
            </button>
          </form>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {(years ?? []).length > 1 && (
            <div className="flex gap-1">
              {(years ?? []).map((y) => (
                <Link key={y.year} href={`/students?y=${y.year}`} className={`rounded-full px-3 py-1.5 text-sm font-bold ${y.year === year ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-700"}`}>{y.year}</Link>
              ))}
            </div>
          )}
        </div>
        {!q && (
          <nav className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="เลือกห้อง">
            {classrooms.map((c) => (
              <Link key={c.id} href={`/students?y=${year}&c=${c.id}`} aria-current={c.id === current?.id ? "page" : undefined}
                className={`shrink-0 rounded-xl px-3.5 py-2 text-sm font-bold ${c.id === current?.id ? "bg-sky-600 text-white" : "border-[1.5px] border-slate-300 bg-white text-slate-700"}`}>
                {classroomName(c)}
              </Link>
            ))}
          </nav>
        )}
      </Card>

      {q && <p className="mb-2 px-1 text-sm text-muted">ผลการค้นหา &ldquo;{q}&rdquo; {rows.length} คน · <Link href={`/students?y=${year}`} className="font-semibold text-navy-700 underline">ล้างการค้นหา</Link></p>}
      {searchError && <p className="mb-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{searchError}</p>}

      {!classrooms.length && !q ? (
        <EmptyState title="ยังไม่มีห้องเรียนในปีการศึกษานี้"
          action={isAdmin ? <LinkButton href="/students/import">นำเข้ารายชื่อจาก DMC</LinkButton> : undefined}>
          {isAdmin ? "เริ่มจากนำเข้าไฟล์รายชื่อนักเรียนจาก DMC ระบบจะสร้างห้องเรียนให้อัตโนมัติ" : "ท่านยังไม่มีห้องที่ดูแลหรือสอน"}
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState title={q ? "ไม่พบนักเรียน" : "ห้องนี้ยังไม่มีนักเรียน"} />
      ) : (
        <Card className="p-0 md:p-0">
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <p className="font-semibold">{current ? `${classroomName(current)} · ${rows.length} คน` : `${rows.length} คน`}
              <span className="ml-2 text-sm font-normal text-muted">ชาย {rows.filter((r) => r.gender === "ช").length} หญิง {rows.filter((r) => r.gender === "ญ").length}</span>
            </p>
            <ExportButton filename={`รายชื่อนักเรียน-${current ? classroomName(current).replace("/", "-") : "ค้นหา"}-${year}`} sheets={[{ name: "รายชื่อ", rows: exportRows, widths: [6, 12, 30, 12, 6, 14] }]} />
          </div>
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => {
              const st = STUDENT_STATUSES[r.status];
              return (
                <li key={r.student_id}>
                  <Link href={`/students/${r.student_id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-sky-50">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sky-100 font-semibold text-sky-900">{r.number ?? "-"}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{fullName(r)}{r.nickname ? <span className="font-normal text-muted"> ({r.nickname})</span> : null}</span>
                      <span className="block text-sm text-muted">รหัส {r.student_code ?? "-"}{r.classroom ? ` · ${r.classroom}` : ""}</span>
                    </span>
                    {r.status !== "studying" && <Badge tone={st?.tone ?? "gray"}>{st?.label ?? r.status}</Badge>}
                    <CaretRight size={20} className="text-slate-400" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
