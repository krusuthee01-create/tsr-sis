// Service worker ของ TSR-SIS — อยู่ที่ /sis/sw.js scope "/sis" (ทั้งระบบอยู่ใต้ /sis)
// ใต้ gotime.anubantep.ac.th ใช้ origin ร่วมกับระบบลงเวลา จึงต้องแตะเฉพาะคำขอใต้ /sis และแคชชื่อ tsr-* เท่านั้น
// - ไฟล์ static ของ Next.js: เก็บแคชถาวร (ชื่อไฟล์เปลี่ยนทุกครั้งที่ deploy)
// - หน้าเว็บ: ดึงจากเครือข่ายก่อน ถ้าไม่มีสัญญาณใช้ฉบับที่เคยเปิดไว้
// - ข้อมูลจาก Supabase ไม่ผ่านแคชนี้ (หน้าเช็กชื่อจัดการเองด้วย IndexedDB)
// - PDF สารบรรณ (/sis/saraban/api/file/<id>): cache-first ในแคช tsr-saraban-files เปิดซ้ำ/ไม่มีสัญญาณก็อ่านได้
//   ไฟล์แต่ละเวอร์ชันไม่เปลี่ยนเนื้อหา (id ใหม่ทุกครั้งที่ลงนาม) · เก็บไม่เกิน 200 ไฟล์ ลบที่เก่าสุดก่อน
//   แคชนี้ไม่ผูกกับ VERSION จึงอยู่รอดเมื่อ deploy รุ่นใหม่ · ออกจากระบบ/เปิดหน้าเข้าสู่ระบบแล้วหน้าเว็บลบทิ้ง (src/lib/saraban/cache-client.ts)
//   ไม่มีในแคชและไม่มีสัญญาณ: ตอบหน้าข้อความภาษาไทย (503)
// - API อื่นของสารบรรณ (/sis/saraban/api/*) ไม่แคช
// - หน้าเว็บสารบรรณ (/sis/saraban/** ทั้ง HTML และ RSC): ดึงจากเครือข่ายเท่านั้น ไม่เก็บแคช
//   (มีเรื่อง/หน่วยงานของหนังสือ รวมหนังสือลับ — ห้ามค้างในเครื่องหลังออกจากระบบ) ไม่มีสัญญาณใช้หน้าออฟไลน์
const BASE = "/sis";
const VERSION = "tsr-v5";
const SARABAN_FILES = "tsr-saraban-files";
const SARABAN_FILES_MAX = 200;
const STATIC = `${VERSION}-static`;
const PAGES = `${VERSION}-pages`;
const OFFLINE = `${BASE}/offline`;
const PRECACHE = [OFFLINE, `${BASE}/manifest.webmanifest`, `${BASE}/icons/logo.png`, `${BASE}/icons/icon-192.png`];

/** อยู่ใต้ /sis หรือไม่ (/sis เอง หรือ /sis/...) — /sisx ไม่นับ */
function inBase(pathname) {
  return pathname === BASE || pathname.startsWith(BASE + "/");
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(PAGES).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      // ลบเฉพาะแคชรุ่นเก่าของ TSR-SIS — แคชของระบบอื่นบน origin เดียวกัน (เช่น shell-* ของระบบลงเวลา) ห้ามแตะ
      // tsr-v1-* (รุ่นก่อน /sis) หน้าเว็บเป็นคนลบพร้อมถอน service worker เก่า (ดู components/service-worker.tsx)
      // tsr-saraban-files ไม่ผูกกับรุ่น — เก็บไว้ข้ามการ deploy
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("tsr-") && !k.startsWith(VERSION) && !k.startsWith("tsr-v1") && k !== SARABAN_FILES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!inBase(url.pathname)) return;
  const path = url.pathname.slice(BASE.length) || "/";
  if (path.startsWith("/auth/") || path === "/login") return;

  // PDF สารบรรณ: cache-first (รวมกรณีเปิดใน iframe ซึ่งเป็นคำขอแบบ navigate)
  if (path.startsWith("/saraban/api/file/")) {
    event.respondWith(sarabanFile(event));
    return;
  }
  // API อื่นของสารบรรณ (อัปโหลด, cron, ไฟล์จำลอง) ไม่แคช
  if (path.startsWith("/saraban/api/")) return;
  const isPage = req.mode === "navigate" || req.headers.get("RSC") === "1";
  // หน้าเว็บสารบรรณ: เครือข่ายเท่านั้น ไม่เก็บ ไม่อ่านจากแคช (แคชรุ่นเก่าอาจยังมีอยู่)
  if (path === "/saraban" || path.startsWith("/saraban/")) {
    if (!isPage) return;
    event.respondWith(fetch(req).catch(async () => (req.mode === "navigate" ? (await caches.match(OFFLINE)) || Response.error() : Response.error())));
    return;
  }

  if (path.startsWith("/_next/static/") || path.startsWith("/icons/")) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(STATIC).then((c) => c.put(req, copy)); }
        return res;
      })),
    );
    return;
  }

  // หน้าเว็บและข้อมูล RSC ของหน้า (เก็บแยกตาม URL)
  if (!isPage) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && !res.redirected) { const copy = res.clone(); caches.open(PAGES).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req, { ignoreVary: true });
        if (hit) return hit;
        // หน้าเช็กชื่อ: ใช้ฉบับที่เคยเปิดไว้แม้ query ต่างกัน
        const loose = await caches.match(req, { ignoreSearch: true, ignoreVary: true });
        if (loose) return loose;
        return req.mode === "navigate" ? caches.match(OFFLINE) : Response.error();
      }),
  );
});

/**
 * PDF สารบรรณ: มีในแคชตอบทันที ไม่มีจึงดึงจากเครือข่ายแล้วเก็บ (เฉพาะ 200 — 404 ไม่มีสิทธิ์/502 ห้ามเก็บ)
 * ใส่ใหม่ = ต่อท้ายลำดับคีย์ของ Cache API จึงลบจากหัวรายการ = ลบเก่าสุดก่อน
 * ตอบจากแคชแล้วย้ายไปท้าย (ใช้ล่าสุด) — งานเก็บแคชไม่หน่วงคำตอบ แต่อยู่ใน waitUntil กัน service worker ถูกปิดกลางคัน
 */
async function sarabanFile(event) {
  const req = event.request;
  const cache = await caches.open(SARABAN_FILES);
  const key = req.url;
  const hit = await cache.match(key);
  if (hit) {
    const again = hit.clone(); // clone ก่อนส่งคืน (body ของ hit จะถูกอ่านโดยหน้าเว็บ)
    event.waitUntil(cache.delete(key).then(() => cache.put(key, again)).catch(() => {}));
    return hit;
  }
  let res;
  try {
    res = await fetch(req);
  } catch {
    // ไม่มีสัญญาณและไม่เคยเปิดไฟล์นี้บนเครื่อง
    return new Response(
      '<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<body style="font-family:sans-serif;padding:1.5rem;text-align:center;color:#334155">' +
        "<p>ไฟล์นี้ยังไม่เคยเปิดบนเครื่องนี้ กรุณาเชื่อมต่ออินเทอร์เน็ต</p></body></html>",
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
    );
  }
  if (res.status === 200 && !res.redirected) {
    const copy = res.clone();
    event.waitUntil(cache.put(key, copy).then(() => trimCache(cache, SARABAN_FILES_MAX)).catch(() => {}));
  }
  return res;
}

/** เก็บไม่เกิน max รายการ: ลบจากหัวรายการ (เก่าสุด/ใช้นานที่สุด) */
async function trimCache(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

// ---------- Web Push (แจ้งเตือนสารบรรณ) ----------
// payload: {"title": "...", "body": "...", "url": "/sis/saraban/book/<id>"}
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = typeof data.title === "string" && data.title ? data.title : "TSR-SIS";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      icon: `${BASE}/icons/icon-192.png`,
      badge: `${BASE}/icons/icon-192.png`,
      data: { url: typeof data.url === "string" ? data.url : `${BASE}/saraban` },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // เปิดได้เฉพาะหน้าใต้ /sis ของ origin นี้
  let target = new URL(`${BASE}/saraban`, self.location.origin);
  try {
    const u = new URL(event.notification.data && event.notification.data.url, self.location.origin);
    if (u.origin === self.location.origin && inBase(u.pathname)) target = u;
  } catch {
    // ใช้หน้าสารบรรณ
  }
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const same = list.find((c) => c.url === target.href);
      if (same) return same.focus();
      const mine = list.find((c) => inBase(new URL(c.url).pathname) && "navigate" in c);
      if (mine) return mine.navigate(target.href).then((c) => (c || mine).focus());
      return self.clients.openWindow(target.href);
    }),
  );
});
