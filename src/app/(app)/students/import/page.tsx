import { redirect } from "next/navigation";
import { can, getProfile, getSettings } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { ImportWizard } from "./import-wizard";
import { academicYearOf, todayISO } from "@/lib/thai-date";

export const metadata = { title: "นำเข้าจาก DMC" };

export default async function ImportPage() {
  const [profile, settings] = await Promise.all([getProfile(), getSettings()]);
  if (!can(profile, "admin")) redirect("/students");
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="นำเข้ารายชื่อนักเรียนจาก DMC" module="registry" help="import" back="/students"
        subtitle="ระบบจะแสดงตัวอย่างให้ตรวจก่อนบันทึกทุกครั้ง" />
      <ImportWizard defaultYear={settings?.current_year ?? academicYearOf(todayISO())} schoolCode={settings?.school_code ?? null} />
    </div>
  );
}
