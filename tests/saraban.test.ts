// ทดสอบ src/lib/saraban/*: npm test (ข้อมูลสมมติทั้งหมด)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServiceJwt, createUploadSession, getFileMeta } from "../src/lib/saraban/drive.ts";
import { formatReminderBody } from "../src/lib/saraban/push-text.ts";
import { embedPng, endorsementLines, pngSizePt, receiveStampLines } from "../src/lib/saraban/stamp.ts";
import { PDFDocument } from "pdf-lib";
import { formatLineMessage, pushLineGroup } from "../src/lib/saraban/line.ts";

const b64urlJson = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

test("JWT ของ service account (RS256)", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const jwt = buildServiceJwt("sa@example.iam.gserviceaccount.com", pem, 1_700_000_000);
  const parts = jwt.split(".");
  assert.equal(parts.length, 3);
  assert.deepEqual(b64urlJson(parts[0]), { alg: "RS256", typ: "JWT" });
  const payload = b64urlJson(parts[1]);
  assert.equal(payload.exp - payload.iat, 3600);
  assert.equal(payload.iat, 1_700_000_000);
  assert.equal(payload.iss, "sa@example.iam.gserviceaccount.com");
  assert.equal(payload.scope, "https://www.googleapis.com/auth/drive");
  assert.equal(payload.aud, "https://oauth2.googleapis.com/token");
  const v = createVerify("RSA-SHA256");
  v.update(`${parts[0]}.${parts[1]}`);
  assert.ok(v.verify(publicKey, Buffer.from(parts[2], "base64url")));
});

test("JWT: private key จาก env ที่มี \\n แบบตัวอักษร", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString().replace(/\n/g, "\\n");
  assert.equal(buildServiceJwt("a@b.c", pem, 1).split(".").length, 3);
});

test("Drive โหมดจำลอง: เปิด session แล้วอ่าน metadata", async () => {
  const dir = mkdtempSync(join(tmpdir(), "saraban-fake-"));
  process.env.SARABAN_DRIVE_FAKE_DIR = dir;
  process.env.SARABAN_DRIVE_FOLDER_ID = "folder-test";
  try {
    const appProperties = { bookId: "11111111-1111-1111-1111-111111111111", kind: "original", uploader: "22222222-2222-2222-2222-222222222222" };
    const url = await createUploadSession({ name: "หนังสือทดสอบ.pdf", size: 1234, mime: "application/pdf", origin: "http://x", appProperties });
    assert.ok(url.startsWith("http://x/sis/saraban/api/fake-drive/"), url);
    const id = url.split("/").pop()!;
    const meta = await getFileMeta(id);
    assert.equal(meta.id, id);
    assert.equal(meta.name, "หนังสือทดสอบ.pdf");
    assert.deepEqual(meta.appProperties, appProperties);
    assert.deepEqual(meta.parents, ["folder-test"]);
    // id แปลก (เช่น ../) ต้องถูกปฏิเสธ ไม่อ่านไฟล์นอกโฟลเดอร์
    await assert.rejects(getFileMeta("../etc/passwd"));
  } finally {
    delete process.env.SARABAN_DRIVE_FAKE_DIR;
    delete process.env.SARABAN_DRIVE_FOLDER_ID;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- LINE ----
const lineBase = {
  receiveNo: 12,
  year: 2569,
  subject: "ขอเชิญประชุมประจำเดือน",
  fromOrg: "สพป.กรุงเทพ",
  urgency: 0 as const,
  secret: false,
  command: "ทราบ",
  assignees: ["ครูสมชาย", "ครูสมหญิง"],
  url: "https://example.com/sis/saraban/1",
};

test("formatLineMessage: หนังสือลับไม่เผยชื่อเรื่อง", () => {
  const t = formatLineMessage({ ...lineBase, secret: true });
  assert.ok(!t.includes(lineBase.subject));
  assert.ok(t.includes("หนังสือลับ"));
});

test("formatLineMessage: ระดับความด่วน", () => {
  assert.ok(formatLineMessage({ ...lineBase, urgency: 3 }).includes("[ด่วนที่สุด]"));
  assert.ok(!formatLineMessage(lineBase).includes("["));
});

test("formatLineMessage: ไม่มีผู้รับผิดชอบ ตัดบรรทัด และตัดความยาว", () => {
  assert.ok(!formatLineMessage({ ...lineBase, assignees: [] }).includes("ผู้รับผิดชอบ"));
  assert.ok(formatLineMessage(lineBase).includes("ผู้รับผิดชอบ: ครูสมชาย, ครูสมหญิง"));
  assert.ok(formatLineMessage({ ...lineBase, subject: "ก".repeat(9000) }).length <= 5000);
});

test("pushLineGroup: ไม่มี env คืน false", async () => {
  const old = [process.env.LINE_CHANNEL_ACCESS_TOKEN, process.env.LINE_GROUP_ID];
  delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  delete process.env.LINE_GROUP_ID;
  try {
    assert.equal(await pushLineGroup("x"), false);
  } finally {
    if (old[0] !== undefined) process.env.LINE_CHANNEL_ACCESS_TOKEN = old[0];
    if (old[1] !== undefined) process.env.LINE_GROUP_ID = old[1];
  }
});

test("formatReminderBody: ลับไม่เผยชื่อเรื่อง และใส่ … เมื่อมีหลายเรื่อง", () => {
  const one = formatReminderBody([{ subject: "ความลับสุดยอด", secret: true }]);
  assert.ok(!one.includes("ความลับสุดยอด") && one.includes("หนังสือลับ") && !one.includes("…"));
  const many = formatReminderBody([{ subject: "ลับมาก", secret: true }, { subject: "ประชุม", secret: false }]);
  assert.ok(!many.includes("ลับมาก") && many.includes("2 เรื่อง") && many.includes("…"));
  assert.ok(formatReminderBody([{ subject: "ประชุม", secret: false }]).includes("ประชุม"));
});

test("ตรารับ: 4 บรรทัด และเวลาเป็นเวลาไทย", () => {
  const l = receiveStampLines({ schoolName: "โรงเรียนทดสอบ", receiveNo: 12, year: 2570, receivedAt: "2027-03-05T02:30:00Z" });
  assert.equal(l.length, 4);
  assert.equal(l[0], "โรงเรียนทดสอบ");
  assert.equal(l[1], "รับที่ 12/2570");
  assert.equal(l[2], "วันที่ 5 มีนาคม 2570");
  assert.equal(l[3], "เวลา 09.30 น.");
});

test("คำเกษียน: ตัดบรรทัดไม่เกิน maxChars และท้ายเป็นชื่อ/ตำแหน่ง/วันที่", () => {
  const note = Array.from({ length: 24 }, (_, i) => `คำที่${i}`).join(" ").padEnd(120, "ก");
  const l = endorsementLines({ note, signerName: "นายสมชาย ใจดี", position: "ผู้อำนวยการ", date: "2026-10-22" });
  const body = l.slice(0, -3);
  assert.ok(body.length > 1);
  assert.ok(body.every((x) => [...x].length <= 48));
  assert.deepEqual(l.slice(-3), ["(นายสมชาย ใจดี)", "ผู้อำนวยการ", "22 ต.ค. 2569"]);
});

test("คำเกษียน: สตริงไทยยาวไม่มีช่องว่าง ไม่ขึ้นต้นด้วยสระ/วรรณยุกต์ลอย", () => {
  const note = "ผู้บริหารสถานศึกษาพิจารณาเห็นสมควรมอบหมายให้ครูผู้รับผิดชอบดำเนินการตามระเบียบที่เกี่ยวข้องโดยเร็วที่สุดเพื่อประโยชน์ของนักเรียน".repeat(2);
  const l = endorsementLines({ note, signerName: "ก", position: "ข", date: "2026-10-22" }, 20);
  const body = l.slice(0, -3);
  assert.ok(body.length > 3);
  for (const x of body) {
    assert.ok([...x].length <= 20, x);
    assert.ok(!/^[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/.test(x), x);
  }
  assert.equal(body.join(""), note);
});

test("embedPng ฝัง PNG ลงหน้า PDF", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  const pdf = await doc.save();
  const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
  const out = await embedPng(pdf, png, { page: 0, x: 400, y: 700, width: 150, height: 80 });
  const re = await PDFDocument.load(out);
  assert.equal(re.getPageCount(), 1);
  assert.ok(out.length > pdf.length);
});

test("คำเกษียน: ประโยคไทยไม่มีช่องว่างตัดตามขอบเขตคำ", () => {
  const note = "ขอเชิญคณะครูและบุคลากรทางการศึกษาทุกท่านเข้าร่วมประชุมเพื่อชี้แจงแนวทางการดำเนินงานตามนโยบายของสำนักงานเขตพื้นที่การศึกษา";
  const l = endorsementLines({ note, signerName: "ก", position: "ข", date: "2026-10-22" });
  const body = l.slice(0, -3);
  assert.ok([...note].length > 48 && body.length >= 2);
  assert.equal(body.join(""), note);
  for (const x of body) {
    assert.ok([...x].length <= 48, x);
    assert.ok(!/^[\u0E2F\u0E30-\u0E3A\u0E45-\u0E4E]/.test(x), x);
    assert.ok(!/[\u0E40-\u0E44]$/.test(x), x);
  }
});

test("pngSizePt อ่านขนาดจาก IHDR หาร STAMP_SCALE", () => {
  const b = new Uint8Array(24);
  const dv = new DataView(b.buffer);
  dv.setUint32(16, 300);
  dv.setUint32(20, 90);
  assert.deepEqual(pngSizePt(b), { width: 100, height: 30 });
});

test("embedPng: หน้าเกินช่วงหรือขนาดไม่ถูกต้องต้อง throw", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([100, 100]);
  const pdf = await doc.save();
  const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
  await assert.rejects(embedPng(pdf, png, { page: 3, x: 0, y: 0, width: 10, height: 10 }), /ไม่พบหน้าที่ 4/);
  await assert.rejects(embedPng(pdf, png, { page: 0, x: 0, y: 0, width: NaN, height: 10 }), /ขนาด/);
});
