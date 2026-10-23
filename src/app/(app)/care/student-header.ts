import { getSettings, supabaseServer } from "@/lib/supabase/server";

/** ข้อมูลนักเรียนสำหรับหน้าฟอร์มดูแลช่วยเหลือ (ต้องมีสิทธิ์ดูข้อมูลเต็มของนักเรียนคนนี้) */
export async function careStudent(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const sb = await supabaseServer();
  const settings = await getSettings();
  const { data } = await sb.from("students")
    .select("id, prefix, first_name, last_name, gender, birth_date, guardian_name, guardian_relation, guardian_phone, mother_phone, father_phone, address_current, enrollments(year, number, classroom_id, classrooms(grade, room))")
    .eq("id", id).maybeSingle();
  if (!data) return null;
  const s = data as unknown as {
    id: string; prefix: string | null; first_name: string; last_name: string; gender: string | null; birth_date: string | null;
    guardian_name: string | null; guardian_relation: string | null; guardian_phone: string | null; mother_phone: string | null; father_phone: string | null;
    address_current: string | null;
    enrollments: { year: number; number: number | null; classroom_id: number; classrooms: { grade: string; room: number } }[];
  };
  const e = s.enrollments.find((x) => x.year === settings?.current_year);
  return { ...s, enrollment: e ?? null, year: settings?.current_year ?? 0 };
}
