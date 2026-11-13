import type { NextConfig } from "next";

// ทุกหน้าอยู่ใต้ /sis (ต้องตรงกับ BASE_PATH ใน src/lib/base-path.ts — มีเทสต์ตรวจ)
// build เดียวบน Vercel ใช้ได้ทั้ง sis.anubantep.ac.th/sis และ gotime.anubantep.ac.th/sis (Caddy ส่งต่อมา)
const BASE_PATH = "/sis";

// ที่อยู่ที่ส่งต่อคำขอมาที่นี่ (Server Actions ตรวจ Origin ต้องรู้จัก) — คั่นด้วยจุลภาค
const DEFAULT_PROXY_ORIGINS = "gotime.anubantep.ac.th";
const proxyOrigins = (process.env.SIS_PROXY_ORIGINS ?? DEFAULT_PROXY_ORIGINS)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  basePath: BASE_PATH,
  poweredByHeader: false,
  experimental: {
    optimizePackageImports: ["@phosphor-icons/react"],
    // หลัง Caddy ของระบบลงเวลา Host ที่ Vercel เห็นคือ tsr-sis.vercel.app แต่ Origin ของเบราว์เซอร์คือ gotime
    serverActions: { allowedOrigins: proxyOrigins },
  },
  async headers() {
    return [
      {
        // = /sis/sw.js (source ของ headers อยู่ใต้ basePath)
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          // scope "/sis" (ไม่มี / ท้าย) เพื่อให้หน้าแรก /sis อยู่ใน scope ด้วย
          { key: "Service-Worker-Allowed", value: BASE_PATH },
        ],
      },
    ];
  },
  async redirects() {
    return [
      // ที่อยู่เดิม (บุ๊กมาร์ก ไอคอนบนหน้าจอโฮม ลิงก์ Google เดิม /auth/callback) → ใต้ /sis
      // ใช้ 307 ชั่วคราว: ถ้าต้องถอยกลับ เบราว์เซอร์จะไม่จำ redirect ไว้
      { source: "/", destination: BASE_PATH, basePath: false, permanent: false },
      {
        // ยกเว้น /sis เอง และ /_next
        source: "/:path((?!sis(?:/|$)|_next/).+)",
        destination: `${BASE_PATH}/:path`,
        basePath: false,
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
