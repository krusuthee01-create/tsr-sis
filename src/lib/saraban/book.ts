// ข้อมูลหน้าหนังสือและฟังก์ชันล้วน (ใช้ได้ทั้งเซิร์ฟเวอร์/เบราว์เซอร์ และทดสอบด้วย node ได้)
import type { BookStatus, FileKind, SarabanRole, Urgency } from "./types.ts";

export type BookFile = { id: string; kind: FileKind; version: number; name: string; size_bytes: number; created_at: string };
export type BookAction = {
  id: number; action: string; actor: string | null; actor_name: string | null; note: string | null;
  file_id: string | null; targets: string[]; created_at: string;
};
export type BookRecipient = { staff_id: string; name: string; read_at: string | null; assigned_by: string | null; assigned_at: string };
export type BookRow = {
  id: string; year: number; receive_no: number; doc_no: string | null; doc_date: string | null; from_org: string;
  to_text: string | null; subject: string; urgency: Urgency; secret: boolean; due_date: string | null;
  status: BookStatus; current_holder: string | null; holder_name: string | null; received_at: string; created_by: string | null;
};
export type BookDetail = { book: BookRow; files: BookFile[]; actions: BookAction[]; recipients: BookRecipient[] };
export type StaffOption = { id: string; name: string; saraban_role: SarabanRole; work_group: string | null };
export type Preset = { id: number; role: PresetRole; text: string; sort: number };
export type PresetRole = "clerk" | "director" | "head";

export const PRESET_ROLES: readonly PresetRole[] = ["director", "clerk", "head"];

/** คำสั่งสำเร็จรูปตั้งต้น (ใช้เมื่อยังไม่ได้ตั้งค่าในหน้าตั้งค่า) */
export const DEFAULT_PRESETS: Record<PresetRole, string[]> = {
  clerk: ["เรียน ผู้อำนวยการ เพื่อโปรดทราบ", "เรียน ผู้อำนวยการ เพื่อโปรดพิจารณา", "เรียน ผู้อำนวยการ เพื่อโปรดพิจารณาสั่งการ"],
  director: ["ทราบ ดำเนินการ", "ทราบ แจ้งผู้เกี่ยวข้อง", "อนุญาต", "ทราบ/จัดเก็บ"],
  head: ["ดำเนินการตามหนังสือ", "แจ้งเพื่อทราบ", "ดำเนินการและรายงานผล"],
};

export const ACTION_LABEL: Record<string, string> = {
  register: "ลงรับ",
  propose: "เสนอ ผอ.",
  endorse: "เกษียนสั่งการ",
  forward: "มอบหมาย",
  close: "ทราบ/จัดเก็บ",
  read: "อ่านแล้ว",
  renumber: "แก้เลขรับ",
  delete: "ลบ",
  upload: "แนบไฟล์",
};

export const FILE_KIND_LABEL: Record<FileKind, string> = {
  original: "ต้นฉบับ",
  stamped: "ฉบับประทับตรา/เกษียน",
  attachment: "สิ่งที่ส่งมาด้วย",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/** ไฟล์ที่ใช้แสดง/ลงนาม: ฉบับประทับตรารุ่นล่าสุด ถ้าไม่มีใช้ต้นฉบับรุ่นล่าสุด ไม่มีเลยคืน null */
export function latestFile<T extends { kind: string; version: number }>(files: readonly T[]): T | null {
  const top = (kind: string) =>
    files.filter((f) => f.kind === kind).reduce<T | null>((best, f) => (!best || f.version > best.version ? f : best), null);
  return top("stamped") ?? top("original");
}

/** หน้า A4 (point) */
export const A4 = { width: 595.28, height: 841.89 } as const;

/**
 * ตำแหน่งคำเกษียน (point จากมุมซ้ายล่าง) เว้นขอบ 18pt — ธุรการวางซ้ายล่าง ผอ. วางขวาล่างของหน้าแรก จึงไม่ทับกัน
 * ถ้าภาพสูงเกิน 40% ของหน้าแรก (บังเนื้อหามากไป) หรือ newPage (หัวหน้ากลุ่มงาน) ให้เพิ่มหน้า A4 ท้ายไฟล์แล้ววางมุมบนด้านเดียวกัน
 * ภาพกว้าง/สูงเกินหน้าจะย่อลงตามสัดส่วน — pageCount = จำนวนหน้าเดิม (หน้าใหม่คือ index นี้)
 */
export function endorsementPlacement(
  page: { width: number; height: number },
  png: { width: number; height: number },
  pageCount: number,
  opts: { side?: "left" | "right"; newPage?: boolean; margin?: number } = {},
): { appendPage: boolean; box: { page: number; x: number; y: number; width: number; height: number } } {
  const margin = opts.margin ?? 18;
  const left = opts.side === "left";
  if (opts.newPage || png.height > page.height * 0.4) {
    const k = Math.min(1, (A4.width - margin * 2) / png.width, (A4.height - margin * 2) / png.height);
    const width = png.width * k, height = png.height * k;
    const x = left ? margin : A4.width - width - margin;
    return { appendPage: true, box: { page: pageCount, x, y: A4.height - height - margin, width, height } };
  }
  const k = Math.min(1, (page.width - margin * 2) / png.width);
  const width = png.width * k, height = png.height * k;
  const x = left ? margin : page.width - width - margin;
  return { appendPage: false, box: { page: 0, x, y: margin, width, height } };
}

/**
 * ที่อยู่เว็บ (origin) สำหรับลิงก์ในข้อความ LINE: NEXT_PUBLIC_SITE_URL ก่อน (ตัด /sis และ / ท้าย)
 * ไม่ได้ตั้งค่าจึงใช้ Origin ของคำขอ → X-Forwarded-Host — คืน null ถ้าหาไม่ได้
 */
export function siteOrigin(
  h: { origin?: string | null; forwardedHost?: string | null; forwardedProto?: string | null },
  envSite?: string | null,
): string | null {
  const parse = (s: string | null | undefined) => {
    if (!s) return null;
    try {
      const u = new URL(s);
      return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
    } catch {
      return null;
    }
  };
  const fromEnv = parse(envSite?.trim().replace(/\/+$/, "").replace(/\/sis$/, ""));
  if (fromEnv) return fromEnv;
  const fromOrigin = parse(h.origin);
  if (fromOrigin) return fromOrigin;
  const host = h.forwardedHost?.split(",")[0].trim();
  if (host && /^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) {
    const proto = h.forwardedProto?.split(",")[0].trim() === "http" ? "http" : "https";
    return `${proto}://${host}`;
  }
  return null;
}

/**
 * ข้อความผิดพลาดที่แสดงผู้ใช้ได้: เฉพาะข้อความภาษาไทยที่ระบบเขียนเอง
 * ข้อความจากไลบรารี/Drive/Supabase (อังกฤษ) ไม่ส่งถึงผู้ใช้ ใช้ fallback แทน
 */
export function safeMessage(err: unknown, fallback: string): string {
  const m = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return m && /[\u0E00-\u0E7F]/.test(m) ? m.slice(0, 300) : fallback;
}

/** ตรวจรายการผู้รับจาก client: uuid ไม่ซ้ำ ไม่เกิน 200 คน — ผิดรูปคืน null */
export function parseTargets(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length > 200 || !v.every(isUuid)) return null;
  return [...new Set(v as string[])];
}

/** หมายเหตุ/คำสั่ง: ข้อความไม่เกิน 1000 ตัวอักษร (null/undefined = ว่าง) — ผิดชนิดคืน null */
export function parseNote(v: unknown): string | null {
  if (v == null) return "";
  if (typeof v !== "string") return null;
  return v.trim().slice(0, 1000);
}
