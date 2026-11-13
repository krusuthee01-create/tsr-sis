"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AUTH_COOKIE_OPTIONS } from "./cookies";

let client: SupabaseClient | null = null;

/** Supabase ฝั่งเบราว์เซอร์ (ใช้ตัวเดียวทั้งแอป) */
export function supabaseBrowser(): SupabaseClient {
  // คุกกี้ที่ path /sis (ดู cookies.ts)
  client ??= createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
  });
  return client;
}
