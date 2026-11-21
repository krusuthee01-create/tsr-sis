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

/** ชนิดหนังสือตามระเบียบสำนักนายกรัฐมนตรีว่าด้วยงานสารบรรณ */
export type DocType = "external" | "internal" | "stamped" | "order" | "announce" | "record";
export const DOC_TYPES: readonly DocType[] = ["external", "internal", "stamped", "order", "announce", "record"];
export const DOC_TYPE_LABEL: Record<DocType, string> = {
  external: "หนังสือภายนอก",
  internal: "หนังสือภายใน",
  stamped: "หนังสือประทับตรา",
  order: "หนังสือสั่งการ",
  announce: "หนังสือประชาสัมพันธ์",
  record: "หนังสือที่เจ้าหน้าที่ทำขึ้นหรือรับไว้เป็นหลักฐาน",
};

export const FILE_KINDS: readonly FileKind[] = ["original", "stamped", "attachment"];

/** ขนาด PDF สูงสุดที่รับ */
export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
