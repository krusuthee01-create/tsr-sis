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
import { isIsoDate, parseRegisterInput, receiveStampBox, validateRegister } from "../src/lib/saraban/register.ts";
import { A4, endorsementPlacement, isUuid, latestFile, parseNote, parseTargets, safeMessage, siteOrigin } from "../src/lib/saraban/book.ts";

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

test("isIsoDate: รับเฉพาะวันที่มีจริงรูปแบบ YYYY-MM-DD", () => {
  assert.equal(isIsoDate("2026-11-21"), true);
  assert.equal(isIsoDate("2024-02-29"), true);
  assert.equal(isIsoDate("2026-02-29"), false);
  assert.equal(isIsoDate("2026-13-01"), false);
  assert.equal(isIsoDate("21/11/2026"), false);
  assert.equal(isIsoDate(""), false);
});

test("validateRegister: ช่องบังคับ วันที่ ความด่วน และเลขรับ", () => {
  const ok = { docNo: "ศธ 0001/1", docDate: "2026-11-20", fromOrg: "สพป.ตัวอย่าง", toText: "", subject: "ทดสอบ", urgency: 0, secret: false, dueDate: "" };
  assert.deepEqual(validateRegister(ok), {});
  assert.deepEqual(validateRegister({ ...ok, receiveNo: 5 }), {});
  const bad = validateRegister({ ...ok, fromOrg: "  ", subject: "", docDate: "2026-02-30", dueDate: "x", urgency: 4, receiveNo: 0 });
  assert.deepEqual(Object.keys(bad).sort(), ["docDate", "dueDate", "fromOrg", "receiveNo", "subject", "urgency"]);
  assert.ok(validateRegister({ ...ok, urgency: 1.5 }).urgency);
  assert.ok(validateRegister({ ...ok, subject: "ก".repeat(1001) }).subject);
});

test("receiveStampBox: มุมขวาบนของหน้าแรก เว้นขอบ 18pt", () => {
  assert.deepEqual(receiveStampBox({ width: 595, height: 842 }, { width: 200, height: 96 }), { page: 0, x: 377, y: 728, width: 200, height: 96 });
  // หน้าแคบกว่าตรา: ย่อตามสัดส่วน ยังอยู่ในหน้า
  const b = receiveStampBox({ width: 136, height: 300 }, { width: 200, height: 96 });
  assert.equal(b.width, 100);
  assert.equal(b.height, 48);
  assert.equal(b.x, 18);
  assert.equal(b.y, 300 - 48 - 18);
});

test("parseRegisterInput: ตรวจชนิดข้อมูลจริง ไม่ throw", () => {
  const ok = { docNo: "1", docDate: "", fromOrg: "ก", toText: undefined, subject: "ข", urgency: 2, secret: false, dueDate: null };
  const r = parseRegisterInput(ok);
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual([r.input.toText, r.input.dueDate, r.input.receiveNo], ["", "", null]);
  for (const bad of [null, "x", 5, { ...ok, subject: 5 }, { ...ok, fromOrg: {} }, { ...ok, secret: "true" }, { ...ok, urgency: "1" },
    { ...ok, urgency: 4 }, { ...ok, urgency: 1.5 }, { ...ok, receiveNo: "3" }, { ...ok, receiveNo: 0 }, { ...ok, docDate: [] }]) {
    const x = parseRegisterInput(bad);
    assert.equal(x.ok, false, JSON.stringify(bad));
    if (!x.ok) assert.ok(x.error.length > 0);
  }
  const n = parseRegisterInput({ ...ok, receiveNo: 7 });
  assert.ok(n.ok && n.input.receiveNo === 7);
});

// ---------- หน้าหนังสือ (Task 7) ----------

test("latestFile: ฉบับประทับตรารุ่นล่าสุดก่อน ไม่มีใช้ต้นฉบับ ไม่มีไฟล์คืน null", () => {
  const f = (kind: string, version: number) => ({ id: `${kind}${version}`, kind, version });
  assert.equal(latestFile([]), null);
  assert.equal(latestFile([f("attachment", 1)]), null);
  assert.equal(latestFile([f("original", 1), f("original", 2)])?.id, "original2");
  assert.equal(latestFile([f("original", 3), f("stamped", 1), f("stamped", 3), f("stamped", 2)])?.id, "stamped3");
});

test("endorsementPlacement: มุมล่างขวาหน้าแรก เว้นขอบ 18pt", () => {
  const p = endorsementPlacement({ width: 595, height: 842 }, { width: 200, height: 120 }, 2);
  assert.deepEqual(p, { appendPage: false, box: { page: 0, x: 595 - 200 - 18, y: 18, width: 200, height: 120 } });
});

test("endorsementPlacement: สูงเกิน 40% ของหน้า → เพิ่มหน้า A4 วางมุมขวาบน", () => {
  const p = endorsementPlacement({ width: 595, height: 400 }, { width: 200, height: 170 }, 3);
  assert.equal(p.appendPage, true);
  assert.equal(p.box.page, 3);
  assert.ok(Math.abs(p.box.x - (A4.width - 200 - 18)) < 1e-9);
  assert.ok(Math.abs(p.box.y - (A4.height - 170 - 18)) < 1e-9);
  // พอดี 40% ยังวางหน้าแรก
  assert.equal(endorsementPlacement({ width: 595, height: 400 }, { width: 200, height: 160 }, 1).appendPage, false);
});

test("endorsementPlacement: ภาพกว้างกว่าหน้าย่อตามสัดส่วน", () => {
  const p = endorsementPlacement({ width: 236, height: 842 }, { width: 400, height: 100 }, 1);
  assert.equal(p.box.width, 200);
  assert.equal(p.box.height, 50);
  assert.equal(p.box.x, 18);
});

test("siteOrigin: NEXT_PUBLIC_SITE_URL ก่อน → Origin → X-Forwarded-Host", () => {
  assert.equal(siteOrigin({ origin: "https://gotime.example.th", forwardedHost: "x.vercel.app" }, "https://sis.example.th/sis/"), "https://sis.example.th");
  assert.equal(siteOrigin({ origin: "https://gotime.example.th" }, "  "), "https://gotime.example.th");
  assert.equal(siteOrigin({ origin: "https://gotime.example.th" }, "not a url"), "https://gotime.example.th");
  assert.equal(siteOrigin({ origin: "https://gotime.example.th", forwardedHost: "x.vercel.app" }), "https://gotime.example.th");
  assert.equal(siteOrigin({ origin: "null", forwardedHost: "sis.example.th", forwardedProto: "https" }), "https://sis.example.th");
  assert.equal(siteOrigin({ forwardedHost: "localhost:3000", forwardedProto: "http" }), "http://localhost:3000");
  assert.equal(siteOrigin({ forwardedHost: "evil.com/path" }), null);
  assert.equal(siteOrigin({ origin: "javascript:alert(1)" }), null);
  assert.equal(siteOrigin({}), null);
});

test("endorsementPlacement: ธุรการซ้ายล่าง ผอ. ขวาล่าง ไม่ทับกัน", () => {
  const page = { width: 595, height: 842 };
  const clerk = endorsementPlacement(page, { width: 220, height: 100 }, 1, { side: "left" }).box;
  const dir = endorsementPlacement(page, { width: 220, height: 120 }, 1, { side: "right" }).box;
  assert.deepEqual(clerk, { page: 0, x: 18, y: 18, width: 220, height: 100 });
  assert.equal(dir.x, 595 - 220 - 18);
  assert.ok(clerk.x + clerk.width <= dir.x, "สองกล่องต้องไม่ซ้อนกันแนวนอน");
  // สูงเกิน 40% → หน้าใหม่ มุมบนซ้าย
  const tall = endorsementPlacement({ width: 595, height: 400 }, { width: 200, height: 170 }, 2, { side: "left" });
  assert.equal(tall.appendPage, true);
  assert.equal(tall.box.page, 2);
  assert.equal(tall.box.x, 18);
  assert.ok(Math.abs(tall.box.y - (A4.height - 170 - 18)) < 1e-9);
});

test("endorsementPlacement: หัวหน้ากลุ่มงาน (newPage) เพิ่มหน้า A4 วางมุมบนซ้ายเสมอ", () => {
  const p = endorsementPlacement({ width: 595, height: 842 }, { width: 200, height: 80 }, 3, { side: "left", newPage: true });
  assert.equal(p.appendPage, true);
  assert.equal(p.box.page, 3);
  assert.equal(p.box.x, 18);
  assert.ok(Math.abs(p.box.y - (A4.height - 80 - 18)) < 1e-9);
});

test("safeMessage: แสดงเฉพาะข้อความภาษาไทยของระบบ", () => {
  assert.equal(safeMessage(new Error("ไฟล์ใหญ่เกิน 30 MB"), "x"), "ไฟล์ใหญ่เกิน 30 MB");
  assert.equal(safeMessage(new Error("Failed to parse PDF document (line:1 col:2)"), "ไม่ทราบสาเหตุ"), "ไม่ทราบสาเหตุ");
  assert.equal(safeMessage("The user does not have sufficient permissions for file", "fb"), "fb");
  assert.equal(safeMessage(undefined, "fb"), "fb");
  assert.equal(safeMessage({ message: "ภาษาไทย" }, "fb"), "fb");
});

test("ตรวจข้อมูลจาก client: uuid, ผู้รับ, ข้อความ", () => {
  const id = "0b7f2c4e-1d2a-4c3b-9e8f-112233445566";
  assert.equal(isUuid(id), true);
  assert.equal(isUuid("x"), false);
  assert.equal(isUuid(1), false);
  assert.deepEqual(parseTargets([id, id]), [id]);
  assert.deepEqual(parseTargets([]), []);
  assert.equal(parseTargets(["x"]), null);
  assert.equal(parseTargets("x"), null);
  assert.equal(parseNote(undefined), "");
  assert.equal(parseNote("  ทราบ  "), "ทราบ");
  assert.equal(parseNote(5), null);
  assert.equal(parseNote("ก".repeat(1500))?.length, 1000);
});

test("service worker: push แสดงแจ้งเตือน และกดแล้วเปิดเฉพาะหน้าใต้ /sis", async () => {
  const { readFileSync } = await import("node:fs");
  const vm = await import("node:vm");
  const handlers: Record<string, (e: unknown) => void> = {};
  const shown: { title: string; opts: { body: string; data: { url: string } } }[] = [];
  const opened: string[] = [];
  const sandbox = {
    self: {
      addEventListener: (t: string, fn: (e: unknown) => void) => { handlers[t] = fn; },
      location: { origin: "https://gotime.test" },
      registration: { showNotification: async (title: string, opts: { body: string; data: { url: string } }) => { shown.push({ title, opts }); } },
      clients: { matchAll: async () => [], openWindow: async (u: string) => { opened.push(u); } },
    },
    caches: {}, URL, Promise, Response,
  };
  vm.runInNewContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), sandbox);
  let wait: Promise<unknown> = Promise.resolve();
  const waitUntil = (p: Promise<unknown>) => { wait = p; };
  handlers.push({ data: { json: () => ({ title: "มีหนังสือมอบหมายถึงคุณ", body: "รับที่ 1/2569: หนังสือลับ", url: "/sis/saraban/book/abc" }) }, waitUntil });
  await wait;
  assert.equal(shown[0].title, "มีหนังสือมอบหมายถึงคุณ");
  assert.equal(shown[0].opts.body, "รับที่ 1/2569: หนังสือลับ");
  const click = async (url: string) => {
    handlers.notificationclick({ notification: { close: () => {}, data: { url } }, waitUntil });
    await wait;
    return opened.at(-1);
  };
  assert.equal(await click("/sis/saraban/book/abc"), "https://gotime.test/sis/saraban/book/abc");
  assert.equal(await click("https://evil.test/sis/x"), "https://gotime.test/sis/saraban");
  assert.equal(await click("/start"), "https://gotime.test/sis/saraban");
});

test("service worker: PDF สารบรรณ cache-first (เก็บไม่เกิน 200 ลบเก่าสุดก่อน) และ API อื่นของสารบรรณไม่แคช", async () => {
  const { readFileSync } = await import("node:fs");
  const vm = await import("node:vm");
  const handlers: Record<string, (e: unknown) => void> = {};
  // Cache API จำลอง: คีย์เรียงตามลำดับที่ใส่ (เหมือนของจริง)
  const stores = new Map<string, Map<string, Response>>();
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name)!;
    return {
      match: async (k: string) => m.get(k)?.clone(),
      put: async (k: string, r: Response) => { m.delete(k); m.set(k, r); },
      delete: async (k: string) => m.delete(k),
      keys: async () => [...m.keys()],
      addAll: async () => {},
    };
  };
  const fetched: string[] = [];
  const status = (url: string) => (url.includes("/denied") ? 404 : 200);
  const sandbox = {
    self: { addEventListener: (t: string, fn: (e: unknown) => void) => { handlers[t] = fn; }, location: { origin: "https://gotime.test" } },
    caches: { open, match: async () => undefined, keys: async () => [...stores.keys()], delete: async (k: string) => stores.delete(k) },
    fetch: async (req: { url: string }) => { fetched.push(req.url); return new Response("pdf:" + req.url, { status: status(req.url) }); },
    Response, URL, Promise,
  };
  vm.runInNewContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), sandbox);
  const get = async (path: string, mode = "cors") => {
    let res = null as Promise<Response> | null;
    const pending: Promise<unknown>[] = [];
    handlers.fetch({ request: { method: "GET", url: "https://gotime.test" + path, mode, headers: { get: () => null } },
      respondWith: (p: Promise<Response>) => { res = p; }, waitUntil: (p: Promise<unknown>) => { pending.push(p); } });
    const r = res ? await res : null;
    await Promise.all(pending); // งานเก็บแคช (put/trim) อยู่ใน waitUntil
    return r;
  };
  const file = (n: number) => `/sis/saraban/api/file/00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

  // เปิดครั้งแรกจากเครือข่าย ครั้งที่สองจากแคช (iframe = navigate ก็ใช้กฎนี้)
  assert.equal(await (await get(file(1), "navigate"))!.text(), "pdf:https://gotime.test" + file(1));
  assert.equal(await (await get(file(1)))!.text(), "pdf:https://gotime.test" + file(1));
  assert.equal(fetched.length, 1);
  // 404 (ไม่มีสิทธิ์) ไม่เก็บ
  assert.equal((await get("/sis/saraban/api/file/denied"))!.status, 404);
  await get("/sis/saraban/api/file/denied");
  assert.equal(fetched.filter((u) => u.endsWith("/denied")).length, 2);
  // API อื่นของสารบรรณไม่ผ่าน service worker
  for (const p of ["/sis/saraban/api/upload-session", "/sis/saraban/api/fake-drive/x", "/sis/saraban/api/cron/reminders"]) assert.equal(await get(p), null, p);
  // หน้า /sis/saraban ยังใช้ network-first เดิม (respondWith ถูกเรียก)
  assert.notEqual(await get("/sis/saraban", "navigate"), null);
  assert.equal(stores.has("tsr-v4-pages"), true);

  // เกิน 200: ลบเก่าสุดก่อน แต่ไฟล์ที่เพิ่งเปิดซ้ำ (file 1) ถูกย้ายไปท้ายจึงยังอยู่
  for (let i = 2; i <= 201; i++) {
    await get(file(i));
    if (i === 100) await get(file(1));
  }
  const keys = [...stores.get("tsr-saraban-files")!.keys()];
  assert.equal(keys.length, 200);
  assert.equal(keys.includes("https://gotime.test" + file(1)), true);
  assert.equal(keys.includes("https://gotime.test" + file(2)), false);
  assert.equal(keys.at(-1), "https://gotime.test" + file(201));

  // activate ของรุ่นใหม่ไม่ลบแคช PDF
  let wait: Promise<unknown> = Promise.resolve();
  (sandbox.self as Record<string, unknown>).clients = { claim: () => Promise.resolve() };
  stores.set("tsr-v3-pages", new Map());
  handlers.activate({ waitUntil: (p: Promise<unknown>) => { wait = p; } });
  await wait;
  assert.equal(stores.has("tsr-saraban-files"), true);
  assert.equal(stores.has("tsr-v3-pages"), false);
});
