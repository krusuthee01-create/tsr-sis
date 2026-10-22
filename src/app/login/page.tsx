import Image from "next/image";
import { LoginForm } from "./login-form";

export const metadata = { title: "เข้าสู่ระบบ" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="flex min-h-dvh flex-col bg-page md:items-center md:justify-center md:p-6">
      <div className="flex w-full flex-1 flex-col overflow-hidden bg-white md:max-w-md md:flex-none md:rounded-[2rem] md:shadow-xl">
        <div className="relative flex flex-col items-center gap-2.5 overflow-hidden bg-navy-700 px-6 pb-12 pt-10 text-center text-white">
          <div className="absolute -right-20 -top-20 size-64 rounded-full bg-sky-brand/35" aria-hidden />
          <div className="absolute -bottom-10 -left-12 size-40 rounded-full bg-lotus/35" aria-hidden />
          <Image src="/icons/logo.png" alt="ตราโรงเรียนอนุบาลเทพสุนทรินทร์" width={112} height={112} priority className="relative size-28 rounded-full bg-white p-1.5" />
          <h1 className="relative text-2xl font-semibold">ระบบสารสนเทศนักเรียน</h1>
          <p className="relative text-sky-100">โรงเรียนอนุบาลเทพสุนทรินทร์</p>
        </div>
        <div className="-mt-7 flex flex-1 flex-col gap-4 rounded-t-[1.75rem] bg-white px-6 pb-8 pt-7">
          <LoginForm initialError={error ? "เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่" : null} />
        </div>
      </div>
    </div>
  );
}
