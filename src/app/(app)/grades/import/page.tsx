import { can, getProfile, supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/ui";
import { Pp5Import } from "./pp5-import";

export const metadata = { title: "นำเข้าผลการเรียน ปพ.5" };

export default async function GradesImportPage() {
  const sb = await supabaseServer();
  const profile = await getProfile();
  const all = can(profile, "admin", "academic");
  const own = (profile?.homerooms ?? []).filter((h) => h.kind === "homeroom").map((h) => h.classroom_id);
  const { data } = await sb.from("classrooms").select("id, year, grade, room");
  const classrooms = ((data ?? []) as { id: number; year: number; grade: string; room: number }[]).filter((c) => all || own.includes(c.id));
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="นำเข้าผลการเรียน / พัฒนาการ" module="grades" help="grades" back="/grades" subtitle="ประถม: ไฟล์ ปพ.5-6 · อนุบาล: สมุดบันทึกพัฒนาการ — เลือกได้หลายไฟล์พร้อมกัน" />
      {classrooms.length
        ? <Pp5Import classrooms={classrooms} all={all} />
        : <EmptyState title="ท่านยังไม่มีห้องที่นำเข้าได้">นำเข้าได้เฉพาะครูที่ปรึกษา งานวิชาการ และผู้ดูแลระบบ</EmptyState>}
    </div>
  );
}
