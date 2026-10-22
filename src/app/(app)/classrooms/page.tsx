import Link from "next/link";
import { redirect } from "next/navigation";
import { can, getProfile, getSettings, supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { Card, EmptyState, LinkButton } from "@/components/ui";
import { classroomName, gradeSort } from "@/lib/domain";
import { AddClassroom, HomeroomEditor, RosterManager } from "./classroom-tools";

export const metadata = { title: "ห้องเรียนและครูที่ปรึกษา" };

export default async function ClassroomsPage({ searchParams }: { searchParams: Promise<{ y?: string; c?: string }> }) {
  const sp = await searchParams;
  const [profile, settings] = await Promise.all([getProfile(), getSettings()]);
  if (!can(profile, "admin")) redirect("/");
  const sb = await supabaseServer();
  const year = Number(sp.y) || settings?.current_year || 0;

  const [{ data: years }, { data: classData }, { data: enroll }, { data: homerooms }, { data: staff }] = await Promise.all([
    sb.from("academic_years").select("year").order("year", { ascending: false }),
    sb.from("classrooms").select("id, grade, room").eq("year", year),
    sb.from("enrollments").select("classroom_id").eq("year", year),
    sb.from("homeroom_assignments").select("id, classroom_id, kind, staff(id, prefix, first_name, last_name)"),
    sb.from("staff").select("id, prefix, first_name, last_name").eq("approved", true).eq("active", true).order("first_name"),
  ]);
  const classrooms = ((classData ?? []) as { id: number; grade: string; room: number }[]).sort((a, b) => gradeSort(a.grade) - gradeSort(b.grade) || a.room - b.room);
  const counts = new Map<number, number>();
  for (const e of enroll ?? []) counts.set(e.classroom_id, (counts.get(e.classroom_id) ?? 0) + 1);
  type HR = { id: number; classroom_id: number; kind: "homeroom" | "assistant"; staff: { id: string; prefix: string | null; first_name: string; last_name: string } };
  const hrs = (homerooms ?? []) as unknown as HR[];
  const current = classrooms.find((c) => String(c.id) === sp.c) ?? classrooms[0];

  let roster: { student_id: string; number: number | null; prefix: string | null; first_name: string; last_name: string; gender: string | null; status: string }[] = [];
  if (current) {
    const { data } = await sb.rpc("roster", { p_classroom: current.id, p_only_active: false });
    roster = data ?? [];
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="ห้องเรียนและครูที่ปรึกษา" module="registry" help="classrooms" subtitle={`ปีการศึกษา ${year || "-"}`}
        actions={<AddClassroom year={year} />} />
      {(years ?? []).length > 1 && (
        <div className="mb-3 flex gap-1">
          {(years ?? []).map((y) => <Link key={y.year} href={`/classrooms?y=${y.year}`} className={`rounded-full px-3 py-1.5 text-sm font-bold ${y.year === year ? "bg-sky-600 text-white" : "bg-white text-slate-700"}`}>{y.year}</Link>)}
        </div>
      )}
      {!classrooms.length ? (
        <EmptyState title="ยังไม่มีห้องเรียนในปีนี้" action={<LinkButton href="/students/import">นำเข้าจาก DMC</LinkButton>}>
          นำเข้ารายชื่อจาก DMC ระบบจะสร้างห้องให้อัตโนมัติ หรือกด &ldquo;เพิ่มห้อง&rdquo;
        </EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
          <Card className="p-2 md:p-2">
            <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-1">
              {classrooms.map((c) => {
                const h = hrs.filter((x) => x.classroom_id === c.id && x.kind === "homeroom");
                return (
                  <li key={c.id}>
                    <Link href={`/classrooms?y=${year}&c=${c.id}`} aria-current={c.id === current?.id ? "page" : undefined}
                      className={`flex flex-col rounded-xl px-3 py-2 ${c.id === current?.id ? "bg-sky-600 text-white" : "hover:bg-sky-50"}`}>
                      <span className="font-semibold">{classroomName(c)} <span className="text-sm font-normal opacity-80">· {counts.get(c.id) ?? 0} คน</span></span>
                      <span className={`truncate text-xs ${c.id === current?.id ? "text-sky-100" : h.length ? "text-muted" : "font-semibold text-amber-700"}`}>
                        {h.length ? h.map((x) => x.staff.first_name).join(", ") : "ยังไม่มีครูที่ปรึกษา"}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
          {current && (
            <div className="flex flex-col gap-4">
              <HomeroomEditor classroomId={current.id} title={classroomName(current)}
                assigned={hrs.filter((x) => x.classroom_id === current.id).map((x) => ({ id: x.id, kind: x.kind, name: `${x.staff.prefix ?? ""}${x.staff.first_name} ${x.staff.last_name}` }))}
                staff={(staff ?? []).map((s) => ({ id: s.id, name: `${s.prefix ?? ""}${s.first_name} ${s.last_name}` }))} />
              <RosterManager classroomId={current.id} title={classroomName(current)} roster={roster}
                classrooms={classrooms.filter((c) => c.id !== current.id).map((c) => ({ id: c.id, name: classroomName(c) }))} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
