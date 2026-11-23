// ทดสอบหน้าสรุปสารบรรณผ่านเบราว์เซอร์ — รันหลัง tests/e2e/saraban.cjs (ใช้ผู้ใช้และข้อมูลชุดเดียวกัน)
// node tests/e2e/saraban-stats.cjs   (E2E_DB, SHOT_DIR ปรับได้)
const { chromium } = require("playwright");
const fs = require("fs");
const { execSync } = require("child_process");
const sql = (q) => execSync(`psql "${process.env.E2E_DB || "postgres://postgres@127.0.0.1:54329/tsr_e2e"}" -Atc "${q}"`).toString().trim();
const ok = (c, m) => { if (!c) throw new Error(m); console.log("   ✓", m); };
const B = (process.env.E2E_ORIGIN || "http://localhost:3000") + "/sis";
async function login(b, u, opts) {
  const ctx = await b.newContext(opts);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => { throw e; });
  await p.goto(B + "/login"); await p.fill("#username", u); await p.fill("#password", "pass1234"); await p.click("button[type=submit]");
  await p.waitForURL((x) => !x.pathname.startsWith("/sis/login"));
  return p;
}
(async () => {
  const dir = process.env.SHOT_DIR || "/tmp/tsr-shots/saraban";
  fs.mkdirSync(dir, { recursive: true });
  const year = sql("select saraban_year()");
  const expected = sql(`select count(*) from saraban_books where year = ${year} and deleted_at is null`);
  const b = await chromium.launch();

  const d = await login(b, "director.test", { viewport: { width: 1280, height: 900 } });
  await d.goto(B + "/saraban");
  await d.getByRole("link", { name: "สรุป", exact: true }).click();
  await d.waitForURL(/\/sis\/saraban\/stats/);
  await d.getByRole("heading", { name: "สรุปสารบรรณ" }).waitFor();
  const total = await d.locator("tbody tr").last().locator("td").first().innerText();
  ok(total.trim() === expected, `ยอดรวมหนังสือรับปี ${year} ตรงกับฐานข้อมูล (${expected})`);
  ok(await d.getByText("ลงรับ ถึง ผอ. สั่งการ").isVisible(), "แสดงเวลาตั้งแต่ลงรับถึง ผอ. สั่งการ");
  await d.screenshot({ path: dir + "/stats-desktop.png", fullPage: true });

  const m = await login(b, "krusomjai", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await m.goto(B + "/saraban/stats");
  await m.getByRole("heading", { name: "สรุปสารบรรณ" }).waitFor();
  const wide = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok(!wide, "มือถือไม่มีแถบเลื่อนแนวนอนทั้งหน้า (ตารางเลื่อนในกรอบ)");
  await m.screenshot({ path: dir + "/stats-mobile.png", fullPage: true });

  const t = await login(b, "teacher.test", { viewport: { width: 390, height: 844 } });
  await t.goto(B + "/saraban/stats");
  await t.waitForURL((x) => x.pathname === "/sis/saraban");
  ok(true, "ครูเปิดหน้าสรุปไม่ได้ (กลับไปหน้าสารบรรณ)");
  ok((await t.getByRole("link", { name: "สรุป", exact: true }).count()) === 0, "ครูไม่เห็นปุ่มสรุป");
  await b.close();
  console.log("✅ ผ่าน");
})().catch((e) => { console.error(e); process.exit(1); });
