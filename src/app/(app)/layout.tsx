import { redirect } from "next/navigation";
import { getProfile, getSettings } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [profile, settings] = await Promise.all([getProfile(), getSettings()]);
  if (!profile || !profile.approved || !profile.active) redirect("/pending");
  return (
    <AppShell profile={profile} schoolName={settings?.school_name ?? "โรงเรียนอนุบาลเทพสุนทรินทร์"}>
      {children}
    </AppShell>
  );
}
