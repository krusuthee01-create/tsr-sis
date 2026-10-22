-- =====================================================================
-- TSR-SIS: สิทธิ์ระดับตารางสำหรับ Data API
-- โปรเจกต์ Supabase บางแบบไม่ให้สิทธิ์ตารางใหม่อัตโนมัติ ไฟล์นี้กำหนดให้ชัดเจน
-- (การเข้าถึงข้อมูลจริงยังถูกควบคุมด้วย RLS ในไฟล์ 0002 ทุกตาราง)
-- =====================================================================
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
-- ใช้ตรวจว่าระบบยังทำงาน (GitHub Actions keepalive) — RLS ทำให้ได้ผลว่างเสมอ
grant select on public.grade_levels to anon;
