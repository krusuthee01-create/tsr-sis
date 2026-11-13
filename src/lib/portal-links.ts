// ลิงก์ไประบบลงเวลาและการลาของโรงเรียน (แบบ ก — ประตูเดียว)
// ค่าเริ่มต้นชี้ระบบของโรงเรียนอนุบาลเทพสุนทรินทร์ จึงไม่ต้องตั้งค่าใน Vercel
// ถ้าที่อยู่เปลี่ยน ตั้ง NEXT_PUBLIC_PORTAL_URL / NEXT_PUBLIC_ATTENDANCE_URL ใน Vercel แล้ว deploy ใหม่ (ค่าถูกฝังตอน build)

export const DEFAULT_PORTAL_URL = "https://gotime.anubantep.ac.th/start?choose=1";
export const DEFAULT_ATTENDANCE_URL = "https://gotime.anubantep.ac.th";

// รับเฉพาะ http(s) ที่ถูกต้อง — ว่างหรือผิดรูปแบบใช้ค่าเริ่มต้น
export function linkOr(raw: string | undefined, fallback: string): string {
  const v = raw?.trim();
  if (!v) return fallback;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? v : fallback;
  } catch {
    return fallback;
  }
}

// หน้าเลือกระบบ (?choose=1 = แสดงหน้าเลือกเสมอ ไม่เปิดระบบที่จำไว้)
export const PORTAL_URL = linkOr(process.env.NEXT_PUBLIC_PORTAL_URL, DEFAULT_PORTAL_URL);
// ระบบลงเวลาและการลา
export const ATTENDANCE_URL = linkOr(process.env.NEXT_PUBLIC_ATTENDANCE_URL, DEFAULT_ATTENDANCE_URL);
