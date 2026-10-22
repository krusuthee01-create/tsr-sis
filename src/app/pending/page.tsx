import Image from "next/image";
import { redirect } from "next/navigation";
import { getProfile, supabaseServer } from "@/lib/supabase/server";
import { PendingActions } from "./pending-actions";

export const metadata = { title: "รออนุมัติ" };
export const dynamic = "force-dynamic";

export default async function PendingPage() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const profile = await getProfile();
  if (profile?.approved && profile.active) redirect("/");

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-[2rem] bg-white p-7 text-center shadow-xl">
        <Image src="/icons/logo.png" alt="ตราโรงเรียน" width={88} height={88} className="size-22 rounded-full" />
        {!profile ? (
          <>
            <h1 className="text-xl font-semibold">ไม่พบบัญชีในทะเบียนครู</h1>
            <p className="text-muted">อีเมล {user.email} ยังไม่ได้ผูกกับทะเบียนครู กรุณาแจ้งผู้ดูแลระบบ</p>
          </>
        ) : !profile.active ? (
          <>
            <h1 className="text-xl font-semibold">บัญชีถูกปิดการใช้งาน</h1>
            <p className="text-muted">กรุณาติดต่อผู้ดูแลระบบ</p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold">รอผู้ดูแลระบบอนุมัติ</h1>
            <p className="text-muted">
              บัญชี <span className="font-semibold text-ink">{user.email}</span> ลงทะเบียนแล้ว
              กรุณาแจ้งผู้ดูแลระบบให้อนุมัติที่หน้า &ldquo;ทะเบียนครู&rdquo; จากนั้นกด &ldquo;ตรวจสอบอีกครั้ง&rdquo;
            </p>
          </>
        )}
        <PendingActions canClaimAdmin={!!profile && !profile.has_admin} />
      </div>
    </div>
  );
}
