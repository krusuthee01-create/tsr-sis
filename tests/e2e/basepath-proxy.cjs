// ทดสอบ TSR-SIS ใต้ /sis ผ่าน reverse proxy ที่ Host ต่างกัน (แบบ gotime.anubantep.ac.th/sis → Vercel)
// ต้องเปิดก่อน:
//   1) scripts/local-stack/start.sh + next build && next start -p 3000 (SIS_PROXY_ORIGINS ต้องมี host ของ proxy เช่น localhost:8080)
//   2) proxy ที่ PROXY_ORIGIN: /sis* → TSR-SIS โดยตั้ง Host (และ X-Forwarded-Host) เป็นชื่ออื่น (UPSTREAM_HOST) แบบ Vercel
//      ที่อื่น → ระบบลงเวลา (หรือตัวจำลองที่ลงทะเบียน /sw.js scope "/") — ใช้ infra/Caddyfile ของระบบลงเวลาที่แก้ upstream ได้
//   3) PROXY_CTL (ไม่บังคับ) คำสั่งหยุด/เริ่ม proxy เพื่อจำลองไม่มีสัญญาณ เช่น "docker %s clocal" (%s = stop/start)
// รัน: node tests/e2e/basepath-proxy.cjs   (ข้อมูลสมมติทั้งหมด ผู้ใช้ทดสอบจาก start.sh)
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const fs = require("fs");

const PROXY = process.env.PROXY_ORIGIN || "http://localhost:8080";
const DIRECT = process.env.DIRECT_ORIGIN || "http://localhost:3000";
const UPSTREAM_HOST = process.env.UPSTREAM_HOST || "tsr-sis.upstream.test";
const PROXY_CTL = process.env.PROXY_CTL || "";
const CHROMIUM = process.env.CHROMIUM_PATH || undefined;
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").trim().split("\n").map((l) => l.split(/=(.*)/s).slice(0, 2)));

const failures = [];
const check = (ok, msg) => { console.log(`${ok ? "  ✓" : "  ✗"} ${msg}`); if (!ok) failures.push(msg); };
const step = (s) => console.log("▶", s);

/** เก็บทุกคำตอบ/การเปลี่ยนหน้า เพื่อตรวจว่าไม่หลุดไป host ของ upstream และไม่มี 404 */
function watch(page) {
  const log = { responses: [], navigations: [], errors: [] };
  page.on("response", (r) => log.responses.push({ url: r.url(), status: r.status(), location: r.headers()["location"] || null, fromSW: r.fromServiceWorker() }));
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) log.navigations.push(f.url()); });
  page.on("pageerror", (e) => log.errors.push(e.message));
  return log;
}
function noUpstreamLeak(log, label) {
  const leak = [...log.navigations, ...log.responses.map((r) => r.url), ...log.responses.map((r) => r.location || "")].filter((u) => u.includes(UPSTREAM_HOST));
  check(leak.length === 0, `${label}: ไม่หลุดไป ${UPSTREAM_HOST} ${leak.length ? JSON.stringify(leak) : ""}`);
  const abs = log.responses.filter((r) => r.location && /^https?:/.test(r.location));
  check(abs.length === 0, `${label}: redirect ทุกตัวเป็น Location แบบ relative ${abs.length ? JSON.stringify(abs) : ""}`);
}
function noBadResponses(log, label, origin) {
  const bad = log.responses.filter((r) => r.url.startsWith(origin + "/sis") && r.status >= 400);
  check(bad.length === 0, `${label}: ไม่มีไฟล์ใต้ /sis ที่ตอบ ≥400 ${bad.length ? JSON.stringify(bad) : ""}`);
}
async function session(email) {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "pass1234" }),
  });
  return "base64-" + Buffer.from(JSON.stringify(await res.json())).toString("base64url");
}
/** ผู้ใช้ทดสอบที่ยังไม่อนุมัติ (สร้างครั้งแรก) — หลังเข้าสู่ระบบจะไปหน้า /sis/pending เสมอ */
async function ensureUser(email) {
  await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST", headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "pass1234", email_confirm: true, user_metadata: { full_name: "ทดสอบ proxy" } }),
  });
}
const USER = "proxy.test";
const storageKey = `sb-${new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0]}-auth-token`;

(async () => {
  await ensureUser(`${USER}@users.tsr-sis.local`);
  const browser = await chromium.launch({ executablePath: CHROMIUM });

  // ---------------- A. จากระบบลงเวลา (มี service worker scope "/") ไป /sis ----------------
  step("A. เปิดระบบลงเวลา (service worker scope /) แล้วกด 'ข้อมูลนักเรียน' → /sis/login ผ่าน proxy");
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const log = watch(page);
  await page.goto(PROXY + "/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  check(await page.evaluate(() => !!navigator.serviceWorker.controller), "ระบบลงเวลามี service worker ควบคุมหน้า");
  await page.click("#to-sis");
  await page.waitForURL(PROXY + "/sis/login");
  await page.evaluate(() => document.fonts.ready);
  check(new URL(page.url()).origin === PROXY, `อยู่บน ${PROXY} (${page.url()})`);
  const ui = await page.evaluate(() => ({
    sheets: document.styleSheets.length,
    bodyFont: getComputedStyle(document.body).fontFamily,
    btnRadius: getComputedStyle(document.querySelector("button")).borderRadius,
    fontsLoaded: [...document.fonts].filter((f) => f.status === "loaded").length,
    imgs: [...document.images].map((i) => ({ src: i.currentSrc, ok: i.complete && i.naturalWidth > 0 })),
    manifest: document.querySelector("link[rel=manifest]")?.getAttribute("href"),
    icons: [...document.querySelectorAll("link[rel~=icon],link[rel=apple-touch-icon]")].map((l) => l.getAttribute("href")),
    h2: document.querySelector("h2")?.textContent,
  }));
  check(ui.sheets > 0 && ui.btnRadius !== "0px", `CSS โหลด (stylesheets ${ui.sheets}, ปุ่มมุมมน ${ui.btnRadius})`);
  check(ui.fontsLoaded > 0, `ฟอนต์โหลด ${ui.fontsLoaded} ตัว (${ui.bodyFont.slice(0, 40)}…)`);
  check(ui.imgs.length > 0 && ui.imgs.every((i) => i.ok && i.src.startsWith(PROXY + "/sis/")), `รูปโลโก้ใต้ /sis แสดงได้ ${JSON.stringify(ui.imgs)}`);
  check(ui.manifest === "/sis/manifest.webmanifest", `manifest = ${ui.manifest}`);
  check(ui.icons.length > 0 && ui.icons.every((h) => h.startsWith("/sis/icons/")), `ไอคอน ${JSON.stringify(ui.icons)}`);
  check(ui.h2 === "สวัสดีครับ คุณครู", "หน้าเข้าสู่ระบบแสดงเนื้อหา");
  const m = await page.evaluate(async () => {
    const man = await (await fetch("/sis/manifest.webmanifest")).json();
    const icons = await Promise.all(man.icons.map(async (i) => (await fetch(i.src)).status));
    return { start: man.start_url, scope: man.scope, icons };
  });
  check(m.start === "/sis" && m.scope === "/sis" && m.icons.every((s) => s === 200), `manifest start_url/scope/ไอคอน ${JSON.stringify(m)}`);

  step("B. service worker ของ TSR-SIS: /sis/sw.js scope /sis อยู่คู่กับของระบบลงเวลา");
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration("/sis/login"))?.active?.scriptURL.endsWith("/sis/sw.js"), null, { timeout: 15000 });
  const regs = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((r) => ({ scope: r.scope, script: r.active?.scriptURL })));
  check(regs.some((r) => r.scope === PROXY + "/sis" && r.script === PROXY + "/sis/sw.js"), `TSR-SIS scope ${PROXY}/sis ${JSON.stringify(regs)}`);
  check(regs.some((r) => r.scope === PROXY + "/" && r.script === PROXY + "/sw.js"), "service worker ของระบบลงเวลา (scope /) ยังอยู่");
  await page.reload();
  const ctl = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL);
  check(ctl === PROXY + "/sis/sw.js", `หน้าใต้ /sis ถูกควบคุมโดย /sis/sw.js ไม่ใช่ของระบบลงเวลา (${ctl})`);

  step("C. เข้าสู่ระบบผ่าน proxy → คุกกี้อยู่ที่ path /sis และยังอยู่หลังโหลดใหม่");
  await page.fill("#username", USER);
  await page.fill("#password", "pass1234");
  await page.click("button[type=submit]");
  // ผู้ใช้ทดสอบยังไม่อนุมัติ: /sis → /sis/pending
  await page.waitForURL(PROXY + "/sis/pending", { timeout: 15000 });
  check(true, `หลังเข้าสู่ระบบอยู่ที่ ${page.url()}`);
  const cookies = await ctx.cookies(PROXY + "/sis/");
  const auth = cookies.filter((c) => c.name.startsWith(storageKey));
  check(auth.length > 0 && auth.every((c) => c.path === "/sis"), `คุกกี้ ${storageKey} path /sis ${JSON.stringify(auth.map((c) => [c.name, c.path]))}`);
  check((await ctx.cookies(PROXY + "/")).every((c) => !c.name.startsWith("sb-")), "ไม่มีคุกกี้ sb-* ที่ path / (ระบบลงเวลาไม่เห็น)");
  await page.goto(PROXY + "/sis");
  check(page.url() === PROXY + "/sis/pending", `โหลดใหม่ยังเข้าสู่ระบบอยู่ (${page.url()})`);
  await page.goto(PROXY + "/sis/auth/callback?code=bogus");
  check(page.url() === PROXY + "/sis/login?error=1", `callback ผิดพลาด → ${page.url()}`);
  await page.goto(PROXY + "/sis");
  check(page.url() === PROXY + "/sis/pending", "callback ที่ผิดไม่ทำให้หลุดจากระบบ");

  step("D. ไม่มีสัญญาณ (หยุด proxy): หน้า /sis ได้จากแคชของ TSR-SIS ไม่ใช่หน้า /offline ของระบบลงเวลา");
  if (PROXY_CTL) {
    await page.goto(PROXY + "/sis/offline");
    await page.goto(PROXY + "/sis/pending");
    await page.waitForTimeout(1000);
    execSync(PROXY_CTL.replace("%s", "stop"));
    try {
      await page.goto(PROXY + "/sis/pending");
      check((await page.locator("#gotime-offline").count()) === 0 && (await page.getByText(USER + "@users.tsr-sis.local").count()) + (await page.getByText("รอผู้ดูแลระบบอนุมัติ").count()) > 0, "หน้าที่เคยเปิด (/sis/pending) เปิดได้จากแคชของ TSR-SIS");
      await page.goto(PROXY + "/sis/students");
      check((await page.getByText("ไม่มีสัญญาณอินเทอร์เน็ต").count()) > 0 && (await page.locator("#gotime-offline").count()) === 0, "หน้าที่ไม่เคยเปิด → หน้าออฟไลน์ของ TSR-SIS (/sis/offline)");
      await page.goto(PROXY + "/");
      check((await page.locator("#gotime-offline").count()) > 0, "หน้าแรกระบบลงเวลา → หน้าออฟไลน์ของระบบลงเวลา (ยังทำงานตามเดิม)");
      const keys = await page.evaluate(() => caches.keys());
      check(keys.includes("shell-v2") && keys.some((k) => k.startsWith("tsr-v2-")), `แคชสองระบบอยู่ร่วมกัน ${JSON.stringify(keys)}`);
    } finally {
      execSync(PROXY_CTL.replace("%s", "start"));
      await new Promise((r) => setTimeout(r, 2500));
    }
  } else console.log("  (ข้าม: ไม่ได้ตั้ง PROXY_CTL)");
  noUpstreamLeak(log, "A–D");
  noBadResponses(log, "A–D", PROXY);
  check(log.errors.length === 0, `ไม่มี JavaScript error ${JSON.stringify(log.errors)}`);
  await ctx.close();

  step("E. ยังไม่เข้าสู่ระบบ เปิดหน้าภายในผ่าน proxy → /sis/login บน proxy (redirect relative)");
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  const log2 = watch(p2);
  for (const path of ["/sis/attendance?c=1", "/sis", "/sis/settings"]) {
    await p2.goto(PROXY + path);
    check(p2.url() === PROXY + "/sis/login", `${path} → ${p2.url()}`);
  }
  noUpstreamLeak(log2, "E");
  await ctx2.close();

  step("F. ที่อยู่เดิมที่โดเมน TSR-SIS ตรง (เช่น sis.anubantep.ac.th/attendance) → /sis/...");
  const ctx3 = await browser.newContext();
  const p3 = await ctx3.newPage();
  const log3 = watch(p3);
  const r1 = await p3.request.get(DIRECT + "/attendance?c=1", { maxRedirects: 0 });
  check(r1.status() === 307 && r1.headers()["location"] === "/sis/attendance?c=1", `/attendance?c=1 → ${r1.status()} ${r1.headers()["location"]}`);
  const r2 = await p3.request.get(DIRECT + "/", { maxRedirects: 0 });
  check(r2.status() === 307 && r2.headers()["location"] === "/sis", `/ → ${r2.headers()["location"]}`);
  const r3 = await p3.request.get(DIRECT + "/manifest.webmanifest");
  check(r3.status() === 200 && (await r3.json()).scope === "/sis", "/manifest.webmanifest → /sis/manifest.webmanifest");
  await p3.goto(DIRECT + "/attendance");
  check(p3.url() === DIRECT + "/sis/login", `เปิด /attendance (ยังไม่เข้าสู่ระบบ) → ${p3.url()}`);
  noBadResponses(log3, "F", DIRECT);
  await ctx3.close();

  step("G. ครูที่เข้าสู่ระบบไว้ก่อนมี /sis (คุกกี้ path /) → ยังเข้าสู่ระบบอยู่ คุกกี้ย้ายไป /sis ครั้งเดียว");
  const ctx4 = await browser.newContext();
  const value = await session(`${USER}@users.tsr-sis.local`);
  await ctx4.addCookies([{ name: storageKey, value, url: DIRECT + "/" }]);
  check((await ctx4.cookies(DIRECT + "/")).some((c) => c.name === storageKey && c.path === "/"), "ตั้งคุกกี้รุ่นเก่าที่ path / แล้ว");
  const p4 = await ctx4.newPage();
  await p4.goto(DIRECT + "/attendance");
  check(p4.url() === DIRECT + "/sis/pending", `ยังเข้าสู่ระบบอยู่ (ผู้ใช้ยังไม่อนุมัติ → ${p4.url()})`);
  const after = (await ctx4.cookies(DIRECT + "/sis/")).filter((c) => c.name.startsWith(storageKey) || c.name === "tsr-ck");
  check(after.length >= 2 && after.every((c) => c.path === "/sis"), `เหลือคุกกี้ที่ /sis เท่านั้น ${JSON.stringify(after.map((c) => [c.name, c.path]))}`);
  await p4.goto(DIRECT + "/sis");
  check(p4.url() === DIRECT + "/sis/pending", "โหลดใหม่ยังเข้าสู่ระบบอยู่");
  await ctx4.close();

  await browser.close();
  if (failures.length) {
    console.error(`\nไม่ผ่าน ${failures.length} ข้อ`);
    process.exit(1);
  }
  console.log("\nผ่านทั้งหมด");
})().catch((e) => { console.error(e); process.exit(1); });
