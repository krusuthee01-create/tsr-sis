// Service worker ของ TSR-SIS
// - ไฟล์ static ของ Next.js: เก็บแคชถาวร (ชื่อไฟล์เปลี่ยนทุกครั้งที่ deploy)
// - หน้าเว็บ: ดึงจากเครือข่ายก่อน ถ้าไม่มีสัญญาณใช้ฉบับที่เคยเปิดไว้
// - ข้อมูลจาก Supabase ไม่ผ่านแคชนี้ (หน้าเช็กชื่อจัดการเองด้วย IndexedDB)
const VERSION = "tsr-v1";
const STATIC = `${VERSION}-static`;
const PAGES = `${VERSION}-pages`;
const PRECACHE = ["/offline", "/manifest.webmanifest", "/icons/logo.png", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(PAGES).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/auth/") || url.pathname === "/login") return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
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
        return req.mode === "navigate" ? caches.match("/offline") : Response.error();
      }),
  );
});
