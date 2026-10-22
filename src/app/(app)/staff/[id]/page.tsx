import Link from "next/link";
import { notFound } from "next/navigation";
import { can, getProfile, getSettings, supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { Badge, Card, SectionTitle } from "@/components/ui";
import { classroomName, gradeSort, isKindergarten, ROLES } from "@/lib/domain";
import { formatThaiDateTime } from "@/lib/thai-date";
import { LoginAccount, RoleEditor, StaffForm, TeachingEditor, type StaffData } from "../staff-tools";

export const metadata = { title: "ข้อมูลครู" };

export default async function StaffDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const sb = await supabaseServer();
  const [profile, settings] = await Promise.all([getProfile(), getSettings()]);
  const isAdmin = can(profile, "admin");
  const year = settings?.current_year ?? 0;

  const { data: staff } = await sb.from("staff").select("*").eq("id", id).maybeSingle();
  if (!staff) notFound();

  const [{ data: homerooms }, { data: teaching }, { data: terms }, { data: subjects }, { data: classrooms }] = await Promise.all([
    sb.from("homeroom_assignments").select("kind, classrooms!inner(id, grade, room, year)").eq("staff_id", id).eq("classrooms.year", year),
    sb.from("teaching_assignments").select("id, terms!inner(term, year), subjects(code, name), classrooms(grade, room)").eq("staff_id", id).eq("terms.year", year),
    sb.from("terms").select("id, term, year").eq("year", year).order("term"),
    sb.from("subjects").select("id, code, name, grade").order("code"),
    sb.from("classrooms").select("id, grade, room").eq("year", year),
  ]);
  const name = `${staff.prefix ?? ""}${staff.first_name} ${staff.last_name}`.trim();
  type T = { id: number; terms: { term: number; year: number }; subjects: { code: string; name: string }; classrooms: { grade: string; room: number } };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={name} module="staff" help="staff" back="/staff"
        subtitle={<span className="flex flex-wrap items-center gap-2">{[staff.position, staff.academic_rank].filter(Boolean).join(" · ") || "ครูและบุคลากร"}
          {!staff.active && <Badge tone="red" className="bg-white">ปิดการใช้งาน</Badge>}
          {!staff.approved && <Badge tone="amber" className="bg-white">รออนุมัติ</Badge>}</span>} />
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card>
          <SectionTitle>ข้อมูลทั่วไป</SectionTitle>
          <StaffForm canEdit={isAdmin} initial={{ ...(staff as StaffData), academic_rank: staff.academic_rank ?? "-", learning_area: staff.learning_area ?? "-" }} />
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <SectionTitle>ห้องที่เป็นครูที่ปรึกษา (ปี {year})</SectionTitle>
            {(homerooms ?? []).length === 0 ? <p className="text-muted">-</p> : (
              <ul className="flex flex-wrap gap-2">
                {((homerooms ?? []) as unknown as { kind: string; classrooms: { id: number; grade: string; room: number } }[]).map((h) => (
                  <li key={h.classrooms.id}><Badge tone={h.kind === "homeroom" ? "blue" : "gray"} className="px-3 py-1 text-sm">{classroomName(h.classrooms)} {h.kind === "assistant" ? "(พี่เลี้ยง)" : ""}</Badge></li>
                ))}
              </ul>
            )}
            {isAdmin && <Link href="/classrooms" className="mt-2 inline-block text-sm font-semibold text-navy-700 underline">กำหนดที่หน้าห้องเรียน</Link>}
          </Card>
          {isAdmin ? (
            <>
              <Card><SectionTitle>บทบาทในระบบ</SectionTitle><RoleEditor staffId={id} roles={staff.roles} active={staff.active} isSelf={profile?.id === id} /></Card>
              <Card><SectionTitle>บัญชีเข้าระบบ</SectionTitle>
                <LoginAccount staffId={id} username={staff.username} hasUser={!!staff.user_id} email={staff.email} />
                <p className="mt-3 text-sm text-muted">ใช้งานล่าสุด {formatThaiDateTime(staff.last_seen_at)}</p>
              </Card>
            </>
          ) : (
            <Card><SectionTitle>บทบาท</SectionTitle><p>{staff.roles.map((r: string) => ROLES[r]).join(", ") || "ครู"}</p></Card>
          )}
        </div>
        <Card className="lg:col-span-2">
          <SectionTitle>วิชาที่สอน ปีการศึกษา {year}</SectionTitle>
          {isAdmin ? (
            <TeachingEditor staffId={id}
              items={((teaching ?? []) as unknown as T[]).map((t) => ({ id: t.id, term: `ภาค ${t.terms.term}/${t.terms.year}`, subject: `${t.subjects.code} ${t.subjects.name}`, classroom: classroomName(t.classrooms) }))}
              terms={(terms ?? []).map((t) => ({ id: t.id, label: `ภาคเรียนที่ ${t.term}/${t.year}` }))}
              subjects={(subjects ?? []).map((s) => ({ id: s.id, label: `${s.code} ${s.name}`, grade: s.grade }))}
              classrooms={((classrooms ?? []) as { id: number; grade: string; room: number }[]).filter((c) => !isKindergarten(c.grade))
                .sort((a, b) => gradeSort(a.grade) - gradeSort(b.grade) || a.room - b.room).map((c) => ({ id: c.id, label: classroomName(c), grade: c.grade }))} />
          ) : (
            <ul className="flex flex-col gap-1">{((teaching ?? []) as unknown as T[]).map((t) => <li key={t.id}>{classroomName(t.classrooms)} · {t.subjects.code} {t.subjects.name}</li>)}</ul>
          )}
        </Card>
      </div>
    </div>
  );
}
