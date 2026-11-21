import { getProfile, supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { canManageDrive } from "@/lib/saraban/drive-connect";
import { DriveCard } from "./drive-card";
import { PageHeader } from "@/components/page-header";
import type { Preset } from "@/lib/saraban/book";
import { PresetEditor, PushToggle, SignatureForm } from "./settings-forms";

export const metadata = { title: "ตั้งค่าสารบรรณ" };

export default async function SarabanSettingsPage({ searchParams }: { searchParams: Promise<{ drive?: string }> }) {
  const sp = await searchParams;
  const sb = await supabaseServer();
  const [profile, { data, error }] = await Promise.all([
    getProfile(),
    sb.from("saraban_presets").select("id, role, text, sort").order("sort").order("id"),
  ]);
  if (error) console.error("saraban_presets", error);
  const role = profile?.saraban_role ?? "teacher";

  // สถานะที่เก็บไฟล์: อ่านด้วย service role เฉพาะคอลัมน์ที่ไม่ลับ และเฉพาะผู้ดูแลระบบ/ผอ.
  let drive: { account_email: string | null; connected_at: string } | null = null;
  const manageDrive = canManageDrive(profile);
  if (manageDrive) {
    const { data: cfg, error: cfgErr } = await supabaseAdmin()
      .from("saraban_drive_config").select("account_email, connected_at").eq("id", 1).maybeSingle();
    if (cfgErr) console.error("saraban_drive_config", cfgErr);
    drive = cfg ?? null;
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader title="ตั้งค่าสารบรรณ" module="saraban" back="/saraban" help="saraban-settings" subtitle="ที่เก็บไฟล์ คำสั่งสำเร็จรูป ลายเซ็น และการแจ้งเตือน" />
      {manageDrive && (
        <DriveCard
          config={drive}
          serviceAccount={Boolean(process.env.GOOGLE_SA_EMAIL && process.env.GOOGLE_SA_PRIVATE_KEY && process.env.SARABAN_DRIVE_FOLDER_ID)}
          result={typeof sp.drive === "string" ? sp.drive : undefined}
        />
      )}
      <PushToggle vapidKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""} />
      {profile && <SignatureForm staffId={profile.id} />}
      <PresetEditor initial={(data ?? []) as Preset[]} editable={role === "director" || role === "clerk"} />
    </div>
  );
}
