"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { parseMemoInput } from "@/lib/saraban/memo";

/**
 * ส่งบันทึกข้อความ: ฐานข้อมูลออกเลขบันทึก (ศธ …/บ n) และลงรับเป็นหนังสือภายในที่ธุรการ
 * เนื้อหา 3 ภาคอยู่ในไฟล์ PDF ที่เบราว์เซอร์สร้างและอัปโหลดต่อ (เก็บเรื่อง/เรียนในทะเบียน)
 */
export async function createMemo(raw: unknown): Promise<{ ok: true; bookId: string; docNo: string } | { ok: false; error: string }> {
  const parsed = parseMemoInput(raw);
  if (!parsed.ok) return parsed;
  const m = parsed.input;
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("saraban_memo_create", { p: { unit: m.unit.trim(), subject: m.subject.trim(), to_text: m.to.trim() } });
  if (error) {
    console.error("saraban_memo_create", error);
    return { ok: false, error: error.code === "P0001" && error.message ? error.message : "ส่งบันทึกข้อความไม่สำเร็จ กรุณาลองใหม่" };
  }
  const r = data as { book_id: string; doc_no: string };
  revalidatePath("/saraban");
  return { ok: true, bookId: r.book_id, docNo: r.doc_no };
}
