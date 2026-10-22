// บัญชีแบบชื่อผู้ใช้: Supabase ต้องใช้อีเมล จึงแปลงชื่อผู้ใช้เป็นอีเมลภายในที่ไม่มีอยู่จริง
export const USERNAME_DOMAIN = "users.tsr-sis.local";

export function usernameToEmail(input: string): string {
  const v = input.trim().toLowerCase();
  return v.includes("@") ? v : `${v}@${USERNAME_DOMAIN}`;
}

export function isValidUsername(u: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{2,31}$/.test(u);
}
