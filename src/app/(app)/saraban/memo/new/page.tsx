import { getProfile, getSettings, supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { MemoForm } from "./memo-form";

export const metadata = { title: "เขียนบันทึกข้อความ" };

/** ครู/บุคลากรเขียนบันทึกข้อความ (แบบ A4 มาตรฐาน) แล้วส่งเข้าระบบสารบรรณ */
export default async function NewMemoPage() {
  const [profile, settings] = await Promise.all([getProfile(), getSettings()]);
  const sb = await supabaseServer();
  const { data: me } = profile
    ? await sb.from("staff").select("position").eq("id", profile.id).maybeSingle()
    : { data: null };
  const school = settings?.school_name ?? "";
  // ชื่อแบบหนังสือราชการ: คำนำหน้าติดชื่อ เช่น "นายสุธี พาทีทิน"
  const name = profile ? `${profile.prefix ?? ""}${profile.first_name} ${profile.last_name ?? ""}`.trim() : "";
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="เขียนบันทึกข้อความ" module="saraban" back="/saraban" subtitle="ส่งถึงธุรการเพื่อเสนอผู้อำนวยการ" />
      <MemoForm staffId={profile?.id ?? ""} signerName={name} school={school}
        defaultPosition={(me as { position?: string | null } | null)?.position ?? "ครู"} />
    </div>
  );
}
