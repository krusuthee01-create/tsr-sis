// ทดสอบระบบดูแลช่วยเหลือผ่านเบราว์เซอร์ (ข้อมูลสมมติ) — รันหลัง tests/e2e/flow.cjs
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const SHOT = (process.env.SHOT_DIR || "/tmp/tsr-shots") + "/care-";
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
  execSync(`mkdir -p ${SHOT.replace(/care-$/, "")}`);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const errors = [];
  sql("truncate interventions, home_visits, sdq_results, eq_results, screenings; update school_settings set eq_ranges = '{}'");
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, permissions: ["geolocation"], geolocation: { latitude: 15.6935, longitude: 100.1267 } });
  const t = await ctx.newPage();
  t.on("pageerror", (e) => errors.push(e.message));
  t.on("dialog", (d) => d.accept());
  await login(t, "krusomjai");

  step("ครูที่ปรึกษาเปิดเมนูดูแลช่วยเหลือ → คัดกรอง (ระบบเสนอผล)");
  await t.goto(BASE + "/care");
  await t.getByText("ยืนยันแล้ว 0/").waitFor();
  await t.screenshot({ path: SHOT + "01-screening.png", fullPage: true });
  // ปรับคนแรกด้านเศรษฐกิจเป็น "มีปัญหา" โดยไม่ใส่เหตุผล → ต้องเตือน
  await t.getByRole("radiogroup", { name: /^เศรษฐกิจ/ }).first().getByRole("radio", { name: /มีปัญหา/ }).click();
  await t.getByRole("button", { name: /ยืนยันผลคัดกรองทั้งห้อง/ }).click();
  await t.getByText(/กรุณาระบุเหตุผล/).waitFor();
  await t.getByPlaceholder("เหตุผลที่ปรับ (จำเป็น)").first().fill("ผู้ปกครองตกงาน");
  await t.getByRole("button", { name: /ยืนยันผลคัดกรองทั้งห้อง/ }).click();
  await t.getByText(/ยืนยันผลคัดกรอง \d+ คนแล้ว/).waitFor();
  const n = sql("select count(*) from screenings");
  const problem = sql("select count(*) from screenings where economic = 3 and notes->>'economic' = 'ผู้ปกครองตกงาน'");
  console.log(`   ยืนยันแล้ว ${n} คน, ปรับเศรษฐกิจพร้อมเหตุผล ${problem} คน`);
  assert(Number(n) > 0 && problem === "1", "บันทึกผลคัดกรองไม่ถูกต้อง");

  step("SDQ ฉบับครู: ตอบ 25 ข้อ เห็นคะแนนทันที แล้วบันทึก");
  await t.goto(BASE + "/care?tab=assess");
  await t.screenshot({ path: SHOT + "02-assess.png", fullPage: true });
  await t.locator('a[href*="/care/sdq/"][href*="informant=teacher"]').first().click();
  await t.waitForURL("**/care/sdq/**");
  for (let i = 1; i <= 25; i++) {
    const v = [3, 8, 13, 16, 24].includes(i) ? "จริงแน่นอน" : "ไม่จริง";
    await t.getByRole("radiogroup", { name: `ข้อ ${i}`, exact: true }).getByRole("radio", { name: v }).click();
  }
  await t.getByText(/รวมปัญหา \d+/).waitFor();
  await t.screenshot({ path: SHOT + "03-sdq.png" });
  await t.getByRole("button", { name: "บันทึกผล SDQ" }).click();
  await t.waitForURL("**/care?tab=assess**");
  const sdq = sql("select emotional || ',' || total || ',' || level from sdq_results");
  console.log(`   SDQ emotional,total,level = ${sdq}`);
  assert(sdq === "10,20,3", "คะแนน SDQ ไม่ตรง (อารมณ์ 10 + ข้อกลับคะแนน 10 = 20 มีปัญหา)");

  step("EQ: กรอกคะแนนรวมรายด้าน (ยังไม่ตั้งช่วงปกติ)");
  await t.locator('a[href*="/care/eq/"]').first().click();
  await t.waitForURL("**/care/eq/**");
  await t.getByPlaceholder("คะแนนรวมด้านนี้").nth(0).fill("50");
  await t.getByPlaceholder("คะแนนรวมด้านนี้").nth(1).fill("48");
  await t.getByPlaceholder("คะแนนรวมด้านนี้").nth(2).fill("55");
  await t.screenshot({ path: SHOT + "04-eq.png", fullPage: true });
  await t.getByRole("button", { name: "บันทึกผล EQ" }).click();
  await t.waitForURL("**/care?tab=assess**");
  assert(sql("select good || ',' || smart || ',' || happy from eq_results") === "50.0,48.0,55.0", "บันทึก EQ ไม่ถูกต้อง");

  step("เยี่ยมบ้าน: ข้อมูลจาก DMC เติมให้ ระบุ GPS เลือกความเสี่ยง แล้วบันทึก");
  await t.goto(BASE + "/care?tab=visits");
  await t.locator('a[href^="/care/visit/"]').first().click();
  await t.waitForURL("**/care/visit/**");
  await t.getByRole("button", { name: "ระบุตำแหน่งปัจจุบัน" }).click();
  await t.getByText("15.6935, 100.1267").waitFor();
  await t.getByRole("button", { name: "มารดา", exact: true }).click();
  await t.getByLabel("จำนวนสมาชิกในบ้าน (คน)").fill("4");
  await t.getByLabel("รายได้รวมของครอบครัว (บาท/เดือน)").fill("10000");
  await t.getByText("เฉลี่ย 2,500 บาท/คน/เดือน").waitFor();
  await t.getByRole("button", { name: "ความรุนแรงในครอบครัว" }).click();
  await t.getByLabel("สรุปผลการเยี่ยมบ้าน (ครู)").fill("ครอบครัวอบอุ่น แต่รายได้น้อย");
  await t.screenshot({ path: SHOT + "05-visit.png", fullPage: true });
  await t.getByRole("button", { name: "บันทึกการเยี่ยมบ้าน", exact: true }).click();
  await t.waitForURL("**/care?tab=visits**");
  const visit = sql("select household_size || ',' || monthly_income || ',' || safety_risk || ',' || latitude || ',' || (data->>'living_with') from home_visits");
  console.log(`   home_visits: ${visit}`);
  assert(visit === "4,10000,true,15.693500,มารดา", "บันทึกเยี่ยมบ้านไม่ถูกต้อง");

  step("คัดกรองอีกครั้ง: ระบบเสนอเศรษฐกิจ/ความปลอดภัย/พฤติกรรมจากข้อมูลใหม่");
  const sid = sql("select student_id from home_visits");
  await t.goto(BASE + "/care");
  for (const txt of ["รายได้ 2,500 บาท/คน/เดือน", "พบความเสี่ยงตอนเยี่ยมบ้าน", "SDQ ฉบับครู: มีปัญหา"])
    await t.getByText(txt).first().waitFor({ timeout: 5000 }).catch(() => { throw new Error("ข้อเสนอผลคัดกรองไม่ใช้ข้อมูลใหม่: " + txt); });
  // การมาเรียนคิดจากวันที่บันทึกแล้ว: นักเรียนส่วนใหญ่มาครบ → ไม่ควรถูกเสนอเป็นกลุ่มมีปัญหาทั้งห้อง
  assert(Number(sql("select count(*) from screenings where learning = 3")) <= 1, "ด้านการเรียนถูกเสนอเป็นมีปัญหาเกินจริง");

  step("หน้าแรก: แจ้งเตือนนักเรียนกลุ่มเสี่ยงที่ยังไม่มีบันทึกช่วยเหลือ");
  await t.goto(BASE + "/");
  await t.getByText("ยังไม่มีบันทึกการช่วยเหลือเกิน 14 วัน").waitFor({ timeout: 5000 }).catch(() => { throw new Error("ไม่พบการแจ้งเตือนดูแลช่วยเหลือที่หน้าแรก"); });
  await t.screenshot({ path: SHOT + "08-home.png", fullPage: true });

  await t.getByRole("link", { name: /กลุ่มมีปัญหา/ }).first().waitFor();
  step("ติดตาม: บันทึกการช่วยเหลือในหน้าประวัตินักเรียน");
  await t.goto(BASE + "/care?tab=followup");
  await t.screenshot({ path: SHOT + "06-followup.png", fullPage: true });
  await t.goto(`${BASE}/students/${sid}?tab=care`);
  await t.getByRole("button", { name: "บันทึกการช่วยเหลือ", exact: true }).click();
  await t.getByLabel(/กิจกรรม\/วิธีการช่วยเหลือ/).fill("พูดคุยรายบุคคล และประสานผู้ปกครอง");
  await t.getByRole("button", { name: "บันทึก", exact: true }).click();
  await t.getByText("บันทึกการช่วยเหลือแล้ว").waitFor();
  await t.getByText("พูดคุยรายบุคคล และประสานผู้ปกครอง").waitFor();
  await t.screenshot({ path: SHOT + "07-student-care.png", fullPage: true });
  await t.getByRole("combobox", { name: "สถานะ" }).selectOption("improved");
  await t.getByText("เปลี่ยนสถานะแล้ว").waitFor();
  assert(sql("select status from interventions") === "improved", "เปลี่ยนสถานะไม่สำเร็จ");
  await t.goto(BASE + "/");
  assert(!(await t.locator(`a[href="/students/${sid}?tab=care"]`).count()), "บันทึกช่วยเหลือแล้วแต่ยังแจ้งเตือนอยู่");

  step("ผู้ดูแลระบบ: ตั้งช่วงปกติ EQ แล้วระบบแปลผลเดิมใหม่ / ดูภาพรวมโรงเรียน");
  const actx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const a = await actx.newPage();
  a.on("pageerror", (e) => errors.push("admin: " + e.message));
  await login(a, "admin.test");
  await a.goto(BASE + "/settings?s=care");
  await a.getByLabel("EQ 6-11 ดี ต่ำสุด").fill("48");
  await a.getByLabel("EQ 6-11 ดี สูงสุด").fill("58");
  await a.screenshot({ path: SHOT + "09-settings.png", fullPage: true });
  await a.getByRole("button", { name: "บันทึกเกณฑ์และแปลผลใหม่" }).click();
  await a.getByText(/บันทึกเกณฑ์แล้ว/).waitFor();
  assert(sql("select levels->>'good' from eq_results") === "1", "EQ ไม่ถูกแปลผลใหม่");
  await a.goto(BASE + "/care");
  await a.getByText("ภาพรวมโรงเรียน").first().waitFor();
  await a.screenshot({ path: SHOT + "10-overview.png", fullPage: true });

  await browser.close();
  if (errors.length) { console.error("❌ JS errors:", errors); process.exit(1); }
  console.log("✅ ระบบดูแลช่วยเหลือผ่านทุกขั้นตอน");
})().catch((e) => { console.error("❌", e.message); process.exit(1); });
