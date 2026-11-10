-- ทดสอบนำเข้า DMC แบบย่อ: ฟิลด์ที่ไม่ส่งมาต้องคงค่าเดิม (ข้อมูลสมมติ)
\set ON_ERROR_STOP 1
\i supabase/migrations/0011_dmc_short_format.sql

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@example.com', '{"full_name":"วิไล ใจงาม"}');
create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p::text, false); perform set_config('role', 'authenticated', false); end $$;
update public.staff set approved = true, roles = '{admin}';

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$
declare r jsonb;
begin
  -- ภาค 1: ไฟล์แบบเต็ม
  r := public.import_dmc(2569, '[{"citizen_id":"7000000000001","student_code":"7491","prefix":"เด็กชาย","first_name":"ก","last_name":"ทดสอบ",
    "first_name_en":"Kor","gender":"ช","birth_date":"2018-05-01","father_phone":"0811111111","guardian_phone":"0822222222",
    "address_registered":"1 ต.บ้านกลาง","address_current":"1 ต.บ้านกลาง","weight":20,"height":115,"grade":"ป.1","room":"1",
    "raw":{"หมายเลขโทรศัพท์ของบิดา":"0811111111"}}]');
  assert (r ->> 'new')::int = 1, r::text;
  -- ภาค 2: ไฟล์แบบย่อ ไม่มีเบอร์โทร ชื่ออังกฤษ ที่อยู่ทะเบียนบ้าน แต่ย้ายห้อง เปลี่ยนนามสกุล ที่อยู่ปัจจุบัน และน้ำหนัก
  r := public.import_dmc(2569, '[{"citizen_id":"7000000000001","student_code":"7491","prefix":"เด็กชาย","first_name":"ก","last_name":"ใหม่",
    "gender":"ช","birth_date":"2018-05-01","address_current":"9 ต.ห้วยหม้าย","weight":22,"height":118,"grade":"ป.1","room":"2",
    "raw":{"กลุ่มเลือด":"O"}}]');
  assert (r ->> 'updated')::int = 1 and (r ->> 'moved')::int = 1, r::text;
end $$;
reset role;
do $$
declare s record;
begin
  select * into s from public.students where citizen_id = '7000000000001';
  assert s.father_phone = '0811111111' and s.guardian_phone = '0822222222', 'เบอร์โทรต้องคงเดิม';
  assert s.first_name_en = 'Kor' and s.address_registered = '1 ต.บ้านกลาง', 'ชื่ออังกฤษ/ที่อยู่ทะเบียนบ้านต้องคงเดิม';
  assert s.last_name = 'ใหม่' and s.address_current = '9 ต.ห้วยหม้าย' and s.weight_dmc = 22, 'ข้อมูลที่ไฟล์มีต้องอัปเดต';
  assert s.dmc_raw ? 'หมายเลขโทรศัพท์ของบิดา' and s.dmc_raw ? 'กลุ่มเลือด', 'ข้อมูลดิบต้องรวมกัน';
  assert (select c.room from public.enrollments e join public.classrooms c on c.id = e.classroom_id where e.student_id = s.id) = 2;
end $$;
-- ส่งฟิลด์มาเป็นค่าว่าง = ไฟล์บอกว่าว่าง จึงล้างได้
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.import_dmc(2569, '[{"citizen_id":"7000000000001","first_name":"ก","last_name":"ใหม่","father_phone":null,"grade":"ป.1","room":"2"}]');
reset role;
do $$ begin assert (select father_phone from public.students where citizen_id = '7000000000001') is null; end $$;
