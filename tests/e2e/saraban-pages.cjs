// ทดสอบเลือกหน้าที่จะวางคำเสนอ (หนังสือหลายหน้า) — รันหลัง tests/e2e/saraban.cjs (ใช้ผู้ใช้ชุดเดียวกัน)
// node tests/e2e/saraban-pages.cjs   (E2E_DB, SHOT_DIR, SARABAN_DRIVE_FAKE_DIR ปรับได้)
const { chromium } = require("playwright");
const { PDFDocument, StandardFonts } = require("pdf-lib");
const fs = require("fs");
const { execSync } = require("child_process");
const sql = (q) => execSync(`psql "${process.env.E2E_DB || "postgres://postgres@127.0.0.1:54329/tsr_e2e"}" -Atc "${q}"`).toString().trim();
const ok = (c, m) => { if (!c) throw new Error(m); console.log("   ✓", m); };
const B = (process.env.E2E_ORIGIN || "http://localhost:3000") + "/sis";
const FAKE = process.env.SARABAN_DRIVE_FAKE_DIR || "/tmp/saraban-fake";
(async () => {
  const dir = process.env.SHOT_DIR || "/tmp/tsr-shots/saraban";
  fs.mkdirSync(dir, { recursive: true });
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 4; i++) doc.addPage([595.28, 841.89]).drawText(`Four-page letter - page ${i + 1}`, { x: 60, y: 760, size: 20, font });
  fs.writeFileSync(dir + "/four.pdf", await doc.save());

  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })).newPage();
  p.on("pageerror", (e) => { throw e; });
  await p.goto(B + "/login"); await p.fill("#username", "krusomjai"); await p.fill("#password", "pass1234"); await p.click("button[type=submit]");
  await p.waitForURL((x) => !x.pathname.startsWith("/sis/login"));
  await p.goto(B + "/saraban/new");
  await p.setInputFiles("#saraban-file", dir + "/four.pdf");
  await p.getByText("4 หน้า").waitFor();
  await p.fill("#fromOrg", "สำนักงานเขตพื้นที่การศึกษาทดสอบ");
  await p.fill("#subject", "หนังสือ 4 หน้า (ทดสอบเลือกหน้า)");
  await p.getByRole("button", { name: "ลงรับ", exact: true }).click();
  await p.waitForURL(/\/saraban\/book\//, { timeout: 60000 });
  const bookId = p.url().split("/").pop();
  await p.getByRole("button", { name: "เรียน ผอ.", exact: true }).tap();
  await p.getByRole("button", { name: "เสนอ ผอ.", exact: true }).tap();
  await p.getByText("วางคำเสนอและยืนยัน").waitFor();
  const area = p.getByRole("application", { name: /แตะเพื่อวางคำเสนอ/ });
  await area.locator("canvas").waitFor();
  ok(await p.getByText("หน้า 4 / 4").isVisible(), "ค่าเริ่มต้นเปิดหน้าสุดท้าย (4/4)");
  ok(await p.getByRole("group", { name: /เลือกหน้าที่จะวางคำเสนอ/ }).isVisible(), "มีปุ่มเลือกหน้า");
  await p.getByRole("button", { name: "2", exact: true }).tap();
  await p.getByText("หน้า 2 / 4").waitFor();
  await p.waitForTimeout(500);
  const box = await area.boundingBox();
  await area.click({ position: { x: box.width * 0.06, y: box.height * 0.85 } });
  await p.screenshot({ path: dir + "/pages-picker.png" });
  await p.getByRole("button", { name: "ยืนยัน", exact: true }).tap();
  await p.getByText("เสนอ ผอ. แล้ว").waitFor();
  const fileId = sql(`select f.drive_file_id from saraban_actions a join saraban_files f on f.id = a.file_id where a.book_id = '${bookId}' and a.action = 'propose'`);
  ok(!!fileId, "คำเสนอลงไฟล์ฉบับใหม่");
  // หมึกสีน้ำเงินต่อหน้า: หน้า 1 มีตรารับ หน้า 2 มีคำเสนอ หน้า 3–4 ว่าง
  execSync(`rm -f "${dir}"/proposed-*.png && pdftoppm -png -r 72 "${FAKE}/${fileId}.pdf" "${dir}/proposed"`);
  const blue = execSync(`python3 -c "
from PIL import Image
import glob
for f in sorted(glob.glob('${dir}/proposed-*.png')):
    im=Image.open(f).convert('RGB'); w,h=im.size
    print(sum(1 for x in range(0,w,2) for y in range(0,h,2) if (lambda p: p[2] - p[0] > 60)(im.getpixel((x,y)))))"`).toString().trim().split("\n").map(Number);
  console.log("   หมึกน้ำเงินต่อหน้า:", blue.join(", "));
  ok(blue.length === 4 && blue[0] > 10 && blue[1] > 10 && blue[2] === 0 && blue[3] === 0, "คำเสนออยู่หน้า 2 ตามที่เลือก");
  await b.close();
  console.log("✅ ผ่าน");
})().catch((e) => { console.error(e); process.exit(1); });
