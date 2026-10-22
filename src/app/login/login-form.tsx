"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Info } from "@phosphor-icons/react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Field, btnClass } from "@/components/ui";
import { usernameToEmail } from "@/lib/accounts";

function GoogleLogo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.5 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h5.9c-.3 1.4-1 2.5-2.2 3.3v2.7h3.5c2.1-1.9 3.3-4.7 3.3-8z" />
      <path fill="#34A853" d="M12 23c3 0 5.4-1 7.2-2.7l-3.5-2.7c-1 .7-2.2 1-3.7 1-2.9 0-5.3-1.9-6.2-4.5H2.2v2.8C4 20.5 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.8 14.1c-.2-.7-.4-1.4-.4-2.1s.1-1.4.4-2.1V7.1H2.2C1.4 8.6 1 10.3 1 12s.4 3.4 1.2 4.9l3.6-2.8z" />
      <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.1-3.1C17.4 2.2 15 1 12 1 7.7 1 4 3.5 2.2 7.1l3.6 2.8c.9-2.6 3.3-4.5 6.2-4.5z" />
    </svg>
  );
}

export function LoginForm({ initialError }: { initialError: string | null }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(initialError);
  const [busy, setBusy] = useState(false);

  async function google() {
    setBusy(true);
    const { error } = await supabaseBrowser().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback`, queryParams: { prompt: "select_account" } },
    });
    if (error) {
      setError("เชื่อมต่อ Google ไม่สำเร็จ: " + error.message);
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError("กรุณากรอกชื่อผู้ใช้และรหัสผ่าน");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email: usernameToEmail(username), password });
    if (error) {
      setError(error.message.includes("Invalid") ? "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" : "เข้าสู่ระบบไม่สำเร็จ: " + error.message);
      setBusy(false);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <>
      <h2 className="text-xl font-semibold">สวัสดีครับ คุณครู</h2>
      <button type="button" onClick={google} disabled={busy} className={btnClass("secondary", "lg")}>
        <GoogleLogo /> เข้าสู่ระบบด้วย Google
      </button>
      <div className="flex items-center gap-3 text-sm text-muted">
        <span className="h-px flex-1 bg-line" />หรือใช้ชื่อผู้ใช้<span className="h-px flex-1 bg-line" />
      </div>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="ชื่อผู้ใช้" htmlFor="username" hint="ชื่อที่ผู้ดูแลระบบสร้างให้ เช่น somjai.r">
          <input id="username" className="field-input" autoComplete="username" autoCapitalize="none" spellCheck={false}
            value={username} onChange={(e) => setUsername(e.target.value)} placeholder="เช่น somjai.r" />
        </Field>
        <Field label="รหัสผ่าน" htmlFor="password" hint="ลืมรหัสผ่าน? แจ้งผู้ดูแลระบบให้ตั้งใหม่ได้ทันที">
          <input id="password" type="password" className="field-input" autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)} placeholder="อย่างน้อย 8 ตัวอักษร" />
        </Field>
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2.5 text-sm font-medium text-red-800">{error}</p>}
        <button type="submit" disabled={busy} className={btnClass("primary", "lg")}>{busy ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}</button>
      </form>
      <p className="mt-auto flex items-center gap-2.5 rounded-2xl bg-sky-50 px-4 py-3 text-sm text-sky-950">
        <Info size={22} weight="duotone" className="shrink-0" /> ครั้งแรก? ระบบจะพาทัวร์การใช้งาน 1 นาที
      </p>
    </>
  );
}
