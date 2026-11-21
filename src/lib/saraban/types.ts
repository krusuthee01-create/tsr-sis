// ชนิดข้อมูลและป้ายภาษาไทยของโมดูลสารบรรณ (ใช้ได้ทั้งฝั่งเซิร์ฟเวอร์และเบราว์เซอร์)

export type SarabanRole = "director" | "clerk" | "head" | "teacher";
export type Urgency = 0 | 1 | 2 | 3;
export type BookStatus = "registered" | "proposed" | "endorsed" | "assigned" | "closed";
export type FileKind = "original" | "stamped" | "attachment";

export const URGENCY_LABEL: Record<Urgency, string> = {
  0: "ปกติ",
  1: "ด่วน",
  2: "ด่วนมาก",
  3: "ด่วนที่สุด",
};

export const STATUS_LABEL: Record<BookStatus, string> = {
  registered: "ลงรับแล้ว",
  proposed: "เสนอ ผอ.",
  endorsed: "มอบหัวหน้า",
  assigned: "มอบหมายแล้ว",
  closed: "ปิดเรื่อง",
};

export const ROLE_LABEL: Record<SarabanRole, string> = {
  director: "ผู้อำนวยการ",
  clerk: "ธุรการ",
  head: "หัวหน้ากลุ่มงาน",
  teacher: "ครู",
};

export const FILE_KINDS: readonly FileKind[] = ["original", "stamped", "attachment"];

/** ขนาด PDF สูงสุดที่รับ */
export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
