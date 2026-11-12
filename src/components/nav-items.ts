// เมนูหลักของระบบ — กรองตามบทบาทของผู้ใช้
import { ATTENDANCE_URL, PORTAL_URL } from "../lib/portal-links.ts";

export type NavItem = {
  href: string;
  label: string;
  icon: "home" | "check" | "subject" | "students" | "rooms" | "staff" | "reports" | "audit" | "settings" | "manual" | "nutrition" | "care" | "grades" | "sar" | "switch" | "timeclock";
  color: string;
  roles?: string[]; // ไม่ระบุ = ทุกคน
  needsTeaching?: boolean;
  external?: boolean; // ลิงก์ไปอีกระบบ: ใช้ <a href> แท็บเดิม ไม่ใช่ next/link และไม่เป็นเมนูที่เลือกอยู่
};

// ระบบอื่นของโรงเรียน (ทุกบทบาท): หน้าเลือกระบบ และระบบลงเวลาและการลา
export const EXTERNAL_ITEMS: NavItem[] = [
  { href: PORTAL_URL, label: "สลับระบบ", icon: "switch", color: "#FDE68A", external: true },
  { href: ATTENDANCE_URL, label: "ลงเวลา / การลา", icon: "timeclock", color: "#4ADE80", external: true },
];

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "หน้าแรก", icon: "home", color: "#FFFFFF" },
  { href: "/attendance", label: "เช็กชื่อ / นม / แปรงฟัน", icon: "check", color: "#4ADE80" },
  { href: "/attendance/subject", label: "เช็กชื่อประจำวิชา", icon: "subject", color: "#86EFAC" },
  { href: "/nutrition", label: "ภาวะโภชนาการ", icon: "nutrition", color: "#FB923C" },
  { href: "/care", label: "ดูแลช่วยเหลือ", icon: "care", color: "#F472B6" },
  { href: "/grades", label: "ผลการเรียน", icon: "grades", color: "#A78BFA" },
  { href: "/sar", label: "ข้อมูล SAR", icon: "sar", color: "#C4B5FD", roles: ["admin", "executive", "academic"] },
  { href: "/students", label: "ทะเบียนนักเรียน", icon: "students", color: "#38BDF8" },
  { href: "/classrooms", label: "ห้องเรียน / ครูที่ปรึกษา", icon: "rooms", color: "#7DD3FC", roles: ["admin"] },
  { href: "/staff", label: "ทะเบียนครู", icon: "staff", color: "#38BDF8" },
  { href: "/reports", label: "รายงาน", icon: "reports", color: "#FDE68A" },
  { href: "/audit", label: "ประวัติการแก้ไข", icon: "audit", color: "#E2E8F0", roles: ["admin", "executive"] },
  { href: "/settings", label: "ตั้งค่าระบบ", icon: "settings", color: "#E2E8F0", roles: ["admin"] },
  { href: "/manual", label: "คู่มือการใช้งาน", icon: "manual", color: "#F9A8D4" },
  ...EXTERNAL_ITEMS,
];

export const BOTTOM_NAV = ["/", "/attendance", "/students", "/reports"];

export function navFor(roles: string[]): NavItem[] {
  return NAV_ITEMS.filter((i) => !i.roles || i.roles.some((r) => roles.includes(r)));
}

export function isActive(pathname: string, href: string): boolean {
  if (!href.startsWith("/")) return false; // ลิงก์ไปอีกระบบ ไม่เป็นเมนูที่เลือกอยู่
  if (href === "/") return pathname === "/";
  if (href === "/attendance") return pathname === "/attendance";
  return pathname === href || pathname.startsWith(href + "/");
}
