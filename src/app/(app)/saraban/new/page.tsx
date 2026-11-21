import { getProfile, getSettings } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { EmptyState, LinkButton } from "@/components/ui";
import { RegisterForm } from "./register-form";

export const metadata = { title: "ลงรับหนังสือ" };

export default async function NewBookPage() {
  const [profile, settings] = await Promise.all([getProfile(), getSettings()]);
  const allowed = profile?.saraban_role === "director" || profile?.saraban_role === "clerk";
  const schoolName = settings?.school_name ?? "โรงเรียนอนุบาลเทพสุนทรินทร์";

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="ลงรับหนังสือ" module="saraban" back="/saraban" subtitle="แนบไฟล์ PDF กรอกรายละเอียด แล้วระบบจะออกเลขรับและประทับตรารับให้" />
      {allowed ? (
        <RegisterForm schoolName={schoolName} />
      ) : (
        <EmptyState title="เฉพาะผู้อำนวยการและธุรการ" action={<LinkButton href="/saraban">กลับไปรายการหนังสือ</LinkButton>}>
          ท่านไม่มีสิทธิ์ลงรับหนังสือ หากต้องการสิทธิ์ โปรดติดต่อผู้ดูแลระบบ
        </EmptyState>
      )}
    </div>
  );
}
