// ทดสอบนำเข้า DMC แบบย่อ (ภาคเรียนที่ 2) — ข้อมูลสมมติ รันหลัง tests/e2e/flow.cjs
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const XLSX = require("xlsx");
const SHOT = (process.env.SHOT_DIR || "/tmp/tsr-shots") + "/dmc-short-";
const BASE = "http://localhost:3000";
const sql = (q) => execSync(`psql "${process.env.E2E_DB || "postgres://postgres@127.0.0.1:54329/tsr_e2e"}" -Atc "${q}"`).toString().trim();
const step = (s) => console.log("▶", s);
const assert = (c, m) => { if (!c) throw new Error(m); };

(async () => {
  const dir = SHOT.replace(/dmc-short-$/, "");
  const year = sql("select current_year from school_settings");
  // ข้อมูลเดิมจาก DMC แบบเต็ม: ใส่เบอร์โทรให้คนแรก เพื่อตรวจว่าไฟล์แบบย่อไม่ลบทิ้ง
  const first = sql(`select s.id from enrollments e join students s on s.id = e.student_id join classrooms c on c.id = e.classroom_id where e.year = ${year} and c.grade = 'ป.4' and c.room = 1 order by e.number limit 1`);
  sql(`update students set father_phone = '0899999999', first_name_en = 'Test' where id = '${first}'`);
  const rows = sql(`select s.citizen_id || '|' || coalesce(s.student_code,'') || '|' || c.grade || '|' || c.room || '|' || coalesce(s.gender,'') || '|' || coalesce(s.prefix,'') || '|' || s.first_name || '|' || s.last_name || '|' || (s.id = '${first}') from enrollments e join students s on s.id = e.student_id join classrooms c on c.id = e.classroom_id where e.year = ${year} and s.status = 'studying' order by c.grade, c.room, e.number`).split("\n").map((l) => l.split("|"));
  const head = ["รหัสโรงเรียน", "ชื่อโรงเรียน", "เลขประจำตัวนักเรียน", "ชั้น", "ห้อง", "เลขประจำตัวนักเรียน", "เพศ", "คำนำหน้าชื่อ", "ชื่อ", "นามสกุล", "วันเกิด", "อายุ(ปี)", "น้ำหนัก", "ส่วนสูง", "กลุ่มเลือด", "ศาสนา", "เชื้อชาติ", "สัญชาติ", "บ้านเลขที่", "หมู่", "ถนน/ซอย", "ตำบล", "อำเภอ", "จังหวัด", "คำนำหน้าชื่อผู้ปกครอง", "ชื่อผู้ปกครอง", "นามสกุลผู้ปกครอง", "อาชีพของผู้ปกครอง", "ความเกี่ยวข้องของผู้ปกครองกับนักเรียน"];
  const body = rows.map(([cid, code, grade, room, g, prefix, fn, ln, isFirst]) =>
    ["99999999", "โรงเรียนทดสอบ", cid, grade, isFirst === "true" ? 2 : Number(room), code, g, prefix, fn, ln, "01/05/2561", 8, 25, 125, "-", "พุทธ", "ไทย", "ไทย", "9", "1", "-", "บ้านกลาง", "สอง", "แพร่", "นาง", "แม่", ln, "รับจ้าง", "มารดา"]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, ...body]), "Sheet1");
  XLSX.writeFile(wb, `${dir}/dmc-short.xlsx`);

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const errors = [];
  const a = await (await browser.newContext({ viewport: { width: 1180, height: 900 } })).newPage();
  a.on("pageerror", (e) => errors.push(e.message));
  await a.goto(BASE + "/login"); await a.fill("#username", "admin.test"); await a.fill("#password", "pass1234"); await a.click("button[type=submit]");
  await a.waitForURL((u) => !u.pathname.startsWith("/login"));

  step("นำเข้า DMC แบบย่อ → ระบบรู้จักไฟล์และแจ้งว่าจะคงเบอร์โทรเดิม");
  await a.goto(BASE + "/students/import");
  await a.setInputFiles("#imp-file", `${dir}/dmc-short.xlsx`);
  await a.getByText(/อ่านได้/).waitFor();
  assert((await a.locator("main").innerText()).includes(`อ่านได้ ${rows.length} คน`), "จำนวนนักเรียนที่อ่านได้ไม่ตรง");
  await a.getByText(/DMC แบบย่อ/).waitFor();
  await a.screenshot({ path: SHOT + "01-check.png", fullPage: true });
  await a.getByRole("button", { name: "ถัดไป ›" }).click();
  await a.getByRole("button", { name: /ยืนยันนำเข้า/ }).click();
  await a.getByText(/นำเข้าเรียบร้อย|นำเข้าเสร็จ/).first().waitFor({ timeout: 60000 });

  const s = sql(`select father_phone || '|' || first_name_en || '|' || weight_dmc || '|' || (select c.room from enrollments e join classrooms c on c.id = e.classroom_id where e.student_id = s.id and e.year = ${year}) from students s where id = '${first}'`);
  console.log(`   คนแรก: เบอร์บิดา/ชื่ออังกฤษ/น้ำหนัก/ห้อง = ${s}`);
  assert(s === "0899999999|Test|25.0|2", "ต้องคงเบอร์โทรและชื่ออังกฤษ อัปเดตน้ำหนักและย้ายห้อง");
  await browser.close();
  if (errors.length) { console.error("❌ JS errors:", errors); process.exit(1); }
  console.log("✅ นำเข้า DMC แบบย่อผ่านทุกขั้นตอน");
})().catch((e) => { console.error("❌", e.message); process.exit(1); });
