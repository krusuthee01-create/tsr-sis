import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { cache } from "react";

/** Supabase ฝั่งเซิร์ฟเวอร์ ใช้สิทธิ์ของผู้ใช้ที่ล็อกอินอยู่ (RLS ทำงานตามปกติ) */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // เรียกจาก Server Component ตั้ง cookie ไม่ได้ — middleware จัดการให้แล้ว
        }
      },
    },
  });
}

/** ใช้สิทธิ์ service role — เฉพาะงานผู้ดูแลระบบที่ต้องสร้างบัญชีผู้ใช้ */
export function supabaseAdmin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("ยังไม่ได้ตั้งค่า SUPABASE_SERVICE_ROLE_KEY");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type Profile = {
  id: string;
  prefix: string | null;
  first_name: string;
  last_name: string;
  roles: string[];
  approved: boolean;
  active: boolean;
  font_scale: number;
  tour_done: boolean;
  email: string | null;
  has_admin: boolean;
  homerooms: { classroom_id: number; grade: string; room: number; year: number; kind: "homeroom" | "assistant" }[];
};

/** ข้อมูลผู้ใช้ปัจจุบัน (เรียกซ้ำในคำขอเดียวกันไม่เสียเวลา) */
export const getProfile = cache(async (): Promise<Profile | null> => {
  const sb = await supabaseServer();
  const { data } = await sb.rpc("my_profile");
  return (data as Profile | null) ?? null;
});

export const getSettings = cache(async () => {
  const sb = await supabaseServer();
  const { data } = await sb.from("school_settings").select("*").eq("id", 1).maybeSingle();
  return data as null | {
    school_name: string;
    school_code: string;
    address: string | null;
    director_name: string | null;
    registrar_name: string | null;
    current_year: number | null;
    edit_window_days: number;
    attendance_risk_percent: number;
  };
});

export function can(profile: Profile | null, ...roles: string[]): boolean {
  return !!profile && profile.roles.some((r) => roles.includes(r));
}
