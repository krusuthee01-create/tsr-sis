// Service worker ของ TSR-SIS — อยู่ที่ /sis/sw.js scope "/sis" (ทั้งระบบอยู่ใต้ /sis)
// ใต้ gotime.anubantep.ac.th ใช้ origin ร่วมกับระบบลงเวลา จึงต้องแตะเฉพาะคำขอใต้ /sis และแคชชื่อ tsr-* เท่านั้น
// - ไฟล์ static ของ Next.js: เก็บแคชถาวร (ชื่อไฟล์เปลี่ยนทุกครั้งที่ deploy)
// - หน้าเว็บ: ดึงจากเครือข่ายก่อน ถ้าไม่มีสัญญาณใช้ฉบับที่เคยเปิดไว้
// - ข้อมูลจาก Supabase ไม่ผ่านแคชนี้ (หน้าเช็กชื่อจัดการเองด้วย IndexedDB)
const BASE = "/sis";
const VERSION = "tsr-v2";
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
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("tsr-") && !k.startsWith(VERSION) && !k.startsWith("tsr-v1")).map((k) => caches.delete(k))))
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
  const isPage = req.mode === "navigate" || req.headers.get("RSC") === "1";
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
