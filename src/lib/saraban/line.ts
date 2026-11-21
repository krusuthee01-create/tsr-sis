// แจ้งเตือนกลุ่ม LINE ของครู (Messaging API) — ไม่พึ่ง web-push เพื่อให้ทดสอบด้วย node ได้
import { URGENCY_LABEL, type Urgency } from "./types.ts";

const LINE_MAX = 5000;

/**
 * ส่ง LINE เฉพาะหนังสือที่ด่วนถึงระดับนี้ (ค่าเริ่มต้น 3 = ด่วนที่สุด)
 * เหตุผล: LINE นับโควตาตามจำนวนสมาชิกกลุ่ม — 1 เล่มเข้ากลุ่มครู 35 คน = 35 ข้อความ
 * ส่งทุกเล่มจะเกินแพ็กเกจฟรีในไม่กี่วัน เล่มอื่นแจ้งรายบุคคลทาง Web Push (ฟรี) แทน
 * ปรับได้ด้วย env SARABAN_LINE_MIN_URGENCY = 0–3 (0 = ทุกเล่ม)
 */
export function lineMinUrgency(raw = process.env.SARABAN_LINE_MIN_URGENCY): Urgency {
  const n = Number(raw);
  return raw !== undefined && raw.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= 3 ? (n as Urgency) : 3;
}

/** ควรแจ้งกลุ่ม LINE หรือไม่: RPC บอกว่าเป็นการสั่งการ (line) และความเร่งด่วนถึงเกณฑ์ */
export function shouldPostToLine(line: boolean, urgency: number, min: Urgency = lineMinUrgency()): boolean {
  return line && urgency >= min;
}

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

/**
 * สร้างข้อความแจ้งกลุ่ม LINE
 * หนังสือลับ: กลุ่ม LINE มีครูทั้งโรงเรียน — ไม่เผยเรื่อง หน่วยงาน ข้อสั่งการ หรือชื่อผู้รับผิดชอบ (เหลือเลขรับ ความเร่งด่วน ลิงก์)
 */
export function formatLineMessage(b: LineBook): string {
  const head = `📥 หนังสือรับที่ ${b.receiveNo}/${b.year}` + (b.urgency > 0 ? ` [${URGENCY_LABEL[b.urgency]}]` : "");
  const lines = b.secret
    ? [head, "หนังสือลับ — โปรดดูในระบบ"]
    : [head, `เรื่อง: ${b.subject}`, `จาก: ${b.fromOrg}`, `ผอ. สั่งการ: ${b.command}`];
  if (!b.secret && b.assignees.length > 0) lines.push(`ผู้รับผิดชอบ: ${b.assignees.join(", ")}`);
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
