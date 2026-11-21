// ทดสอบสารบรรณผ่านเบราว์เซอร์พร้อมวัดเวลา (ข้อมูลสมมติทั้งหมด — PDF สร้างด้วย pdf-lib ในสคริปต์นี้)
// ก่อนรัน:
//   1) scripts/local-stack/start.sh แล้วคัดลอก /tmp/tsr-stack/env.local เป็น .env.local
//   2) เพิ่ม SARABAN_DRIVE_FAKE_DIR=/tmp/saraban-fake ใน .env.local (Drive จำลอง ไม่ต่อ Google)
//   3) npm run build && npm start
//   4) node tests/e2e/saraban.cjs   (ต้องติดตั้ง playwright; ฐานข้อมูลปรับด้วย E2E_DB ได้เหมือน flow.cjs)
// สิ่งที่ตรวจ: ลงรับ → เสนอ → เกษียน → มอบต่อ → อ่าน ไม่มี pageerror, เวลาโหลด /saraban บน 4G ≤ 2000ms (หลังเข้าสู่ระบบ และแคชว่าง),
// ช่วง server action ของการลงนาม ≤ 500ms, เปิด PDF รอบสองตอบจาก service worker, หนังสือลับไม่รั่ว
const { chromium } = require("playwright");
const { PDFDocument, StandardFonts } = require("pdf-lib");
const { execSync } = require("child_process");
const fs = require("fs");
const CHROMIUM = process.env.CHROMIUM_PATH || undefined;
const BASE = (process.env.E2E_ORIGIN || "http://localhost:3000") + "/sis";
const SHOT = (process.env.SHOT_DIR || "/tmp/tsr-shots/saraban") + "/";
const sql = (q) => execSync(`psql "${process.env.E2E_DB || "postgres://postgres@127.0.0.1:54329/tsr_e2e"}" -Atc "${q}"`).toString().trim();
const step = (s) => console.log("▶", s);
const ok = (cond, msg) => { if (!cond) throw new Error(msg); console.log("   ✓", msg); };

// เกณฑ์เวลา (ห้ามผ่อน)
const LOAD_MAX_MS = 2000;
const ACTION_MAX_MS = 500;
// 4G ตามแผน: latency 150ms, ดาวน์โหลด 1.6Mbps (อัปโหลด 750kbps ตามโปรไฟล์ Fast 3G/4G ของ DevTools)
const NET_4G = { offline: false, latency: 150, downloadThroughput: (1.6 * 1000 * 1000) / 8, uploadThroughput: (750 * 1000) / 8 };

const MOBILE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
const errors = [];

// ผู้ใช้ทดสอบ (krusomjai มาจาก start.sh = ธุรการ) — สร้างผ่าน GoTrue admin API แล้วตั้งบทบาทด้วย SQL
const USERS = [
  { u: "krusomjai", name: "สมใจ ธุรการ", prefix: "นาง", role: "clerk", group: null },
  { u: "director.test", name: "สมชาย ผู้บริหาร", prefix: "นาย", role: "director", group: null },
  { u: "head.test", name: "วิไล หัวหน้า", prefix: "นาง", role: "head", group: "วิชาการ" },
  { u: "teacher.test", name: "ครูดี ตั้งใจ", prefix: "นาง", role: "teacher", group: "วิชาการ" },
  { u: "teacher2.test", name: "ครูสอง ทดสอบ", prefix: "นาย", role: "teacher", group: "วิชาการ" },
];

async function setupUsers() {
  const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").trim().split("\n").map((l) => l.split(/=(.*)/s).slice(0, 2)));
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  for (const x of USERS) {
    // มีอยู่แล้ว (รันซ้ำ) GoTrue ตอบ 422 — ไม่เป็นไร
    await fetch(env.NEXT_PUBLIC_SUPABASE_URL + "/auth/v1/admin/users", {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email: `${x.u}@users.tsr-sis.local`, password: "pass1234", email_confirm: true, user_metadata: { full_name: x.name } }),
    });
    const [first, last] = x.name.split(" ");
    sql(`update staff set approved = true, active = true, tour_done = true, prefix = '${x.prefix}', first_name = '${first}', last_name = '${last}',
      saraban_role = '${x.role}', work_group = ${x.group ? `'${x.group}'` : "null"} where email = '${x.u}@users.tsr-sis.local'`);
  }
  ok(sql("select count(*) from staff where approved and email like '%@users.tsr-sis.local' and saraban_role <> 'teacher'") === "3", "ตั้งผู้ใช้และบทบาทสารบรรณ (ธุรการ ผอ. หัวหน้า ครู 2 คน)");
}

async function login(page, user) {
  await page.goto(BASE + "/login");
  await page.fill("#username", user);
  await page.fill("#password", "pass1234");
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/sis/login"), { timeout: 15000 });
}

async function newUser(browser, name, opts = {}) {
  const ctx = await browser.newContext({ ...MOBILE, ...opts });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  return { ctx, page };
}

async function makePdf(path, title) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i++) doc.addPage([595.28, 841.89]).drawText(`${title} - page ${i + 1}`, { x: 60, y: 760, size: 20, font });
  fs.writeFileSync(path, await doc.save());
}

async function register(page, file, subject, secret) {
  await page.goto(BASE + "/saraban/new");
  await page.setInputFiles("#saraban-file", file);
  await page.getByText("2 หน้า").waitFor();
  await page.fill("#fromOrg", "สำนักงานเขตพื้นที่การศึกษาทดสอบ");
  await page.fill("#subject", subject);
  if (secret) await page.getByText("หนังสือลับ", { exact: true }).click();
  await page.getByRole("button", { name: "ลงรับ", exact: true }).click();
  await page.waitForURL(/\/sis\/saraban\/book\//, { timeout: 60000 });
  return page.url().split("/").pop();
}

(async () => {
  execSync(`mkdir -p ${SHOT}`);
  await setupUsers();
  await makePdf(SHOT + "letter.pdf", "Test letter");
  await makePdf(SHOT + "secret.pdf", "Secret test letter");
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  const timings = {};

  // ---------------- ธุรการ: ลงรับ → เสนอ ----------------
  step("ธุรการลงรับหนังสือ (มือถือ 390×844)");
  const clerk = await newUser(browser, "clerk");
  const c = clerk.page;
  await login(c, "krusomjai");
  const bookId = await register(c, SHOT + "letter.pdf", "ขอเชิญประชุมทดสอบระบบสารบรรณ", false);
  await c.getByRole("heading", { name: "เสนอผู้อำนวยการ" }).waitFor();
  ok(sql(`select string_agg(kind || version, ',' order by created_at) from saraban_files where book_id = '${bookId}'`) === "original1,stamped1", "ลงรับแล้ว มีต้นฉบับและฉบับประทับตรารับ");

  step("ธุรการเสนอ ผอ.");
  await c.getByRole("button", { name: "เรียน ผู้อำนวยการ เพื่อโปรดพิจารณา", exact: true }).tap();
  await c.getByRole("button", { name: "เสนอ ผอ.", exact: true }).tap();
  await c.getByText("เสนอ ผอ. แล้ว").waitFor();
  ok(sql(`select status from saraban_books where id = '${bookId}'`) === "proposed", "สถานะ proposed");

  step("ธุรการลงรับหนังสือลับ (ไม่มอบใคร)");
  const secretId = await register(c, SHOT + "secret.pdf", "หนังสือลับทดสอบ", true);
  await c.getByRole("heading", { name: "เสนอผู้อำนวยการ" }).waitFor();
  const secretFile = sql(`select id from saraban_files where book_id = '${secretId}' order by created_at limit 1`);
  ok(sql(`select secret from saraban_books where id = '${secretId}'`) === "t" && !!secretFile, "หนังสือลับลงรับแล้ว");

  // ---------------- ผอ.: วัดเวลาโหลด /saraban บน 4G แล้วเกษียน ----------------
  // ปิด service worker ในบริบทนี้ เพื่อให้ทุกคำขอผ่าน throttle ของ CDP จริง (คำขอจาก service worker ไม่ถูก throttle ตามแท็บ)
  step("ผอ. เปิด /saraban บน 4G (latency 150ms, 1.6Mbps)");
  const dir = await newUser(browser, "director", { serviceWorkers: "block" });
  const d = dir.page;
  await login(d, "director.test"); // หลังเข้าสู่ระบบอยู่หน้าแรก — แคชเบราว์เซอร์มีเฉพาะไฟล์ของหน้าแรก/หน้าเข้าสู่ระบบ
  await d.waitForLoadState("load");
  const cdp = await dir.ctx.newCDPSession(d);
  await cdp.send("Network.enable");
  const measure = async (label) => {
    await cdp.send("Network.emulateNetworkConditions", NET_4G);
    const t0 = Date.now();
    await d.goto(BASE + "/saraban", { waitUntil: "load" });
    const wall = Date.now() - t0;
    const nav = await d.evaluate(() => {
      const n = performance.getEntriesByType("navigation")[0];
      const res = performance.getEntriesByType("resource");
      return { load: Math.round(n.loadEventStart), ttfb: Math.round(n.responseStart), dcl: Math.round(n.domContentLoadedEventEnd),
        html: n.transferSize, resources: res.length, fetched: res.filter((r) => r.transferSize > 0).length, bytes: res.reduce((s, r) => s + (r.transferSize || 0), 0) };
    });
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    console.log(`   เวลา (${label}): load ${nav.load}ms (นาฬิกาสคริปต์ ${wall}ms) · TTFB ${nav.ttfb}ms · DOMContentLoaded ${nav.dcl}ms · HTML ${nav.html} B · ไฟล์ประกอบ ${nav.resources} (ดาวน์โหลดใหม่ ${nav.fetched}, ${nav.bytes} B)`);
    ok(nav.load <= LOAD_MAX_MS, `/saraban (${label}) โหลดบน 4G ${nav.load}ms ≤ ${LOAD_MAX_MS}ms (ดาวน์โหลด ${nav.bytes} B ใช้แบนด์วิดท์อย่างน้อย ${Math.round((nav.bytes / NET_4G.downloadThroughput) * 1000)}ms)`);
    return nav.load;
  };
  // 1) ใช้งานจริง: เข้าสู่ระบบแล้วแตะเมนูสารบรรณ (ไฟล์ร่วมของ Next.js อยู่ในแคชเบราว์เซอร์แล้ว)
  timings.load4g = await measure("หลังเข้าสู่ระบบ");
  await d.screenshot({ path: SHOT + "01-director-inbox.png" });
  // 2) กรณีแย่สุด: ล้างแคชเบราว์เซอร์ทั้งหมด (JS/CSS/ฟอนต์ทั้งระบบดาวน์โหลดใหม่ผ่าน 4G) — เป็นเกณฑ์ด้วย
  //    ขนาดถูกกำหนดโดยไฟล์ร่วมทั้งระบบ: ฟอนต์ไม่ preload (โหลดเฉพาะน้ำหนักที่ใช้) และ Supabase client โหลดเมื่อใช้จริง
  await cdp.send("Network.clearBrowserCache");
  timings.load4gCold = await measure("แคชว่าง");

  step("ผอ. เกษียน: คำสั่ง → หัวหน้ากลุ่มงาน → ลงนาม → ยืนยัน (วัดช่วง server action)");
  await d.goto(BASE + "/saraban/book/" + bookId);
  await d.getByRole("heading", { name: "เกษียนหนังสือ", exact: true }).waitFor();
  await d.getByRole("button", { name: "ทราบ ดำเนินการ", exact: true }).tap();
  await d.getByRole("button", { name: /วิไล/ }).tap();
  await d.getByRole("button", { name: "ลงนาม", exact: true }).tap();
  await d.getByText("ยืนยันการลงนาม").waitFor();
  // จับเวลาเริ่มคำขอ server action ทุกตัว (finalizeUpload ตอนอัปโหลด และ endorseBook ตัวสุดท้าย) และเวลาที่ toast ขึ้น
  const actionStarts = [];
  d.on("request", (r) => { if (r.method() === "POST" && r.headers()["next-action"]) actionStarts.push(Date.now()); });
  await d.evaluate(() => {
    window.__toastAt = 0;
    new MutationObserver((_, obs) => {
      if ([...document.querySelectorAll("[role=status]")].some((el) => el.textContent.includes("ลงนามแล้ว"))) { window.__toastAt = Date.now(); obs.disconnect(); }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  const tapAt = Date.now();
  await d.getByRole("button", { name: "ยืนยันลงนาม" }).tap();
  await d.waitForFunction(() => window.__toastAt > 0, null, { timeout: 60000 });
  const toastAt = await d.evaluate(() => window.__toastAt);
  const endorseStart = actionStarts.filter((t) => t <= toastAt).at(-1);
  // เวลาเริ่มคำขอตามนาฬิกาของหน้าเว็บ (Resource Timing ของ fetch ไปที่ URL หน้า = server action) — ใช้เป็นค่าหลัก
  const pageStart = await d.evaluate((at) => {
    const here = location.href.split("?")[0];
    const xs = performance.getEntriesByType("resource")
      .filter((r) => r.initiatorType === "fetch" && r.name.split("?")[0] === here)
      .map((r) => performance.timeOrigin + r.startTime).filter((t) => t <= at);
    return xs.length ? Math.max(...xs) : 0;
  }, toastAt);
  console.log(`   (จับคำขอ: ฝั่งสคริปต์ ${toastAt - endorseStart}ms · ฝั่งหน้าเว็บ ${pageStart ? Math.round(toastAt - pageStart) : "-"}ms)`);
  timings.action = Math.round(toastAt - (pageStart || endorseStart));
  timings.signTotal = toastAt - tapAt;
  console.log(`   เวลา: server action endorseBook → toast ${timings.action}ms · ทั้งหมดตั้งแต่แตะยืนยัน (รวมลงนาม PDF + อัปโหลด) ${timings.signTotal}ms · server action ทั้งหมด ${actionStarts.length} คำขอ`);
  ok(timings.action <= ACTION_MAX_MS, `ลงนาม: ช่วง server action ถึง toast สำเร็จ ${timings.action}ms ≤ ${ACTION_MAX_MS}ms`);
  await d.waitForTimeout(1000);
  await d.screenshot({ path: SHOT + "02-director-endorsed.png", fullPage: true });
  ok(sql(`select status || '|' || (select first_name from staff where id = current_holder) from saraban_books where id = '${bookId}'`) === "endorsed|วิไล", "เกษียนแล้ว ผู้ถือหนังสือคือหัวหน้ากลุ่มงาน");
  ok(sql(`select file_id is not null from saraban_actions where book_id = '${bookId}' and action = 'endorse'`) === "t", "คำเกษียนลงนามลงไฟล์ฉบับใหม่");

  // ---------------- หัวหน้ากลุ่มงาน: มอบต่อ ----------------
  step("หัวหน้ากลุ่มงานมอบครูดี");
  const head = await newUser(browser, "head");
  const h = head.page;
  await login(h, "head.test");
  await h.goto(BASE + "/saraban/book/" + bookId);
  await h.getByRole("heading", { name: /มอบหมายครูในกลุ่มงาน/ }).waitFor();
  await h.getByLabel(/ครูดี/).check();
  await h.getByRole("button", { name: "ดำเนินการตามหนังสือ", exact: true }).tap();
  await h.getByRole("button", { name: /^มอบหมาย/ }).tap();
  await h.getByText(/มอบหมายแล้ว/).first().waitFor();
  ok(sql(`select status from saraban_books where id = '${bookId}'`) === "assigned", "สถานะ assigned");
  // หัวหน้าที่ไม่ได้รับมอบหมายก็ต้องไม่เห็นหนังสือลับ
  await h.goto(BASE + "/saraban/book/" + secretId);
  ok(await h.getByText("ไม่พบหนังสือ หรือคุณไม่มีสิทธิ์ดู").isVisible(), "หัวหน้ากลุ่มงานเปิดหนังสือลับไม่ได้");

  // ---------------- ครู: อ่าน + PDF จาก service worker ----------------
  step("ครูดีเปิดหนังสือ → อ่านแล้ว · เปิด PDF รอบสองจาก service worker");
  const teacher = await newUser(browser, "teacher");
  const t = teacher.page;
  const latest = sql(`select id from saraban_files where book_id = '${bookId}' order by version desc, created_at desc limit 1`);
  const filePath = `/sis/saraban/api/file/${latest}`;
  const fileHits = []; // คำตอบที่หน้าเว็บได้รับ (จาก service worker หรือไม่)
  const swFetches = []; // คำขอที่ service worker ส่งออกเครือข่ายจริง
  teacher.ctx.on("request", (r) => { if (r.serviceWorker() && r.url().endsWith(filePath)) swFetches.push(r.url()); });
  t.on("response", (r) => { if (r.url().endsWith(filePath)) fileHits.push({ status: r.status(), sw: r.fromServiceWorker() }); });
  await login(t, "teacher.test");
  // รอให้ service worker ควบคุมหน้าก่อน (เปิดครั้งแรกจึงถูกเก็บลงแคช)
  await t.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
  await t.goto(BASE + "/saraban/book/" + bookId);
  await t.getByText("ผู้รับ").first().waitFor();
  await t.waitForTimeout(2500);
  ok(sql(`select read_at is not null from saraban_recipients r join staff s on s.id = r.staff_id where book_id = '${bookId}' and s.first_name = 'ครูดี'`) === "t", "บันทึกเวลาอ่านของครูดี");
  await t.screenshot({ path: SHOT + "03-teacher.png", fullPage: true });
  const cached = await t.evaluate(async (p) => !!(await (await caches.open("tsr-saraban-files")).match(location.origin + p)), filePath);
  ok(cached, "PDF ถูกเก็บในแคช tsr-saraban-files หลังเปิดครั้งแรก");
  await t.goto(BASE + "/saraban");
  await t.goto(BASE + "/saraban/book/" + bookId);
  await t.getByText("ผู้รับ").first().waitFor();
  await t.waitForTimeout(1500);
  const second = fileHits.at(-1);
  console.log(`   คำตอบไฟล์ที่หน้าได้รับ: ${JSON.stringify(fileHits)} · service worker ดึงจากเครือข่าย ${swFetches.length} ครั้ง`);
  ok(fileHits.length >= 2 && second.status === 200 && second.sw === true, "เปิด PDF รอบสอง response.fromServiceWorker() = true");
  ok(swFetches.length === 1, "รอบสองตอบจากแคช ไม่ดึงจากเครือข่ายซ้ำ");
  await t.reload();
  ok(await t.locator("li", { hasText: "ครูดี" }).getByText("อ่านแล้ว").first().isVisible(), "หน้าแสดงว่าครูดีอ่านแล้ว");
  // เครื่องใช้ร่วมกัน: ออกจากระบบแล้ว PDF ที่เก็บไว้ต้องหายไป
  await t.locator("summary[aria-label='เมนูของฉัน']").click();
  await t.getByRole("button", { name: "ออกจากระบบ" }).click();
  await t.waitForURL("**/sis/login");
  ok(!(await t.evaluate(() => caches.has("tsr-saraban-files"))), "ออกจากระบบแล้วลบแคช PDF สารบรรณ");

  // ---------------- ครูที่ไม่เกี่ยวข้อง: หนังสือลับ ----------------
  step("ครูสองเปิดหนังสือลับ → ไม่มีสิทธิ์ และ GET ไฟล์ได้ 404");
  const t2 = await newUser(browser, "teacher2");
  await login(t2.page, "teacher2.test");
  await t2.page.goto(BASE + "/saraban/book/" + secretId);
  ok(await t2.page.getByText("ไม่พบหนังสือ หรือคุณไม่มีสิทธิ์ดู").isVisible(), "ครูสองเห็นข้อความไม่มีสิทธิ์");
  await t2.page.screenshot({ path: SHOT + "04-teacher2-secret.png" });
  const res = await t2.page.request.get(BASE + "/saraban/api/file/" + secretFile);
  ok(res.status() === 404, `GET /sis/saraban/api/file/<ไฟล์ลับ> ได้ ${res.status()}`);
  // ครูสองก็ไม่เห็นเล่มที่ไม่ได้มอบถึงตน
  ok((await t2.page.request.get(BASE + "/saraban/api/file/" + latest)).status() === 404, "ครูสองเปิดไฟล์ของเล่มที่ไม่ได้รับมอบหมายไม่ได้ (404)");

  await browser.close();
  console.log(`เวลาที่วัดได้: โหลด /saraban บน 4G ${timings.load4g}ms / แคชว่าง ${timings.load4gCold}ms (≤ ${LOAD_MAX_MS}) · ลงนาม server action ${timings.action}ms (≤ ${ACTION_MAX_MS}) · ลงนามทั้งหมดรวมอัปโหลด ${timings.signTotal}ms`);
  if (errors.length) { console.log("JS errors:", errors); process.exit(1); }
  console.log("✅ ผ่านทุกขั้นตอน");
})().catch((e) => { console.error("❌", e.message); if (errors.length) console.log("JS errors:", errors); process.exit(1); });
