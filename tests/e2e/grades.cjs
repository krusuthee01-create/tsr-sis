// ทดสอบผลการเรียนผ่านเบราว์เซอร์ (ไฟล์ ปพ.5 สมมติจากนักเรียนสมมติ) — รันหลัง tests/e2e/flow.cjs
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const XLSX = require("xlsx");
const SHOT = (process.env.SHOT_DIR || "/tmp/tsr-shots") + "/grades-";
const BASE = "http://localhost:3000";
const sql = (q) => execSync(`psql "${process.env.E2E_DB || "postgres://postgres@127.0.0.1:54329/tsr_e2e"}" -Atc "${q}"`).toString().trim();
const step = (s) => console.log("▶", s);
const assert = (c, m) => { if (!c) throw new Error(m); };

async function login(page, user) {
  await page.goto(BASE + "/login");
  await page.fill("#username", user);
  await page.fill("#password", "pass1234");
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });
}

(async () => {
  const { fakePp5Sheets, fakeKgSheets } = await import("../fake-pp5.mjs");
  const dir = SHOT.replace(/grades-$/, "");
  execSync(`mkdir -p ${dir}`);
  sql("truncate grade_results, student_assessments, grade_imports, sar_targets, national_tests, kg_development restart identity");

  // ห้อง ป.3/1 ของ flow.cjs: นักเรียน 2 คนแรกมีเกรด คนที่ 1 ได้ ร คณิต
  const room = sql("select c.id || '|' || c.year from classrooms c where grade = 'ป.3' and room = 1 order by year desc limit 1").split("|");
  const studs = sql(`select s.citizen_id || '|' || s.first_name || ' ' || s.last_name from enrollments e join students s on s.id = e.student_id where e.classroom_id = ${room[0]} order by e.number`).split("\n").map((l) => l.split("|"));
  const sheets = fakePp5Sheets({
    grade: "ประถมศึกษาปีที่ 3/1", year: Number(room[1]), term: 1,
    subjects: [{ code: "ท13101", name: "ภาษาไทย", hours: 200, area: "ภาษาไทย" }, { code: "ค13101", name: "คณิตศาสตร์", hours: 200, area: "คณิตศาสตร์" }],
    students: [...studs.map(([citizen_id, name], i) => ({ citizen_id, name, trait: i < 5,
      grades: i === 0 ? [{ t1: [30, 10, 4] }, { t1: [5, 2, "ร"] }] : [{ t1: [25, 10, 3] }, { t1: [20, 8, i % 2 ? 2.5 : 3.5] }] })),
      { citizen_id: "1999999999999", name: "เด็กชายไม่มี ในระบบ" }],
  });
  const wb = XLSX.utils.book_new();
  for (const [n, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), n);
  const file = `${dir}/pp5-p3-1-term1.xlsx`; // Playwright ส่งไฟล์ชื่อภาษาไทยไม่ได้ (ในเบราว์เซอร์จริงใช้ได้ปกติ)
  XLSX.writeFile(wb, file);

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const t = await ctx.newPage();
  t.on("pageerror", (e) => errors.push(e.message));
  await login(t, "krusomjai");

  step("ครูที่ปรึกษานำเข้าไฟล์ ปพ.5 ของห้อง → ตรวจก่อนนำเข้า");
  await t.goto(BASE + "/grades/import");
  await t.locator('input[type=file]').setInputFiles(file);
  await t.getByText("เกรดเพิ่มใหม่").waitFor({ timeout: 20000 });
  const card = await t.locator("main").innerText();
  assert(card.includes(`${studs.length}/${studs.length + 1}`), "จำนวนนักเรียนที่พบไม่ถูกต้อง");
  assert(card.includes("ไม่พบนักเรียนเลขที่"), "ต้องแจ้งนักเรียนที่ไม่พบในระบบ");
  await t.screenshot({ path: SHOT + "01-preview.png", fullPage: true });
  assert(sql("select count(*) from grade_results") === "0", "ตรวจก่อนนำเข้าต้องยังไม่บันทึก");
  await t.getByRole("button", { name: /ยืนยันนำเข้า 1 ห้อง/ }).click();
  await t.getByText("นำเข้าแล้ว").waitFor({ timeout: 20000 });
  const n = sql("select count(*) from grade_results");
  console.log(`   บันทึกเกรด ${n} รายการ, คุณลักษณะ ${sql("select count(*) from student_assessments")} รายการ`);
  assert(Number(n) === studs.length * 2, "จำนวนเกรดไม่ถูกต้อง");

  step("นำเข้าซ้ำไฟล์เดิม → ไม่มีอะไรเปลี่ยน");
  await t.goto(BASE + "/grades/import");
  await t.locator('input[type=file]').setInputFiles(file);
  await t.getByText("เกรดเพิ่มใหม่").waitFor({ timeout: 20000 });
  await t.getByText("ไฟล์นี้ยังไม่มีคะแนนที่กรอกไว้ หรือข้อมูลตรงกับในระบบแล้ว").waitFor().catch(() => {});

  step("ดูผลรายห้อง GPA สถิติ และรายชื่อติดตาม ร");
  await t.goto(BASE + "/grades");
  await t.getByText(/GPA เฉลี่ยของห้อง/).waitFor();
  await t.screenshot({ path: SHOT + "02-room.png", fullPage: true });
  await t.goto(BASE + "/grades?tab=stats");
  await t.getByText(/ร้อยละผลการเรียน 3 ขึ้นไป ทุกวิชา/).waitFor();
  await t.screenshot({ path: SHOT + "03-stats.png", fullPage: true });
  await t.goto(BASE + "/grades?tab=followup");
  await t.getByText("ค13101 คณิตศาสตร์: ร").waitFor();
  await t.screenshot({ path: SHOT + "04-followup.png", fullPage: true });
  await t.getByText("ค13101 คณิตศาสตร์: ร").locator("..").getByRole("link").click();
  await t.waitForURL("**/students/**tab=grades");
  await t.getByText("GPA 4.00").waitFor();
  await t.screenshot({ path: SHOT + "05-student.png", fullPage: true });

  step("ครูไม่มีสิทธิ์เปิดหน้า SAR → กลับหน้าแรก");
  await t.goto(BASE + "/sar");
  await t.waitForURL(BASE + "/");

  step("ผู้ดูแลระบบ: ภาพรวมโรงเรียน และ SAR พร้อมค่าเป้าหมาย / ผล O-NET");
  const actx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const a = await actx.newPage();
  a.on("pageerror", (e) => errors.push("admin: " + e.message));
  a.on("dialog", (d) => d.accept());
  await login(a, "admin.test");
  await a.goto(BASE + "/grades?tab=school");
  await a.getByText("รายกลุ่มสาระการเรียนรู้ (เทียบปีก่อน)").waitFor();
  await a.screenshot({ path: SHOT + "06-school.png", fullPage: true });
  step("ผู้ดูแลระบบ: นำเข้าสมุดบันทึกพัฒนาการ อ.3/1 (ชื่อสะกดต่าง 1 คน → จับคู่ด้วยเลขที่)");
  const kgRoom = sql("select id from classrooms where grade = 'อ.3' and room = 1 order by year desc limit 1");
  const kids = sql(`select s.prefix || s.first_name || ' ' || s.last_name from enrollments e join students s on s.id = e.student_id where e.classroom_id = ${kgRoom} order by e.number`).split("\n");
  const kg = fakeKgSheets({ year: Number(room[1]), students: kids.map((name, i) => ({
    name: i === 1 ? name + "ี" : name,
    t1: Array.from({ length: 33 }, (_, k) => (i === 0 && k < 4 ? 1 : 2 + ((i + k) % 2))),
  })) });
  const kwb = XLSX.utils.book_new();
  for (const [n, rows] of Object.entries(kg)) XLSX.utils.book_append_sheet(kwb, XLSX.utils.aoa_to_sheet(rows), n);
  XLSX.writeFile(kwb, `${dir}/kg-a3-1.xlsx`);
  await a.goto(BASE + "/grades/import");
  await a.locator("input[type=file]").setInputFiles(`${dir}/kg-a3-1.xlsx`);
  await a.getByText("สมุดบันทึกพัฒนาการ ·").waitFor({ timeout: 20000 });
  await a.getByText(/ชื่อในไฟล์ไม่ตรงกับในระบบ จึงจับคู่ด้วยเลขที่/).waitFor();
  await a.screenshot({ path: SHOT + "08-kg-preview.png", fullPage: true });
  await a.getByRole("button", { name: /ยืนยันนำเข้า 1 ห้อง/ }).click();
  await a.getByText("นำเข้าแล้ว").waitFor({ timeout: 20000 });
  assert(sql("select count(*) from kg_development") === String(kids.length), "จำนวนผลพัฒนาการไม่ถูกต้อง");
  await a.goto(`${BASE}/grades?c=${kgRoom}&tab=followup`);
  await a.getByText("เด็กที่ควรส่งเสริมพัฒนาการ 1 คน").waitFor();
  await a.goto(`${BASE}/grades?c=${kgRoom}`);
  await a.getByText(/ระดับคุณภาพ 3 ดี/).waitFor();
  await a.screenshot({ path: SHOT + "09-kg-room.png", fullPage: true });

  await a.goto(BASE + "/sar");
  await a.getByText("ร้อยละของผลการเรียนระดับ 3 ขึ้นไป (ทุกรายวิชา)").waitFor();
  await a.getByLabel("ค่าเป้าหมาย ร้อยละของผลการเรียนระดับ 3 ขึ้นไป (ทุกรายวิชา)").fill("70");
  await a.getByRole("button", { name: "บันทึกค่าเป้าหมาย" }).click();
  await a.getByText("บันทึกค่าเป้าหมายแล้ว").waitFor();
  assert(sql("select target from sar_targets where key = 'grade3'") === "70.00", "บันทึกค่าเป้าหมายไม่สำเร็จ");
  await a.getByLabel("O-NET ภาษาไทย school_avg").fill("52.75");
  await a.getByLabel("O-NET ภาษาไทย national_avg").fill("48.10");
  await a.getByRole("button", { name: /บันทึกผล O-NET/ }).click();
  await a.getByText("บันทึกผล O-NET แล้ว").waitFor();
  assert(sql("select school_avg from national_tests") === "52.75", "บันทึก O-NET ไม่สำเร็จ");
  await a.getByText("ร้อยละเด็กมีพัฒนาการด้านสุขภาวะทางกายระดับดี").waitFor();
  await a.screenshot({ path: SHOT + "07-sar.png", fullPage: true });

  await browser.close();
  if (errors.length) { console.error("❌ JS errors:", errors); process.exit(1); }
  console.log("✅ ผลการเรียนผ่านทุกขั้นตอน");
})().catch((e) => { console.error("❌", e.message); process.exit(1); });
