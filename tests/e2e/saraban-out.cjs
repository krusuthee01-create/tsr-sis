// ทดสอบทะเบียนหนังสือส่ง/คำสั่ง/ประกาศผ่านเบราว์เซอร์ (ข้อมูลสมมติ) — รันหลัง tests/e2e/saraban.cjs (ใช้ผู้ใช้ชุดเดียวกัน)
// node tests/e2e/saraban-out.cjs   (E2E_DB, SHOT_DIR ปรับได้)
const { chromium } = require("playwright");
const { PDFDocument } = require("pdf-lib");
const fs = require("fs");
const { execSync } = require("child_process");
const sql = (q) => execSync(`psql "${process.env.E2E_DB || "postgres://postgres@127.0.0.1:54329/tsr_e2e"}" -Atc "${q}"`).toString().trim();
const ok = (c, m) => { if (!c) throw new Error(m); console.log("   ✓", m); };
const B = (process.env.E2E_ORIGIN || "http://localhost:3000") + "/sis";
async function login(b, u, mobile) {
  const ctx = await b.newContext(mobile ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => { throw e; });
  await p.goto(B + "/login"); await p.fill("#username", u); await p.fill("#password", "pass1234"); await p.click("button[type=submit]");
  await p.waitForURL((x) => !x.pathname.startsWith("/sis/login"));
  return p;
}
(async () => {
  const dir = process.env.SHOT_DIR || "/tmp/tsr-shots/saraban";
  fs.mkdirSync(dir, { recursive: true });
  // เริ่มจากทะเบียนว่าง (ข้อมูลทดสอบเท่านั้น)
  sql("delete from saraban_out_files; delete from saraban_outgoing; delete from saraban_counters where kind in ('out','order','announce')");
  const doc = await PDFDocument.create(); doc.addPage(); fs.writeFileSync(dir + "/out.pdf", await doc.save());
  const b = await chromium.launch();
  // ครูขอเลขหนังสือส่งพร้อมแนบ PDF (มือถือ)
  const t = await login(b, "teacher.test", true);
  await t.goto(B + "/saraban");
  await t.getByRole("link", { name: /หนังสือส่ง/ }).click();
  await t.getByRole("button", { name: "ขอเลขหนังสือส่ง" }).click();
  await t.fill("#out-to", "ผู้อำนวยการสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 1");
  await t.fill("#out-subject", "ขอส่งรายงานผลการดำเนินงาน");
  await t.setInputFiles("#out-file", dir + "/out.pdf");
  await t.getByRole("button", { name: "ขอเลข", exact: true }).click();
  await t.getByText("ได้เลขหนังสือแล้ว").waitFor();
  const no = await t.locator("dialog[open] p.text-3xl").innerText();
  console.log("   เลขที่ได้:", no);
  ok(/^ศธ 04109\.84\/\d+$/.test(no), "ได้เลข ศธ 04109.84/n");
  await t.screenshot({ path: dir + "/out-issued.png" });
  await t.getByRole("button", { name: "เสร็จสิ้น" }).click();
  await t.getByRole("link", { name: "สำเนา" }).first().waitFor();
  ok(sql("select count(*) from saraban_out_files") === "1", "แนบสำเนา PDF แล้ว");
  // หนังสือเวียน เลขชุดเดียวกัน
  await t.getByRole("button", { name: "ขอเลขหนังสือส่ง" }).click();
  await t.getByText("หนังสือเวียน", { exact: true }).click();
  await t.fill("#out-subject", "แจ้งผู้ปกครองเรื่องหยุดเรียน");
  await t.getByRole("button", { name: "ขอเลข", exact: true }).click();
  await t.getByText("ได้เลขหนังสือแล้ว").waitFor();
  const c = await t.locator("dialog[open] p.text-3xl").innerText();
  ok(/\/ว \d+$/.test(c), `หนังสือเวียน ${c}`);
  await t.getByRole("button", { name: "เสร็จสิ้น" }).click();
  ok((await t.getByRole("button", { name: "ยกเลิกเลข" }).count()) === 0, "ครูไม่เห็นปุ่มยกเลิกเลข");
  // คำสั่ง
  await t.getByRole("link", { name: "คำสั่ง" }).click();
  await t.getByRole("button", { name: "ขอเลขคำสั่ง" }).click();
  await t.fill("#out-subject", "แต่งตั้งคณะกรรมการ");
  await t.getByRole("button", { name: "ขอเลข", exact: true }).click();
  await t.getByText("ได้เลขหนังสือแล้ว").waitFor();
  ok(/^1\/25\d\d$/.test(await t.locator("dialog[open] p.text-3xl").innerText()), "คำสั่งเลข 1/ปี");
  // ธุรการยกเลิกเลขหนังสือส่ง และส่งออก/พิมพ์
  const k = await login(b, "krusomjai");
  await k.goto(B + "/saraban/out");
  await k.getByRole("button", { name: "ยกเลิกเลข" }).first().click();
  await k.locator("input[id^=cancel-]").first().fill("ทดสอบยกเลิก");
  await k.getByRole("button", { name: "ยืนยันยกเลิกเลข" }).first().click();
  await k.getByText("ยกเลิก: ทดสอบยกเลิก", { exact: true }).waitFor();
  ok(sql("select count(*) from saraban_outgoing where deleted_reason = 'ทดสอบยกเลิก'") === "1", "ยกเลิกเลขพร้อมเหตุผล");
  await k.screenshot({ path: dir + "/out-clerk.png", fullPage: true });
  await k.emulateMedia({ media: "print" });
  await k.pdf({ path: dir + "/out-print.pdf", landscape: true, format: "A4" });
  // ตั้งเลขที่หนังสือในหน้าตั้งค่า
  await k.emulateMedia({ media: "screen" });
  await k.goto(B + "/saraban/settings");
  ok((await k.locator("#saraban-prefix").inputValue()) === "ศธ 04109.84", "หน้าตั้งค่าแสดงเลขที่หนังสือของโรงเรียน");
  await b.close();
  console.log("✅ ผ่าน");
})().catch((e) => { console.error(e); process.exit(1); });
