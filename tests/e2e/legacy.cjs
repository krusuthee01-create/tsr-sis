// ทดสอบนำเข้าข้อมูลจากระบบเช็กชื่อเดิม (ไฟล์สมมติจากนักเรียนสมมติ) — รันหลัง tests/e2e/flow.cjs
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const XLSX = require("xlsx");
const SHOT = (process.env.SHOT_DIR || "/tmp/tsr-shots") + "/legacy-";
const BASE = "http://localhost:3000";
const sql = (q) => execSync(`psql "${process.env.E2E_DB || "postgres://postgres@127.0.0.1:54329/tsr_e2e"}" -Atc "${q}"`).toString().trim();
const step = (s) => console.log("▶", s);
const assert = (c, m) => { if (!c) throw new Error(m); };

(async () => {
  const { fakeLegacySheets } = await import("../fake-pp5.mjs");
  const dir = SHOT.replace(/legacy-$/, "");
  const days = ["2026-06-22", "2026-06-23", "2026-06-24", "2026-06-25", "2026-06-26"];
  sql(`delete from attendance_daily where date between '2026-06-01' and '2026-06-30'; delete from health_daily where date between '2026-06-01' and '2026-06-30'`);
  const kids = sql("select s.student_code || '|' || cl.grade || '/' || cl.room from enrollments e join students s on s.id = e.student_id join classrooms cl on cl.id = e.classroom_id where cl.grade in ('ป.3', 'อ.1') and cl.room = 1 and s.student_code is not null order by cl.grade, e.number")
    .split("\n").map((l) => l.split("|"));
  const sheets = fakeLegacySheets({
    days,
    students: [...kids.map(([code, cls], i) => ({ code, name: "ชื่อ", cls: cls.replace("อ.", "อนุบาล "), status: i === 0 ? ["มา", "ลา", "ขาด", "มา", "มา"] : undefined })),
      { code: "99999", name: "ไม่มีในระบบ", cls: "ป.3/1" }],
    weights: kids.slice(0, 5).map(([code, cls], i) => ({ code, cls, date: "2026-06-15", w: i === 0 ? 120 : 20 + i, h: i === 0 ? 24 : 118 + i })),
  });
  const wb = XLSX.utils.book_new();
  for (const [n, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), n);
  XLSX.writeFile(wb, `${dir}/legacy.xlsx`);

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const errors = [];
  const a = await (await browser.newContext({ viewport: { width: 1180, height: 900 } })).newPage();
  a.on("pageerror", (e) => errors.push(e.message));
  await a.goto(BASE + "/login"); await a.fill("#username", "admin.test"); await a.fill("#password", "pass1234"); await a.click("button[type=submit]");
  await a.waitForURL((u) => !u.pathname.startsWith("/login"));

  step("ผู้ดูแลระบบเลือกไฟล์ระบบเดิม → ตรวจก่อนนำเข้า");
  await a.goto(BASE + "/settings?s=legacy");
  await a.locator("input[type=file]").setInputFiles(`${dir}/legacy.xlsx`);
  await a.getByText("รายการเช็กชื่อที่จะนำเข้า").waitFor({ timeout: 30000 });
  await a.getByText(/ไม่พบเลขประจำตัว 1 คน/).waitFor();
  await a.getByText(/บันทึกเป็นลากิจ/).waitFor();
  await a.screenshot({ path: SHOT + "01-preview.png", fullPage: true });
  assert(sql("select count(*) from attendance_daily where date between '2026-06-22' and '2026-06-26'") === "0", "ตรวจก่อนนำเข้าต้องยังไม่บันทึก");

  step("ยืนยันนำเข้า");
  await a.getByRole("button", { name: /ยืนยันนำเข้าปีการศึกษา/ }).click();
  await a.getByText("นำเข้าเรียบร้อย", { exact: true }).waitFor({ timeout: 60000 });
  await a.screenshot({ path: SHOT + "02-done.png", fullPage: true });
  const n = sql("select count(*) from attendance_daily where date between '2026-06-22' and '2026-06-26'");
  console.log(`   เช็กชื่อ ${n} รายการ, ลาพร้อมหมายเหตุ ${sql("select count(*) from attendance_daily where note like 'ลา (นำเข้า%'")}, นม ${sql("select count(*) from health_daily where kind = 'milk' and date between '2026-06-22' and '2026-06-26'")}, น้ำหนัก ${sql("select count(*) from measurements m join measurement_rounds r on r.id = m.round_id where r.name = 'มิ.ย. 2569'")}`);
  assert(Number(n) === kids.length * days.length, "จำนวนเช็กชื่อไม่ถูกต้อง");
  assert(sql("select status from attendance_daily where note like 'ลา (นำเข้า%' limit 1") === "3", "ลาต้องเป็นลากิจ");
  assert(sql("select weight || '/' || height from measurements m join measurement_rounds r on r.id = m.round_id where r.name = 'มิ.ย. 2569' order by weight limit 1") === "21.00/119.0", "น้ำหนักไม่ถูกต้อง");
  assert(sql("select count(*) from measurements m join measurement_rounds r on r.id = m.round_id where r.name = 'มิ.ย. 2569' and weight = 24 and height = 120") === "1", "ต้องสลับน้ำหนัก/ส่วนสูงที่กรอกสลับช่อง");

  step("นำเข้าซ้ำ → ไม่เพิ่มข้อมูลซ้ำ");
  await a.goto(BASE + "/settings?s=legacy");
  await a.locator("input[type=file]").setInputFiles(`${dir}/legacy.xlsx`);
  await a.getByRole("button", { name: /ยืนยันนำเข้าปีการศึกษา/ }).click();
  await a.getByText(/เช็กชื่อใหม่ 0 รายการ/).waitFor({ timeout: 60000 });
  assert(sql("select count(*) from attendance_daily where date between '2026-06-22' and '2026-06-26'") === n, "นำเข้าซ้ำต้องไม่เพิ่ม");

  await browser.close();
  if (errors.length) { console.error("❌ JS errors:", errors); process.exit(1); }
  console.log("✅ นำเข้าจากระบบเดิมผ่านทุกขั้นตอน");
})().catch((e) => { console.error("❌", e.message); process.exit(1); });
