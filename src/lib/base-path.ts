// TSR-SIS อยู่ใต้ /sis เสมอ (basePath ใน next.config.ts) เพื่อให้เปิดใต้ที่อยู่เดียวกับระบบลงเวลาได้
// เช่น https://gotime.anubantep.ac.th/sis/ (Caddy ส่งต่อมา Vercel) และ https://sis.anubantep.ac.th/sis/
// next/link, router.push/replace, redirect() และ revalidatePath เติม /sis ให้เอง
// ที่ต้องเติมเองด้วย withBase(): <a href>, <form action>, <Image src>, history.replaceState,
// metadata (manifest/icons), redirect ที่เขียน Location เอง และ URL ที่ส่งให้ Supabase
export const BASE_PATH = "/sis";

/** เติม /sis หน้า path ภายในระบบ (ต้องขึ้นต้นด้วย "/") */
export function withBase(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error(`path ต้องขึ้นต้นด้วย / : ${path}`);
  // หน้าแรกคือ /sis (ไม่มี / ท้าย — Next พา /sis/ ไป /sis เอง)
  return path === "/" ? BASE_PATH : BASE_PATH + path;
}
