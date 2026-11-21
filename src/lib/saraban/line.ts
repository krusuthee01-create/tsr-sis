// แจ้งเตือนกลุ่ม LINE ของครู (Messaging API) — ไม่พึ่ง web-push เพื่อให้ทดสอบด้วย node ได้
import { URGENCY_LABEL, type Urgency } from "./types.ts";

const LINE_MAX = 5000;

export type LineBook = {
  receiveNo: number;
  year: number;
  subject: string;
  fromOrg: string;
  urgency: Urgency;
  secret: boolean;
  command: string;
  assignees: string[];
  url: string;
};

/** สร้างข้อความแจ้งกลุ่ม LINE (หนังสือลับไม่เผยชื่อเรื่อง) */
export function formatLineMessage(b: LineBook): string {
  const head = `📥 หนังสือรับที่ ${b.receiveNo}/${b.year}` + (b.urgency > 0 ? ` [${URGENCY_LABEL[b.urgency]}]` : "");
  const lines = [
    head,
    `เรื่อง: ${b.secret ? "หนังสือลับ" : b.subject}`,
    `จาก: ${b.fromOrg}`,
    `ผอ. สั่งการ: ${b.command}`,
  ];
  if (b.assignees.length > 0) lines.push(`ผู้รับผิดชอบ: ${b.assignees.join(", ")}`);
  const tail = b.url;
  // ตัดส่วนเนื้อหาให้เหลือที่สำหรับลิงก์ท้ายข้อความเสมอ
  let body = lines.join("\n");
  const room = LINE_MAX - tail.length - 1;
  if (body.length > room) body = body.slice(0, Math.max(0, room - 1)) + "…";
  return `${body}\n${tail}`.slice(0, LINE_MAX);
}

/** ส่งข้อความเข้ากลุ่ม LINE — ไม่ throw; คืน true เมื่อส่งสำเร็จ */
export async function pushLineGroup(text: string): Promise<boolean> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const to = process.env.LINE_GROUP_ID;
  if (!token || !to) return false;
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to, messages: [{ type: "text", text: text.slice(0, LINE_MAX) }] }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
