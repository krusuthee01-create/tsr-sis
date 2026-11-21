// ข้อความแจ้งเตือนครบกำหนด (ฟังก์ชันล้วน) — หนังสือลับไม่เผยชื่อเรื่องบนหน้าจอล็อก
export function formatReminderBody(items: { subject: string; secret: boolean }[]): string {
  const first = items[0].secret ? "หนังสือลับ" : items[0].subject;
  return `${items.length} เรื่องรอดำเนินการ: ${first}${items.length > 1 ? "…" : ""}`;
}
