-- =====================================================================
-- TSR-SIS: สารบรรณ — เก็บไฟล์ PDF ด้วยบัญชี Google ของโรงเรียน (OAuth) แทน Shared Drive
-- ผู้ดูแลระบบ/ผอ. กด "เชื่อมต่อ Google Drive" ครั้งเดียว ระบบเก็บ refresh token และโฟลเดอร์ไว้ที่นี่
-- ตารางนี้มีความลับ: อ่าน/เขียนได้เฉพาะ service_role (เซิร์ฟเวอร์) — ไม่มี policy และไม่ใส่ trigger ประวัติการแก้ไข
-- (ไม่อย่างนั้น refresh token จะถูกคัดลอกลง audit_log)
-- =====================================================================
create table if not exists public.saraban_drive_config (
  id int primary key default 1 check (id = 1),           -- มีแถวเดียว
  account_email text,                                    -- บัญชี Google ที่เป็นเจ้าของไฟล์
  refresh_token text not null,
  folder_id text not null,                               -- โฟลเดอร์ที่ระบบสร้างในไดรฟ์ของบัญชีนั้น
  connected_by uuid references public.staff(id) on delete set null,
  connected_at timestamptz not null default now()
);
alter table public.saraban_drive_config enable row level security;
revoke all on public.saraban_drive_config from public, anon, authenticated;
grant select, insert, update, delete on public.saraban_drive_config to service_role;
