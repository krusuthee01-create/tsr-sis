// ทดสอบบันทึกข้อความภายใน + แตะเลือกตำแหน่งตรารับ ผ่านเบราว์เซอร์ (ข้อมูลสมมติ) — รันหลัง tests/e2e/saraban.cjs (ใช้ผู้ใช้ชุดเดียวกัน)
// node tests/e2e/saraban-memo.cjs   (E2E_DB, SHOT_DIR, SARABAN_DRIVE_FAKE_DIR ปรับได้; ต้องมี pdftoppm สำหรับภาพตรวจ)
const { chromium } = require("playwright");
const { PDFDocument } = require("pdf-lib");
const fs = require("fs");
const { execSync } = require("child_process");
const sql = (q) => execSync(`psql "${process.env.E2E_DB || "postgres://postgres@127.0.0.1:54329/tsr_e2e"}" -Atc "${q}"`).toString().trim();
const ok = (c, m) => { if (!c) throw new Error(m); console.log("   ✓", m); };
const B = (process.env.E2E_ORIGIN || "http://localhost:3000") + "/sis";
const FAKE = process.env.SARABAN_DRIVE_FAKE_DIR || "/tmp/saraban-fake";
async function login(b, u, mobile) {
  const ctx = await b.newContext(mobile ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => { throw e; });
  await p.goto(B + "/login"); await p.fill("#username", u); await p.fill("#password", "pass1234"); await p.click("button[type=submit]");
  await p.waitForURL((x) => !x.pathname.startsWith("/sis/login"));
  return p;
}
const png = (pdf, out) => execSync(`pdftoppm -png -r 60 -singlefile "${pdf}" "${out}"`);

(async () => {
  const dir = process.env.SHOT_DIR || "/tmp/tsr-shots/saraban";
  fs.mkdirSync(dir, { recursive: true });
  sql("delete from saraban_outgoing where kind = 'memo'; delete from saraban_counters where kind = 'memo'");
  const b = await chromium.launch();

  // 1) ครูเขียนบันทึกข้อความบนมือถือ: พรีวิว A4 → ส่ง → ได้เลข ศธ 04109.84/บ 1 → เข้าเป็นหนังสือภายในที่ธุรการ
  const t = await login(b, "teacher.test", true);
  await t.goto(B + "/saraban");
  await t.getByRole("link", { name: /เขียนบันทึกข้อความ/ }).click();
  await t.fill("#memo-subject", "ขออนุญาตพานักเรียนไปทัศนศึกษา");
  await t.fill("#memo-cause", "ด้วยกลุ่มสาระการเรียนรู้วิทยาศาสตร์และเทคโนโลยี มีกำหนดจัดกิจกรรมทัศนศึกษาแหล่งเรียนรู้นอกสถานที่ สำหรับนักเรียนชั้นประถมศึกษาปีที่ ๕ จำนวน ๔๕ คน ในวันศุกร์ที่ ๔ ธันวาคม ๒๕๖๙");
  await t.fill("#memo-intent", "ในการนี้ ข้าพเจ้าจึงขออนุญาตนำนักเรียนไปทัศนศึกษา ณ อุทยานวิทยาศาสตร์ จังหวัดแพร่ โดยมีครูผู้ควบคุม ๓ คน");
  await t.getByAltText("ตัวอย่างบันทึกข้อความ หน้า 1").waitFor();
  await t.waitForTimeout(800); // พรีวิวหน่วง 400ms หลังพิมพ์
  await t.screenshot({ path: dir + "/memo-form.png", fullPage: true });
  await t.getByRole("button", { name: /ส่งถึงธุรการ/ }).click();
  await t.waitForURL(/\/sis\/saraban\/book\//, { timeout: 60000 });
  const bookId = t.url().split("/").pop();
  const row = sql(`select b.doc_type || '|' || b.status || '|' || s.saraban_role || '|' || o.doc_no from saraban_books b join staff s on s.id = b.current_holder join saraban_outgoing o on o.book_id = b.id where b.id = '${bookId}'`);
  console.log("   ", row);
  ok(/^internal\|registered\|clerk\|ศธ 04109\.84\/บ 1$/.test(row), "บันทึกข้อความเลข บ 1 เข้าเป็นหนังสือภายในที่ธุรการ");
  const fileId = sql(`select drive_file_id from saraban_files where book_id = '${bookId}' and kind = 'original'`);
  ok(fileId && fs.existsSync(`${FAKE}/${fileId}.pdf`), "PDF บันทึกข้อความอัปโหลดเป็นต้นฉบับ");
  const memoPdf = await PDFDocument.load(fs.readFileSync(`${FAKE}/${fileId}.pdf`));
  const sz = memoPdf.getPage(0).getSize();
  ok(Math.abs(sz.width - 595.28) < 1 && Math.abs(sz.height - 841.89) < 1, "ไฟล์เป็น A4");
  png(`${FAKE}/${fileId}.pdf`, dir + "/memo-pdf");
  await t.screenshot({ path: dir + "/memo-book.png", fullPage: true });
  // แท็บ "บันทึกของฉัน"
  await t.goto(B + "/saraban?f=mine");
  await t.getByText("ขออนุญาตพานักเรียนไปทัศนศึกษา").first().waitFor();
  ok(true, "แท็บบันทึกของฉันแสดงบันทึกที่เขียน");

  // 2) ทะเบียนบันทึกข้อความในหน้าหนังสือส่ง
  await t.goto(B + "/saraban/out?s=memo");
  await t.getByText("ศธ 04109.84/บ 1").first().waitFor();
  ok((await t.getByRole("button", { name: /^ขอเลข/ }).count()) === 0, "ชุดบันทึกข้อความไม่มีปุ่มขอเลข (ออกเลขจากหน้าเขียน)");

  // 3) ธุรการลงรับหนังสือ แตะวางตรารับที่มุมล่างซ้ายของหน้า 1 (มือถือ: ภาพทั้งหน้าอยู่ในจอ)
  const doc = await PDFDocument.create(); doc.addPage([595.28, 841.89]); doc.addPage([595.28, 841.89]);
  fs.writeFileSync(dir + "/place.pdf", await doc.save());
  const k = await login(b, "krusomjai", true);
  await k.goto(B + "/saraban/new");
  await k.setInputFiles("#saraban-file", dir + "/place.pdf");
  await k.getByText("2 หน้า").waitFor();
  await k.fill("#fromOrg", "สำนักงานเขตพื้นที่การศึกษาทดสอบ");
  await k.fill("#subject", "ทดสอบวางตรารับ");
  await k.getByRole("button", { name: /เลือกตำแหน่ง/ }).click();
  const area = k.getByRole("application", { name: /แตะเพื่อวางตรารับ/ });
  await area.waitFor();
  await k.waitForTimeout(800);
  const box = await area.boundingBox();
  const confirm = await k.getByRole("button", { name: "ยืนยันตำแหน่ง" }).boundingBox();
  await k.screenshot({ path: dir + "/stamp-picker-mobile.png" });
  ok(box.y + box.height <= confirm.y, `ภาพทั้งหน้าอยู่เหนือปุ่มยืนยัน (ล่างภาพ ${Math.round(box.y + box.height)} ≤ ปุ่ม ${Math.round(confirm.y)})`);
  await area.click({ position: { x: box.width * 0.05, y: box.height * 0.8 } });
  await k.getByRole("button", { name: "ยืนยันตำแหน่ง" }).click();
  await k.getByText("หน้า 1 (เลือกเอง)").waitFor();
  await k.getByRole("button", { name: "ลงรับ", exact: true }).click();
  await k.waitForURL(/\/sis\/saraban\/book\//, { timeout: 60000 });
  const regId = k.url().split("/").pop();
  const stampedId = sql(`select drive_file_id from saraban_files where book_id = '${regId}' and kind = 'stamped'`);
  ok(!!stampedId, "อัปโหลดฉบับประทับตราแล้ว");
  png(`${FAKE}/${stampedId}.pdf`, dir + "/stamp-placed");
  // ตรวจตำแหน่งจากพิกเซล: ครึ่งล่างซ้ายมีหมึก ขวาบนว่าง
  const ink = execSync(`python3 -c "
from PIL import Image
im=Image.open('${dir}/stamp-placed.png').convert('L'); w,h=im.size
def dark(x0,y0,x1,y1): return sum(1 for x in range(int(x0*w),int(x1*w),2) for y in range(int(y0*h),int(y1*h),2) if im.getpixel((x,y))<160)
print(dark(0,0.7,0.6,1.0), dark(0.5,0,1,0.3))"`).toString().trim().split(" ").map(Number);
  ok(ink[0] > 50 && ink[1] === 0, `ตรารับอยู่ล่างซ้าย ไม่ใช่มุมขวาบน (หมึกล่างซ้าย ${ink[0]} / ขวาบน ${ink[1]})`);
  await b.close();
  console.log("✅ ผ่าน");
})().catch((e) => { console.error(e); process.exit(1); });
