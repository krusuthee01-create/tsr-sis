// ทดสอบการใช้งานจริงผ่านเบราว์เซอร์ (ข้อมูลสมมติทั้งหมด)
// ต้องเปิด scripts/local-stack/start.sh และ next start -p 3000 ก่อน แล้วรัน: node tests/e2e/flow.cjs
const { chromium, devices } = require("playwright");
const CHROMIUM = process.env.CHROMIUM_PATH || undefined;
const { execSync } = require("child_process");
const SHOT = (process.env.SHOT_DIR || "/tmp/tsr-shots") + "/";
const FAKE_DMC = process.env.FAKE_DMC || "/tmp/tsr-fake-dmc.xlsx";
const BASE = "http://localhost:3000";
const sql = (q) => execSync(`psql "${process.env.E2E_DB || "postgres://postgres@127.0.0.1:54329/tsr_e2e"}" -Atc "${q}"`).toString().trim();
const step = (s) => console.log("▶", s);

async function login(page, user) {
  await page.goto(BASE + "/login");
  await page.fill("#username", user);
  await page.fill("#password", "pass1234");
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });
}
async function skipTour(page) {
  const skip = page.getByRole("button", { name: "ข้าม" });
  if (await skip.isVisible({ timeout: 3000 }).catch(() => false)) { await skip.click(); await page.waitForTimeout(500); }
}

(async () => {
  execSync(`mkdir -p ${SHOT}`);
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  const errors = [];

  // ---------------- ผู้ดูแลระบบ (iPad แนวนอน) ----------------
  const admin = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
  const a = await admin.newPage();
  a.on("pageerror", (e) => errors.push("admin: " + e.message));
  a.on("dialog", (d) => d.accept());

  step("ผู้ดูแลระบบเข้าสู่ระบบครั้งแรก → หน้ารออนุมัติ → ตั้งตัวเองเป็นผู้ดูแลระบบ");
  await login(a, "admin.test");
  await a.waitForURL("**/pending");
  await a.screenshot({ path: SHOT + "01-pending.png" });
  await a.getByRole("button", { name: "ตั้งฉันเป็นผู้ดูแลระบบ" }).click();
  await a.waitForURL("**/settings");
  await skipTour(a);
  await a.screenshot({ path: SHOT + "02-settings-overview.png" });

  step("ตั้งปีการศึกษาและภาคเรียน");
  await a.goto(BASE + "/settings?s=calendar");
  await a.getByRole("button", { name: "เพิ่ม", exact: true }).first().click();
  await a.waitForTimeout(1500);
  await a.goto(BASE + "/settings?s=calendar");
  await a.fill("#t1e", "2026-10-31");
  await a.getByRole("button", { name: "บันทึกภาคเรียน" }).click();
  await a.waitForTimeout(1200);
  await a.fill("#h-date", "2026-12-05");
  await a.fill("#h-name", "วันพ่อแห่งชาติ");
  await a.getByRole("button", { name: "เพิ่ม", exact: true }).nth(1).click();
  await a.waitForTimeout(1200);
  await a.screenshot({ path: SHOT + "03-calendar.png", fullPage: true });
  if (sql("select count(*) from terms") !== "2") throw new Error("ภาคเรียนไม่ถูกบันทึก");

  step("นำเข้าไฟล์ DMC (ข้อมูลสมมติ)");
  await a.goto(BASE + "/students/import");
  await a.setInputFiles("#imp-file", FAKE_DMC);
  await a.getByText(/อ่านได้/).waitFor();
  await a.screenshot({ path: SHOT + "04-import-check.png" });
  await a.getByRole("button", { name: "ถัดไป ›" }).click();
  await a.getByRole("button", { name: /นักเรียนใหม่/ }).waitFor();
  await a.screenshot({ path: SHOT + "05-import-diff.png" });
  await a.getByRole("button", { name: /ยืนยันนำเข้า/ }).click();
  await a.getByText("นำเข้าเรียบร้อย").waitFor({ timeout: 30000 });
  await a.screenshot({ path: SHOT + "06-import-done.png" });
  console.log("   นักเรียนในระบบ:", sql("select count(*) from students"), "ห้อง:", sql("select count(*) from classrooms"));

  step("อนุมัติครู และกำหนดครูที่ปรึกษา ป.3/1");
  await a.goto(BASE + "/staff");
  await a.getByRole("button", { name: "อนุมัติ" }).click();
  await a.waitForTimeout(1200);
  const room = sql("select id from classrooms where grade='ป.3' and room=1");
  const kru = sql("select id from staff where username is null and first_name='ทดสอบ' and last_name='krusomjai'") || sql("select id from staff where email like 'krusomjai%'");
  await a.goto(`${BASE}/classrooms?c=${room}`);
  await a.selectOption("#hr-who", kru);
  await a.getByRole("button", { name: "เพิ่ม", exact: true }).click();
  await a.waitForTimeout(1500);
  await a.screenshot({ path: SHOT + "07-classrooms.png", fullPage: true });
  if (sql(`select count(*) from homeroom_assignments where classroom_id=${room}`) !== "1") throw new Error("กำหนดครูที่ปรึกษาไม่สำเร็จ");

  // ---------------- ครูที่ปรึกษา (มือถือ) ----------------
  const teacher = await browser.newContext({ ...devices["iPhone 13"], browserName: "chromium" });
  const t = await teacher.newPage();
  t.on("pageerror", (e) => errors.push("teacher: " + e.message));
  step("ครูเข้าสู่ระบบบนมือถือ → ทัวร์ → หน้าแรก");
  await login(t, "krusomjai");
  await t.getByText("ยินดีต้อนรับสู่ TSR-SIS").waitFor();
  await t.screenshot({ path: SHOT + "08-tour.png" });
  await skipTour(t);
  await t.screenshot({ path: SHOT + "09-home-teacher.png", fullPage: true });

  step("เช็กชื่อเข้าแถว: คนที่ 1 สาย, คนที่ 2 ขาด แล้วบันทึก");
  await t.goto(BASE + "/attendance");
  const pills = t.locator("ul li button");
  await pills.first().waitFor();
  await pills.nth(0).click();
  for (let i = 0; i < 4; i++) await pills.nth(1).click();
  await t.screenshot({ path: SHOT + "10-attendance-line.png" });
  const start = Date.now();
  await t.getByRole("button", { name: /^บันทึกเช็กชื่อ/ }).click();
  await t.getByText("บันทึกแล้ว · เก็บในเครื่อง").waitFor();
  console.log(`   ขึ้น "บันทึกแล้ว" ภายใน ${Date.now() - start} ms`);
  await t.waitForTimeout(1500);
  const today = sql("select public.today_th()");
  console.log("   attendance_daily วันนี้:", sql(`select string_agg(status::text, ',' order by status) from attendance_daily where date='${today}'`));

  step("ดื่มนม: คนที่ขาดต้องถูกตัดออก");
  await t.getByRole("tab", { name: /ดื่มนม/ }).click();
  await t.getByText("ไม่มาเรียนวันนี้ · ตัดออกอัตโนมัติ").waitFor();
  await t.screenshot({ path: SHOT + "11-attendance-milk.png" });
  await t.getByRole("button", { name: /^บันทึกดื่มนม/ }).click();
  await t.waitForTimeout(1500);
  const enrolled = Number(sql(`select count(*) from enrollments where classroom_id=${room}`));
  const milk = Number(sql(`select count(*) from health_daily where kind='milk' and date='${today}'`));
  console.log(`   นักเรียน ${enrolled} คน, บันทึกดื่มนม ${milk} คน (ควรเป็น ${enrolled - 1})`);
  if (milk !== enrolled - 1) throw new Error("ดื่มนมไม่ตัดคนขาดออก");

  step("ไม่มีสัญญาณ: บันทึกแปรงฟันขณะออฟไลน์ แล้วกลับมาออนไลน์");
  await t.getByRole("tab", { name: /แปรงฟัน/ }).click();
  await teacher.setOffline(true);
  await pills.nth(2).click();
  await t.getByRole("button", { name: /^บันทึกแปรงฟัน/ }).click();
  await t.getByText("บันทึกแล้ว · เก็บในเครื่อง").waitFor();
  await t.getByText(/รอส่ง 1/).waitFor();
  await t.screenshot({ path: SHOT + "12-offline-queued.png" });
  if (sql(`select count(*) from health_daily where kind='brush'`) !== "0") throw new Error("ออฟไลน์แต่ข้อมูลถึงเซิร์ฟเวอร์?");
  await teacher.setOffline(false);
  await t.waitForTimeout(4000);
  const brush = sql(`select count(*) || ' (ไม่แปรง ' || count(*) filter (where not done) || ')' from health_daily where kind='brush'`);
  console.log("   หลังกลับมาออนไลน์ บันทึกแปรงฟัน:", brush);
  if (brush.startsWith("0")) throw new Error("ส่งข้อมูลหลังออนไลน์ไม่สำเร็จ");

  step("ครูดูหน้าแรก รายงาน และประวัตินักเรียน");
  await t.goto(BASE + "/");
  await t.screenshot({ path: SHOT + "13-home-after.png", fullPage: true });
  await t.goto(BASE + "/reports");
  await t.screenshot({ path: SHOT + "14-report-teacher.png", fullPage: true });
  await t.goto(BASE + "/students");
  await t.locator("ul li a").first().click();
  await t.waitForURL("**/students/*");
  await t.screenshot({ path: SHOT + "15-student.png", fullPage: true });
  await t.goto(t.url() + "?tab=attendance");
  await t.screenshot({ path: SHOT + "16-student-attendance.png", fullPage: true });

  step("ครูพยายามเปิดหน้าตั้งค่า → ถูกพากลับหน้าแรก");
  await t.goto(BASE + "/settings");
  if (new URL(t.url()).pathname !== "/") throw new Error("ครูเข้าหน้าตั้งค่าได้");

  step("ผู้ดูแลระบบดูหน้าแรก รายงานรายวัน และประวัติการแก้ไข");
  await a.goto(BASE + "/");
  await a.screenshot({ path: SHOT + "17-home-admin.png", fullPage: true });
  await a.goto(BASE + "/reports?tab=daily");
  await a.screenshot({ path: SHOT + "18-report-daily.png", fullPage: true });
  await a.goto(BASE + "/audit");
  await a.screenshot({ path: SHOT + "19-audit.png", fullPage: true });
  await a.goto(BASE + "/manual");
  await a.screenshot({ path: SHOT + "20-manual.png" });

  step("สร้างบัญชีชื่อผู้ใช้ให้ครูใหม่ (server action)");
  await a.goto(BASE + "/staff");
  await a.getByRole("button", { name: "เพิ่มครู" }).click();
  await a.fill("#sf-first_name", "มานะ");
  await a.fill("#sf-last_name", "สอนดี");
  await a.getByRole("button", { name: "เพิ่มครู" }).last().click();
  await a.waitForURL(/\/staff\/[0-9a-f-]{36}/);
  await a.fill("#la-u", "mana.s");
  await a.fill("#la-p", "pass5678");
  await a.getByRole("button", { name: "สร้างบัญชีเข้าระบบ" }).click();
  await a.getByText("ชื่อผู้ใช้: ").waitFor();
  await a.screenshot({ path: SHOT + "21-staff-detail.png", fullPage: true });
  const p3 = await (await browser.newContext()).newPage();
  await p3.goto(BASE + "/login");
  await p3.fill("#username", "mana.s");
  await p3.fill("#password", "pass5678");
  await p3.click("button[type=submit]");
  await p3.waitForURL((u) => u.pathname === "/", { timeout: 15000 });
  console.log("   ครูใหม่เข้าระบบด้วยชื่อผู้ใช้ได้ทันที");

  await browser.close();
  if (errors.length) { console.log("JS errors:", errors); process.exit(1); }
  console.log("✅ ผ่านทุกขั้นตอน");
})().catch(async (e) => { console.error("❌", e.message); process.exit(1); });
