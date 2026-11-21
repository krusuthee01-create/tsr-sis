// ฝั่งเบราว์เซอร์: ลบ PDF สารบรรณที่ service worker เก็บไว้ (แคช tsr-saraban-files ดู public/sw.js)
// เรียกก่อนออกจากระบบและเมื่อเปิดหน้าเข้าสู่ระบบ — เครื่องใช้ร่วมกัน คนถัดไปต้องเปิดไฟล์ของคนก่อนจากแคชไม่ได้
export const SARABAN_FILES_CACHE = "tsr-saraban-files";

/** ไม่ throw: ลบไม่สำเร็จต้องไม่ขวางการออกจากระบบ */
export async function clearSarabanCache(): Promise<void> {
  try {
    if (typeof caches !== "undefined") await caches.delete(SARABAN_FILES_CACHE);
  } catch {
    // ไม่มี Cache API / ถูกบล็อก — ข้าม
  }
}
