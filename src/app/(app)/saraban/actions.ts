"use server";

import { after } from "next/server";
import { headers } from "next/headers";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { withBase } from "@/lib/base-path";
import { isUuid, parseNote, parseTargets, siteOrigin, PRESET_ROLES, type PresetRole } from "@/lib/saraban/book";
import { formatLineMessage, pushLineGroup, shouldPostToLine } from "@/lib/saraban/line";
import { pushToStaff } from "@/lib/saraban/push";
import { DriveSetupError, driveFolderId, getFileMeta } from "@/lib/saraban/drive";
import { FILE_KINDS, MAX_UPLOAD_BYTES, type FileKind, type Urgency } from "@/lib/saraban/types";
import { parseRegisterInput, validateRegister, type RegisterInput } from "@/lib/saraban/register";
import type { PostgrestError } from "@supabase/supabase-js";

type FileResult = { ok: true; fileId: string } | { ok: false; error: string };

/**
 * บันทึกไฟล์ที่เบราว์เซอร์อัปโหลดเข้า Drive เสร็จแล้ว
 * ยืนยันจาก metadata ของ Drive (appProperties ตั้งโดยเซิร์ฟเวอร์ตอนเปิด session เบราว์เซอร์แก้ไม่ได้):
 * อยู่ในโฟลเดอร์สารบรรณ, เป็นของเล่มนี้, ชนิดตรง, ผู้อัปโหลดคือผู้ใช้คนนี้ — กันการส่ง driveFileId ของไฟล์อื่นมาแอบผูก
 */
export async function finalizeUpload(bookId: string, kind: FileKind, driveFileId: string): Promise<FileResult> {
  if (typeof bookId !== "string" || typeof driveFileId !== "string" || !driveFileId) return { ok: false, error: "ข้อมูลไฟล์ไม่ถูกต้อง" };
  if (!FILE_KINDS.includes(kind)) return { ok: false, error: "ชนิดไฟล์ไม่ถูกต้อง" };
  const sb = await supabaseServer();
  const [{ data: staffId }, { data: allowed }] = await Promise.all([
    sb.rpc("my_staff_id"),
    // ตรวจสิทธิ์ซ้ำ ณ ตอนบันทึก (สถานะเล่มอาจเปลี่ยนระหว่างอัปโหลด)
    sb.rpc("saraban_can_upload", { p_book: bookId, p_kind: kind }),
  ]);
  if (typeof staffId !== "string") return { ok: false, error: "กรุณาเข้าสู่ระบบ" };
  if (allowed !== true) return { ok: false, error: "ไม่มีสิทธิ์อัปโหลดไฟล์ของหนังสือนี้" };

  let meta;
  let folderId: string;
  try {
    folderId = await driveFolderId();
    meta = await getFileMeta(driveFileId);
  } catch (e) {
    if (e instanceof DriveSetupError) return { ok: false, error: e.message };
    return { ok: false, error: "ไม่พบไฟล์ที่อัปโหลด กรุณาอัปโหลดใหม่" };
  }
  const p = meta.appProperties;
  if (!meta.parents.includes(folderId) || p.bookId !== bookId || p.kind !== kind || p.uploader !== staffId) {
    return { ok: false, error: "ไฟล์ไม่ตรงกับหนังสือนี้ กรุณาอัปโหลดใหม่" };
  }
  if (meta.size <= 0 || meta.size > MAX_UPLOAD_BYTES) return { ok: false, error: "ขนาดไฟล์ไม่ถูกต้อง (ต้องไม่เกิน 30 MB)" };

  const admin = supabaseAdmin();
  // ไฟล์เดียวกันบันทึกซ้ำไม่ได้ (กดซ้ำ/ส่งซ้ำ)
  const { data: dup } = await admin.from("saraban_files").select("id").eq("drive_file_id", meta.id).limit(1);
  if (dup?.length) return { ok: false, error: "ไฟล์นี้บันทึกไว้แล้ว" };

  const { data: fileId, error } = await admin.rpc("saraban_add_file", {
    p_book: bookId,
    p_kind: kind,
    p_drive_file_id: meta.id,
    p_name: meta.name,
    p_size: meta.size,
    p_actor: staffId,
  });
  if (error || typeof fileId !== "string") {
    console.error("saraban_add_file", error);
    return { ok: false, error: "บันทึกไฟล์ไม่สำเร็จ กรุณาลองใหม่" };
  }
  return { ok: true, fileId };
}

type RegisterResult =
  | { ok: true; id: string; receiveNo: number; year: number; receivedAt: string }
  | { ok: false; error: string };

/** แปลงข้อผิดพลาดจาก RPC เป็นภาษาไทย: ข้อความจาก raise exception (P0001) เป็นภาษาไทยอยู่แล้ว ส่งต่อได้ */
function thaiError(error: PostgrestError, fallback: string): string {
  console.error("saraban rpc", error);
  if (error.code === "P0001" && error.message) return error.message;
  if (error.code === "23505") return "เลขรับนี้มีแล้วในปีนี้ กรุณาใช้เลขอื่น";
  if (error.code === "22P02" || error.code === "22007" || error.code === "22008") return "ข้อมูลวันที่หรือตัวเลขไม่ถูกต้อง";
  return fallback;
}

/** ลงรับหนังสือ (ผอ./ธุรการ) — RPC ตรวจสิทธิ์และออกเลขรับ */
export async function registerBook(raw: RegisterInput): Promise<RegisterResult> {
  // ตรวจชนิดข้อมูลจริง (เรียก server action ตรงได้โดยไม่ผ่านฟอร์ม)
  const parsed = parseRegisterInput(raw);
  if (!parsed.ok) return parsed;
  const input = parsed.input;
  const errors = validateRegister(input);
  const first = Object.values(errors)[0];
  if (first) return { ok: false, error: first };

  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("saraban_register", {
    p: {
      doc_no: input.docNo.trim(),
      doc_date: input.docDate || null,
      from_org: input.fromOrg.trim(),
      to_text: input.toText.trim(),
      subject: input.subject.trim(),
      urgency: input.urgency,
      secret: !!input.secret,
      due_date: input.dueDate || null,
      receive_no: input.receiveNo ?? null,
    },
  });
  if (error) return { ok: false, error: thaiError(error, "ลงรับไม่สำเร็จ กรุณาลองใหม่") };
  const r = data as { id: string; year: number; receive_no: number };
  // เวลาลงรับจริงจากฐานข้อมูล (ใช้พิมพ์บนตรารับ)
  const { data: book } = await sb.from("saraban_books").select("received_at").eq("id", r.id).maybeSingle();
  return { ok: true, id: r.id, receiveNo: r.receive_no, year: r.year, receivedAt: book?.received_at ?? new Date().toISOString() };
}

export type DuplicateBook = { id: string; receive_no: number; subject: string; received_at: string };

/** หนังสือปีนี้ที่เลขที่หนังสือซ้ำ (ใช้เตือนใต้ช่องเลขที่หนังสือ) */
export async function findDuplicates(docNo: string, fromOrg: string): Promise<DuplicateBook[]> {
  if (typeof docNo !== "string" || !docNo.trim()) return [];
  if (fromOrg != null && typeof fromOrg !== "string") return [];
  fromOrg = fromOrg ?? "";
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("saraban_find_duplicates", { p_doc_no: docNo.slice(0, 100), p_from_org: fromOrg.slice(0, 300) });
  if (error) {
    console.error("saraban_find_duplicates", error);
    return [];
  }
  return (data ?? []) as DuplicateBook[];
}

/** รายชื่อหน่วยงานที่เคยส่งหนังสือ (เติมช่อง "จาก" อัตโนมัติ) */
export async function orgSuggestions(q: string): Promise<string[]> {
  if (typeof q !== "string") return [];
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("saraban_org_suggestions", { p_q: q.slice(0, 100) });
  if (error) {
    console.error("saraban_org_suggestions", error);
    return [];
  }
  return (data ?? []) as string[];
}

export type InboxRow = {
  id: string; year: number; receive_no: number; doc_no: string | null; subject: string; from_org: string;
  urgency: number; secret: boolean; due_date: string | null; status: string; received_at: string;
  holder_name: string | null; unread: boolean; total: number;
};

/** รายการหนังสือหน้าถัดไป (ปุ่ม "โหลดเพิ่ม") */
export async function loadInbox(q: string, filter: "all" | "todo" | "unread", offset: number): Promise<{ ok: true; rows: InboxRow[] } | { ok: false; error: string }> {
  if (typeof q !== "string" || !["all", "todo", "unread"].includes(filter) || typeof offset !== "number") {
    return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  }
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("saraban_inbox", { p_q: q.slice(0, 200) || null, p_filter: filter, p_offset: Math.max(0, Math.floor(offset) || 0) });
  if (error) return { ok: false, error: thaiError(error, "โหลดรายการไม่สำเร็จ") };
  return { ok: true, rows: (data ?? []) as InboxRow[] };
}

// ---------- ขั้นตอนงานในหน้าหนังสือ ----------

type ActionResult = { ok: true } | { ok: false; error: string };
const BAD_INPUT: ActionResult = { ok: false, error: "ข้อมูลไม่ถูกต้อง กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง" };

/** ที่อยู่เต็มของหน้าหนังสือ (ลิงก์ในข้อความ LINE) — หา origin ไม่ได้ใช้ path */
async function bookUrl(bookId: string): Promise<string> {
  const h = await headers();
  const origin = siteOrigin(
    { origin: h.get("origin"), forwardedHost: h.get("x-forwarded-host"), forwardedProto: h.get("x-forwarded-proto") },
    process.env.NEXT_PUBLIC_SITE_URL,
  );
  return (origin ?? "") + withBase(`/saraban/book/${bookId}`);
}

type NotifyBook = { receive_no: number; year: number; subject: string; from_org: string; urgency: Urgency; secret: boolean };

/** ข้อมูลหนังสือและชื่อผู้รับสำหรับข้อความแจ้งเตือน (อ่านด้วย service role หลัง RPC ตรวจสิทธิ์ผ่านแล้ว) */
async function notifyData(bookId: string, staffIds: string[]) {
  const admin = supabaseAdmin();
  const [{ data: book }, { data: staff }] = await Promise.all([
    admin.from("saraban_books").select("receive_no, year, subject, from_org, urgency, secret").eq("id", bookId).maybeSingle(),
    staffIds.length
      ? admin.from("staff").select("id, prefix, first_name, last_name").in("id", staffIds)
      : Promise.resolve({ data: [] as { id: string; prefix: string | null; first_name: string; last_name: string | null }[] }),
  ]);
  const names = new Map((staff ?? []).map((s) => [s.id, [s.prefix, s.first_name, s.last_name].filter(Boolean).join(" ")]));
  return { book: book as NotifyBook | null, names: staffIds.map((id) => names.get(id)).filter((n): n is string => !!n) };
}

/** ข้อความแจ้งเตือนบนหน้าจอล็อก: หนังสือลับไม่เผยชื่อเรื่อง */
function pushBody(b: NotifyBook) {
  return `รับที่ ${b.receive_no}/${b.year}: ${b.secret ? "หนังสือลับ" : b.subject}`.slice(0, 200);
}

/** ส่งแจ้งเตือนหลังตอบผู้ใช้แล้ว — แจ้งเตือนล้มเหลวต้องไม่ทำให้การทำงานล้มเหลว */
function notifyLater(label: string, fn: () => Promise<void>) {
  after(async () => {
    try {
      await fn();
    } catch (e) {
      console.error("saraban notify", label, e);
    }
  });
}

/** ธุรการเสนอ ผอ. */
export async function proposeBook(bookId: string, note: string, fileId: string | null): Promise<ActionResult> {
  const n = parseNote(note);
  if (!isUuid(bookId) || n === null || (fileId != null && !isUuid(fileId))) return BAD_INPUT;
  const sb = await supabaseServer();
  const { error } = await sb.rpc("saraban_propose", { p_book: bookId, p_note: n || null, p_file: fileId ?? null });
  if (error) return { ok: false, error: thaiError(error, "เสนอหนังสือไม่สำเร็จ กรุณาลองใหม่") };

  const url = withBase(`/saraban/book/${bookId}`);
  notifyLater("propose", async () => {
    const { data: holder } = await supabaseAdmin().from("saraban_books").select("current_holder").eq("id", bookId).maybeSingle();
    if (!holder?.current_holder) return;
    const { book } = await notifyData(bookId, []);
    if (!book) return;
    await pushToStaff([holder.current_holder], { title: "มีหนังสือเสนอเพื่อเกษียน", body: pushBody(book), url });
  });
  return { ok: true };
}

/** ผอ. เกษียน: มอบหัวหน้ากลุ่มงาน / มอบครูโดยตรง / ทราบ-จัดเก็บ */
export async function endorseBook(
  bookId: string,
  route: "head" | "teachers" | "close",
  note: string,
  targets: string[],
  fileId: string | null,
): Promise<ActionResult> {
  const n = parseNote(note);
  const t = parseTargets(targets ?? []);
  if (!isUuid(bookId) || n === null || t === null || !["head", "teachers", "close"].includes(route)) return BAD_INPUT;
  if (fileId != null && !isUuid(fileId)) return BAD_INPUT;
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("saraban_endorse", {
    p_book: bookId, p_route: route, p_note: n || null, p_targets: route === "close" ? [] : t, p_file: fileId ?? null,
  });
  if (error) return { ok: false, error: thaiError(error, "เกษียนหนังสือไม่สำเร็จ กรุณาลองใหม่") };

  const line = (data as { line?: boolean } | null)?.line === true;
  if (route !== "close") {
    const url = await bookUrl(bookId);
    notifyLater("endorse", async () => {
      const { book, names } = await notifyData(bookId, t);
      if (!book) return;
      // LINE เฉพาะเล่มด่วนที่สุด (โควตานับตามจำนวนสมาชิกกลุ่ม) — ผู้รับทุกเล่มได้ Web Push ด้านล่างอยู่แล้ว
      if (shouldPostToLine(line, book.urgency)) {
        try {
          // หนังสือลับ: ไม่ส่งเนื้อหาเข้าตัวจัดรูปแบบเลย (กันพลาดซ้ำสองชั้น)
          const s = book.secret;
          await pushLineGroup(formatLineMessage({
            receiveNo: book.receive_no, year: book.year, subject: s ? "" : book.subject, fromOrg: s ? "" : book.from_org,
            urgency: book.urgency, secret: s, command: s ? "" : n, assignees: s ? [] : names, url,
          }));
        } catch (e) {
          console.error("saraban line", e);
        }
      }
      await pushToStaff(t, {
        title: route === "head" ? "มีหนังสือรอมอบหมาย" : "มีหนังสือมอบหมายถึงคุณ",
        body: pushBody(book),
        url: withBase(`/saraban/book/${bookId}`),
      });
    });
  }
  return { ok: true };
}

/** หัวหน้ากลุ่มงานมอบหมายครูในกลุ่ม */
export async function forwardBook(bookId: string, note: string, targets: string[], fileId: string | null): Promise<ActionResult> {
  const n = parseNote(note);
  const t = parseTargets(targets ?? []);
  if (!isUuid(bookId) || n === null || t === null || (fileId != null && !isUuid(fileId))) return BAD_INPUT;
  const sb = await supabaseServer();
  const { error } = await sb.rpc("saraban_forward", { p_book: bookId, p_note: n || null, p_targets: t, p_file: fileId ?? null });
  if (error) return { ok: false, error: thaiError(error, "มอบหมายไม่สำเร็จ กรุณาลองใหม่") };

  const url = withBase(`/saraban/book/${bookId}`);
  notifyLater("forward", async () => {
    const { book } = await notifyData(bookId, []);
    if (!book) return;
    await pushToStaff(t, { title: "มีหนังสือมอบหมายถึงคุณ", body: pushBody(book), url });
  });
  return { ok: true };
}

/** ผู้รับเปิดอ่าน (บันทึกครั้งแรกเท่านั้น) */
export async function markRead(bookId: string): Promise<ActionResult> {
  if (!isUuid(bookId)) return BAD_INPUT;
  const sb = await supabaseServer();
  const { error } = await sb.rpc("saraban_mark_read", { p_book: bookId });
  if (error) return { ok: false, error: thaiError(error, "บันทึกการอ่านไม่สำเร็จ") };
  return { ok: true };
}

/** ลบหนังสือ (soft delete) ต้องระบุเหตุผล */
export async function deleteBook(bookId: string, reason: string): Promise<ActionResult> {
  if (!isUuid(bookId) || typeof reason !== "string") return BAD_INPUT;
  const r = reason.trim().slice(0, 500);
  if (!r) return { ok: false, error: "กรุณาระบุเหตุผลที่ลบ" };
  const sb = await supabaseServer();
  const { error } = await sb.rpc("saraban_delete", { p_book: bookId, p_reason: r });
  if (error) return { ok: false, error: thaiError(error, "ลบหนังสือไม่สำเร็จ กรุณาลองใหม่") };
  return { ok: true };
}

/** แก้เลขทะเบียนรับ */
export async function renumberBook(bookId: string, no: number): Promise<ActionResult> {
  if (!isUuid(bookId)) return BAD_INPUT;
  if (typeof no !== "number" || !Number.isInteger(no) || no < 1 || no > 999_999_999) {
    return { ok: false, error: "เลขรับต้องเป็นจำนวนเต็มมากกว่า 0" };
  }
  const sb = await supabaseServer();
  const { error } = await sb.rpc("saraban_renumber", { p_book: bookId, p_no: no });
  if (error) return { ok: false, error: thaiError(error, "แก้เลขรับไม่สำเร็จ กรุณาลองใหม่") };
  return { ok: true };
}

// ---------- ตั้งค่า ----------

/** เพิ่มคำสั่งสำเร็จรูป (ผอ./ธุรการ — RLS ตรวจซ้ำ) */
export async function savePreset(role: PresetRole, text: string): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  if (!PRESET_ROLES.includes(role) || typeof text !== "string") return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  const t = text.trim();
  if (!t) return { ok: false, error: "กรุณาพิมพ์ข้อความ" };
  if (t.length > 300) return { ok: false, error: "ข้อความยาวเกิน 300 ตัวอักษร" };
  const sb = await supabaseServer();
  const { data: last } = await sb.from("saraban_presets").select("sort").eq("role", role).order("sort", { ascending: false }).limit(1);
  const { data, error } = await sb.from("saraban_presets")
    .insert({ role, text: t, sort: (last?.[0]?.sort ?? 0) + 1 }).select("id").maybeSingle();
  if (error) {
    console.error("saraban_presets insert", error);
    return { ok: false, error: error.code === "42501" ? "เฉพาะผู้อำนวยการและธุรการแก้คำสั่งสำเร็จรูปได้" : "บันทึกไม่สำเร็จ กรุณาลองใหม่" };
  }
  if (!data) return { ok: false, error: "บันทึกไม่สำเร็จ กรุณาลองใหม่" };
  return { ok: true, id: data.id as number };
}

/** ลบคำสั่งสำเร็จรูป */
export async function deletePreset(id: number): Promise<ActionResult> {
  if (typeof id !== "number" || !Number.isInteger(id) || id < 1) return BAD_INPUT;
  const sb = await supabaseServer();
  const { data, error } = await sb.from("saraban_presets").delete().eq("id", id).select("id");
  if (error) {
    console.error("saraban_presets delete", error);
    return { ok: false, error: "ลบไม่สำเร็จ กรุณาลองใหม่" };
  }
  if (!data?.length) return { ok: false, error: "เฉพาะผู้อำนวยการและธุรการแก้คำสั่งสำเร็จรูปได้" };
  return { ok: true };
}

/** บันทึก Web Push subscription ของอุปกรณ์นี้ให้ผู้ใช้ปัจจุบัน */
export async function savePushSubscription(sub: PushSubscriptionJSON): Promise<ActionResult> {
  const endpoint = sub?.endpoint;
  const p256dh = sub?.keys?.p256dh;
  const auth = sub?.keys?.auth;
  if (typeof endpoint !== "string" || !/^https:\/\/\S{10,2000}$/.test(endpoint)) return BAD_INPUT;
  if (typeof p256dh !== "string" || typeof auth !== "string" || !p256dh || !auth || p256dh.length > 200 || auth.length > 100) return BAD_INPUT;
  const sb = await supabaseServer();
  const { data: staffId } = await sb.rpc("my_staff_id");
  if (typeof staffId !== "string") return { ok: false, error: "กรุณาเข้าสู่ระบบ" };
  const row = { endpoint, staff_id: staffId, p256dh, auth };
  let { error } = await sb.from("push_subscriptions").upsert(row, { onConflict: "endpoint" });
  if (error?.code === "42501") {
    // เครื่องเดียวกันเคยสมัครไว้ให้บัญชีอื่น (ใช้เครื่องร่วมกัน): ผู้ถือ endpoint คืออุปกรณ์นี้ จึงย้ายมาเป็นของผู้ใช้ปัจจุบัน
    await supabaseAdmin().from("push_subscriptions").delete().eq("endpoint", endpoint);
    ({ error } = await sb.from("push_subscriptions").insert(row));
  }
  if (error) {
    console.error("push_subscriptions upsert", error);
    return { ok: false, error: "เปิดการแจ้งเตือนไม่สำเร็จ กรุณาลองใหม่" };
  }
  return { ok: true };
}
