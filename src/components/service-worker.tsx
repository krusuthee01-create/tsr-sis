"use client";

import { useEffect } from "react";

/** ลงทะเบียน service worker เพื่อให้ติดตั้งเป็นแอปและเปิดหน้าที่เคยเปิดได้ตอนไม่มีสัญญาณ */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
