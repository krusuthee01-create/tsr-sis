"use client";

import { useEffect } from "react";
import { BASE_PATH, withBase } from "@/lib/base-path";

/**
 * ถอน service worker รุ่นก่อนย้ายมา /sis (ลงทะเบียน /sw.js scope "/" และใช้แคช tsr-v1-*)
 * ตรวจจากแคช tsr-v1-* ก่อน: ใต้ gotime.anubantep.ac.th มี /sw.js scope "/" ของระบบลงเวลา — ห้ามถอนตัวนั้น
 * (TSR-SIS ไม่เคยใช้แคช tsr-v1 บน origin ของระบบลงเวลา)
 */
async function retireOldWorker() {
  if (!("caches" in window)) return;
  const old = (await caches.keys()).filter((k) => k.startsWith("tsr-v1"));
  if (!old.length) return;
  const rootScope = `${location.origin}/`;
  const rootScript = `${location.origin}/sw.js`;
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    regs
      .filter((r) => r.scope === rootScope && [r.active, r.waiting, r.installing].some((w) => w?.scriptURL === rootScript))
      .map((r) => r.unregister()),
  );
  await Promise.all(old.map((k) => caches.delete(k)));
}

/** ลงทะเบียน service worker เพื่อให้ติดตั้งเป็นแอปและเปิดหน้าที่เคยเปิดได้ตอนไม่มีสัญญาณ */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    retireOldWorker()
      .catch(() => {})
      // scope "/sis": ดูแลเฉพาะหน้าใต้ /sis ไม่ยุ่งกับระบบลงเวลาที่อยู่ origin เดียวกัน (next.config.ts ตั้ง Service-Worker-Allowed)
      .then(() => navigator.serviceWorker.register(withBase("/sw.js"), { scope: BASE_PATH }))
      .catch(() => {});
  }, []);
  return null;
}
