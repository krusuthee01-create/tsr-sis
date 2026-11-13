import type { NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { relativeRedirect } from "@/lib/relative-redirect";

/** Google ส่งกลับมาที่นี่หลังเลือกบัญชี */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const sb = await supabaseServer();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) return relativeRedirect("/");
  }
  return relativeRedirect("/login?error=1");
}
