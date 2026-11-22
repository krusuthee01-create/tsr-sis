// อัปโหลด PDF จากเบราว์เซอร์ตรงเข้า Drive แล้วบันทึกกับหนังสือ (ใช้ในหน้าลงรับและหน้าหนังสือ — ฝั่งเบราว์เซอร์เท่านั้น)
import { withBase } from "@/lib/base-path";
import type { FileKind } from "@/lib/saraban/types";
import { safeMessage } from "@/lib/saraban/book";
import { finalizeUpload } from "./actions";
import { finalizeOutUpload } from "./out/actions";

/** ขั้นตอน: ขอ URL อัปโหลด → PUT ไฟล์ → บันทึก (finalizeUpload) — ผิดพลาดจะ throw Error ข้อความภาษาไทย */
export async function uploadPdf(bookId: string, kind: FileKind, name: string, body: Blob): Promise<string> {
  const id = await putToDrive({ bookId, kind }, name, body);
  const fin = await finalizeUpload(bookId, kind, id);
  if (!fin.ok) throw new Error(safeMessage(fin.error, "บันทึกไฟล์ไม่สำเร็จ กรุณาลองใหม่"));
  return fin.fileId;
}

/** แนบสำเนาหนังสือส่ง/คำสั่ง/ประกาศ */
export async function uploadOutPdf(outId: string, name: string, body: Blob): Promise<string> {
  const id = await putToDrive({ outId }, name, body);
  const fin = await finalizeOutUpload(outId, id);
  if (!fin.ok) throw new Error(safeMessage(fin.error, "บันทึกไฟล์ไม่สำเร็จ กรุณาลองใหม่"));
  return fin.fileId;
}

/** ขอ URL อัปโหลด แล้ว PUT ไฟล์ตรงเข้า Drive — คืนรหัสไฟล์ใน Drive */
async function putToDrive(target: { bookId: string; kind: FileKind } | { outId: string }, name: string, body: Blob): Promise<string> {
  const s = await fetch(withBase("/saraban/api/upload-session"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...target, name, size: body.size }),
  }).catch(() => null);
  const sj = (await s?.json().catch(() => null)) as { uploadUrl?: string; error?: string } | null;
  // ข้อความจาก route ของเราเป็นภาษาไทย — ข้อความอื่น (เช่นจาก proxy/แพลตฟอร์ม) ไม่แสดงผู้ใช้
  if (!s?.ok || !sj?.uploadUrl) throw new Error(safeMessage(sj?.error, "เปิดการอัปโหลดไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่"));

  const put = await fetch(sj.uploadUrl, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body }).catch(() => null);
  const pj = (await put?.json().catch(() => null)) as { id?: string } | null;
  if (!put?.ok || !pj?.id) throw new Error("อัปโหลดไฟล์ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่");
  return pj.id;
}
