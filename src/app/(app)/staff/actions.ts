"use server";

import { revalidatePath } from "next/cache";
import { can, getProfile, supabaseAdmin, supabaseServer } from "@/lib/supabase/server";

type Result = { ok: true } | { ok: false, error: string };

async function assertAdmin(): Promise<string | null> {
  const profile = await getProfile();
  return can(profile, "admin") ? null : "เฉพาะผู้ดูแลระบบเท่านั้น";
}

/**
 * เปลี่ยนครูที่ใช้บัญชีชื่อผู้ใช้ (เลิกใช้แล้ว) ให้เข้าระบบด้วย Google
 * ตั้งอีเมล Google ให้ครู ยกเลิกบัญชีชื่อผู้ใช้ แล้วเมื่อครูกดเข้าสู่ระบบด้วย Google ระบบจะผูกกับครูคนนี้อัตโนมัติ
 * ถ้าครูเคยลองเข้าด้วย Google แล้ว (ระบบสร้างแถว "รออนุมัติ" แยกไว้) จะย้ายบัญชีนั้นมาผูกกับครูคนนี้แทน
 */
export async function switchToGoogle(staffId: string, rawEmail: string): Promise<Result> {
  const denied = await assertAdmin();
  if (denied) return { ok: false, error: denied };
  const email = rawEmail.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.endsWith("@users.tsr-sis.local")) {
    return { ok: false, error: "กรุณาใส่อีเมล Google ของครู เช่น somjai@gmail.com" };
  }
  const admin = supabaseAdmin();
  const { data: staff } = await admin.from("staff").select("id, user_id, username").eq("id", staffId).maybeSingle();
  if (!staff) return { ok: false, error: "ไม่พบครูท่านนี้" };

  // อีเมลนี้มีในทะเบียนครูคนอื่นแล้วหรือไม่
  const { data: other } = await admin.from("staff").select("id, user_id, approved, first_name").eq("email", email).neq("id", staffId).maybeSingle();
  let googleUser: string | null = null;
  if (other) {
    if (other.approved) return { ok: false, error: `อีเมลนี้เป็นของ ${other.first_name} ในทะเบียนครูแล้ว` };
    // แถวรออนุมัติที่เกิดจากครูกดเข้าด้วย Google ก่อนตั้งอีเมล: ย้ายบัญชี Google มาที่ครูคนนี้
    googleUser = other.user_id;
    const { error } = await admin.from("staff").delete().eq("id", other.id);
    if (error) return { ok: false, error: "ย้ายบัญชี Google ไม่สำเร็จ: " + error.message };
  }

  const oldUser = staff.username ? staff.user_id : null;
  const { error: upd } = await admin.from("staff").update({ email, username: null, user_id: googleUser ?? (staff.username ? null : staff.user_id) }).eq("id", staffId);
  if (upd) return { ok: false, error: upd.message };
  if (oldUser) {
    const { error } = await admin.auth.admin.deleteUser(oldUser);
    if (error) return { ok: false, error: "เปลี่ยนแล้ว แต่ยกเลิกบัญชีชื่อผู้ใช้เดิมไม่สำเร็จ: " + error.message };
  }
  revalidatePath(`/staff/${staffId}`);
  revalidatePath("/staff");
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * กำหนดบทบาทสารบรรณและกลุ่มงานของครู — ผู้ดูแลระบบ หรือ ผอ. ในระบบสารบรรณ
 * ตรวจสิทธิ์และเขียนผ่าน RPC saraban_set_role (security definer) เพื่อให้ประวัติการแก้ไขบันทึกผู้ทำจริง
 */
export async function setSarabanRole(staffId: unknown, role: unknown, workGroup: unknown): Promise<Result> {
  if (typeof staffId !== "string" || !UUID.test(staffId)) return { ok: false, error: "ไม่พบครูท่านนี้" };
  if (typeof role !== "string") return { ok: false, error: "บทบาทไม่ถูกต้อง" };
  if (workGroup != null && typeof workGroup !== "string") return { ok: false, error: "กลุ่มงานไม่ถูกต้อง" };
  const sb = await supabaseServer();
  const { error } = await sb.rpc("saraban_set_role", { p_staff: staffId, p_role: role, p_group: workGroup ?? null });
  if (error) {
    console.error("saraban_set_role", error);
    return { ok: false, error: error.code === "P0001" && error.message ? error.message : "บันทึกบทบาทสารบรรณไม่สำเร็จ" };
  }
  revalidatePath(`/staff/${staffId}`);
  return { ok: true };
}
