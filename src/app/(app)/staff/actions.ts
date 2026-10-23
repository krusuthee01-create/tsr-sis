"use server";

import { revalidatePath } from "next/cache";
import { can, getProfile, supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { isValidUsername, usernameToEmail } from "@/lib/accounts";

type Result = { ok: true } | { ok: false, error: string };

async function assertAdmin(): Promise<string | null> {
  const profile = await getProfile();
  return can(profile, "admin") ? null : "เฉพาะผู้ดูแลระบบเท่านั้น";
}

/** สร้างบัญชีชื่อผู้ใช้/รหัสผ่านให้ครู (ใช้ service role เพราะต้องสร้างผู้ใช้ใน Supabase Auth) */
export async function createLoginAccount(staffId: string, username: string, password: string): Promise<Result> {
  const denied = await assertAdmin();
  if (denied) return { ok: false, error: denied };
  const u = username.trim().toLowerCase();
  if (!isValidUsername(u)) return { ok: false, error: "ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 . _ - ยาว 3–32 ตัว" };
  if (password.length < 8) return { ok: false, error: "รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร" };

  const sb = await supabaseServer();
  const { data: staff } = await sb.from("staff").select("id, user_id").eq("id", staffId).maybeSingle();
  if (!staff) return { ok: false, error: "ไม่พบครูท่านนี้" };
  if (staff.user_id) return { ok: false, error: "ครูท่านนี้มีบัญชีเข้าระบบแล้ว (ใช้ตั้งรหัสผ่านใหม่แทน)" };

  const admin = supabaseAdmin();
  const { data: created, error } = await admin.auth.admin.createUser({
    email: usernameToEmail(u), password, email_confirm: true, app_metadata: { staff_id: staffId },
  });
  if (error || !created.user) return { ok: false, error: error?.message.includes("already") ? "ชื่อผู้ใช้นี้ถูกใช้แล้ว" : error?.message ?? "สร้างบัญชีไม่สำเร็จ" };

  // ผูกบัญชีกับครูคนนี้โดยตรง: Supabase บางรุ่นใส่ app_metadata หลังสร้างผู้ใช้
  // trigger จึงอาจสร้างแถว "รออนุมัติ" แยกขึ้นมา — ลบแถวนั้นแล้วผูกให้ถูกคน
  const uid = created.user.id;
  const { error: delErr } = await admin.from("staff").delete().eq("user_id", uid).neq("id", staffId);
  if (delErr) return { ok: false, error: delErr.message };
  const { error: upd } = await admin.from("staff").update({ user_id: uid, username: u, approved: true }).eq("id", staffId);
  if (upd) return { ok: false, error: upd.message };
  revalidatePath(`/staff/${staffId}`);
  return { ok: true };
}

export async function resetPassword(staffId: string, password: string): Promise<Result> {
  const denied = await assertAdmin();
  if (denied) return { ok: false, error: denied };
  if (password.length < 8) return { ok: false, error: "รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร" };
  const sb = await supabaseServer();
  const { data: staff } = await sb.from("staff").select("user_id, username").eq("id", staffId).maybeSingle();
  if (!staff?.user_id || !staff.username) return { ok: false, error: "ครูท่านนี้ไม่ได้ใช้บัญชีชื่อผู้ใช้ (เข้าด้วย Google)" };
  const { error } = await supabaseAdmin().auth.admin.updateUserById(staff.user_id, { password });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * ลบครูออกจากทะเบียนถาวร พร้อมบัญชีเข้าระบบ
 * ลบได้เฉพาะครูที่ยังไม่เคยบันทึกข้อมูลใด (เช่น บัญชีทดสอบ หรือบัญชีที่สมัครผิด)
 * ครูที่เคยเช็กชื่อแล้วให้ใช้ "ปิดการใช้งาน" แทน เพื่อเก็บประวัติไว้
 */
export async function deleteStaff(staffId: string): Promise<Result> {
  const denied = await assertAdmin();
  if (denied) return { ok: false, error: denied };
  const profile = await getProfile();
  if (profile?.id === staffId) return { ok: false, error: "ลบบัญชีของตัวเองไม่ได้" };

  const sb = await supabaseServer();
  const { data: staff } = await sb.from("staff").select("user_id").eq("id", staffId).maybeSingle();
  if (!staff) return { ok: false, error: "ไม่พบครูท่านนี้" };

  const { error } = await sb.from("staff").delete().eq("id", staffId);
  if (error) {
    return { ok: false, error: error.code === "23503"
      ? "ครูท่านนี้มีประวัติการบันทึกข้อมูลแล้ว ลบไม่ได้ — ใช้ \"ปิดการใช้งานบัญชี\" แทน"
      : error.message };
  }
  if (staff.user_id) {
    const { error: authErr } = await supabaseAdmin().auth.admin.deleteUser(staff.user_id);
    if (authErr) return { ok: false, error: "ลบจากทะเบียนแล้ว แต่ลบบัญชีเข้าระบบไม่สำเร็จ: " + authErr.message };
  }
  revalidatePath("/staff");
  return { ok: true };
}
