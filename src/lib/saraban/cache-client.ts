// ฝั่งเบราว์เซอร์: ลบข้อมูลสารบรรณที่ค้างในเครื่อง (เครื่องใช้ร่วมกัน คนถัดไปต้องไม่เห็นของคนก่อน)
// - PDF ที่ service worker เก็บไว้ (แคช tsr-saraban-files ดู public/sw.js)
// - หน้า /sis/saraban/** ที่ service worker รุ่นเก่า (ก่อน tsr-v5) เคยเก็บไว้ในแคช tsr-*-pages
// เรียกก่อนออกจากระบบและเมื่อเปิดหน้าเข้าสู่ระบบ
export const SARABAN_FILES_CACHE = "tsr-saraban-files";
const SARABAN_PATH = "/sis/saraban";
const PUSH_TIMEOUT_MS = 3000;

function isSarabanUrl(u: string): boolean {
  try {
    const p = new URL(u, location.href).pathname;
    return p === SARABAN_PATH || p.startsWith(SARABAN_PATH + "/");
  } catch {
    return false;
  }
}

/** ไม่ throw: ลบไม่สำเร็จต้องไม่ขวางการออกจากระบบ */
export async function clearSarabanCache(): Promise<void> {
  try {
    if (typeof caches === "undefined") return;
    await caches.delete(SARABAN_FILES_CACHE);
    const names = (await caches.keys()).filter((k) => /^tsr-.+-pages$/.test(k));
    await Promise.all(names.map(async (name) => {
      const c = await caches.open(name);
      const reqs = (await c.keys()).filter((r) => isSarabanUrl(r.url));
      await Promise.all(reqs.map((r) => c.delete(r)));
    }));
  } catch {
    // ไม่มี Cache API / ถูกบล็อก — ข้าม
  }
}

/**
 * ยกเลิกการแจ้งเตือน (Web Push) ของอุปกรณ์นี้: ลบแถวในฐานข้อมูลก่อน (ต้องยังเข้าสู่ระบบอยู่) แล้ว unsubscribe
 * ไม่ throw และไม่รอเกิน 3 วินาที — ต้องไม่ขวางการออกจากระบบ
 */
export async function unsubscribePush(): Promise<void> {
  const work = (async () => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration("/sis"); // scope ของ /sis/sw.js
    const sub = await reg?.pushManager?.getSubscription();
    if (!sub) return;
    try {
      // โหลดเมื่อใช้จริง (ไม่เพิ่มขนาดไฟล์ที่ทุกหน้าต้องโหลด)
      const { removePushSubscription } = await import("@/app/(app)/saraban/push-actions");
      await removePushSubscription(sub.endpoint);
    } catch {
      // ลบแถวไม่สำเร็จ — งานส่งแจ้งเตือนลบ endpoint ที่ตายแล้วเอง
    }
    await sub.unsubscribe();
  })().catch(() => {});
  await Promise.race([work, new Promise<void>((r) => setTimeout(r, PUSH_TIMEOUT_MS))]);
}

/** ก่อนออกจากระบบ: ลบแคชสารบรรณและยกเลิกการแจ้งเตือนของอุปกรณ์นี้ (ไม่ throw) */
export async function clearSarabanDevice(): Promise<void> {
  await Promise.all([clearSarabanCache(), unsubscribePush()]);
}
