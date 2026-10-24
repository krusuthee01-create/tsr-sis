// ทดสอบครูที่ปรึกษาจัดเลขที่นักเรียน (ข้อมูลสมมติ) — รันหลัง tests/e2e/flow.cjs
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const SHOT = (process.env.SHOT_DIR || "/tmp/tsr-shots") + "/numbers-";
const BASE = "http://localhost:3000";
const sql = (q) => execSync(`psql "${process.env.E2E_DB || "postgres://postgres@127.0.0.1:54329/tsr_e2e"}" -Atc "${q}"`).toString().trim();
const step = (s) => console.log("▶", s);
const assert = (c, m) => { if (!c) throw new Error(m); };

(async () => {
  const room = sql("select id from classrooms where grade = 'ป.3' and room = 1 order by year desc limit 1");
  const other = sql("select id from classrooms where grade = 'ป.3' and room = 2 order by year desc limit 1");
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const errors = [];
  const t = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage();
  t.on("pageerror", (e) => errors.push(e.message));
  await t.goto(BASE + "/login"); await t.fill("#username", "krusomjai"); await t.fill("#password", "pass1234"); await t.click("button[type=submit]");
  await t.waitForURL((u) => !u.pathname.startsWith("/login"));

  step("ครูที่ปรึกษาเปิดทะเบียนนักเรียน → จัดเลขที่");
  await t.goto(`${BASE}/students?c=${room}`);
  await t.getByRole("link", { name: "จัดเลขที่" }).click();
  await t.waitForURL("**/students/numbers**");
  await t.getByText("ยังไม่มีการเปลี่ยนแปลง").waitFor();

  step("เรียงชื่อ ก–ฮ แล้วย้ายคนสุดท้ายเป็นเลขที่ 1");
  await t.getByRole("button", { name: "เรียงชื่อ ก–ฮ (ไม่แยกเพศ)" }).click();
  const inputs = t.locator('input[id^="no-"]:not([disabled])');
  const n = await inputs.count();
  const lastId = (await inputs.nth(n - 1).getAttribute("id")).slice(3);
  await inputs.nth(n - 1).fill("1");
  await inputs.nth(n - 1).press("Enter");
  await t.getByRole("button", { name: /บันทึกเลขที่ใหม่/ }).waitFor();
  await t.screenshot({ path: SHOT + "01-edit.png", fullPage: true });
  await t.getByRole("button", { name: /บันทึกเลขที่ใหม่/ }).click();
  await t.getByText(/บันทึกเลขที่แล้ว/).waitFor();
  assert(sql(`select number from enrollments where classroom_id = ${room} and student_id = '${lastId}'`) === "1", "คนที่ย้ายต้องเป็นเลขที่ 1");
  const nums = sql(`select string_agg(number::text, ',' order by number) from enrollments e join students s on s.id = e.student_id where classroom_id = ${room} and s.status = 'studying'`);
  assert(nums === Array.from({ length: n }, (_, i) => i + 1).join(","), "เลขที่ต้องต่อเนื่อง 1..N: " + nums);
  console.log(`   เลขที่ ${n} คน ต่อเนื่อง 1–${n}`);

  step("เช็กชื่อแสดงตามเลขที่ใหม่");
  await t.goto(`${BASE}/attendance?c=${room}`);
  await t.waitForTimeout(800);
  const firstName = sql(`select first_name from students where id = '${lastId}'`);
  assert((await t.locator("main").innerText()).indexOf(firstName) > -1, "ไม่พบนักเรียนในหน้าเช็กชื่อ");

  step("เปิดห้องอื่นด้วยลิงก์ตรง → ระบบแสดงเฉพาะห้องของตนเอง");
  await t.goto(`${BASE}/students/numbers?c=${other}`);
  await t.getByText(/ป\.3\/1 · ปีการศึกษา/).waitFor();
  await browser.close();
  if (errors.length) { console.error("❌ JS errors:", errors); process.exit(1); }
  console.log("✅ จัดเลขที่นักเรียนผ่านทุกขั้นตอน");
})().catch((e) => { console.error("❌", e.message); process.exit(1); });
