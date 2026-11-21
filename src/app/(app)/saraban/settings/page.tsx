import { getProfile, supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import type { Preset } from "@/lib/saraban/book";
import { PresetEditor, PushToggle, SignatureForm } from "./settings-forms";

export const metadata = { title: "ตั้งค่าสารบรรณ" };

export default async function SarabanSettingsPage() {
  const sb = await supabaseServer();
  const [profile, { data, error }] = await Promise.all([
    getProfile(),
    sb.from("saraban_presets").select("id, role, text, sort").order("sort").order("id"),
  ]);
  if (error) console.error("saraban_presets", error);
  const role = profile?.saraban_role ?? "teacher";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader title="ตั้งค่าสารบรรณ" module="saraban" back="/saraban" help="saraban-settings" subtitle="คำสั่งสำเร็จรูป ลายเซ็น และการแจ้งเตือน" />
      <PushToggle vapidKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""} />
      {profile && <SignatureForm staffId={profile.id} />}
      <PresetEditor initial={(data ?? []) as Preset[]} editable={role === "director" || role === "clerk"} />
    </div>
  );
}
