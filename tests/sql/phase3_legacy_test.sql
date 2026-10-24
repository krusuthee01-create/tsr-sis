-- ทดสอบนำเข้าจากระบบเดิม (ข้อมูลสมมติ)
\set ON_ERROR_STOP 1
\i supabase/migrations/0009_legacy_import.sql

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@example.com', '{"full_name":"วิไล ใจงาม"}'),
  ('00000000-0000-0000-0000-00000000000b', 'teacher@example.com', '{"full_name":"สมใจ รักเรียน"}');
create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p::text, false); perform set_config('role', 'authenticated', false); end $$;
create function pg_temp.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin execute p_sql; raise exception 'คาดว่าจะ error แต่ไม่ error: %', p_sql;
exception when others then if sqlerrm not like p_like then raise exception 'error ไม่ตรง: % (ได้ %)', p_like, sqlerrm; end if; end $$;

update public.staff set approved = true;
update public.staff set roles = '{admin}' where email = 'admin@example.com';
insert into public.academic_years (year) values (2569);
insert into public.classrooms (year, grade, room) values (2569, 'ป.2', 2);
insert into public.students (id, citizen_id, student_code, prefix, first_name, last_name, gender, birth_date) values
  ('50000000-0000-0000-0000-000000000001', '5000000000001', '07317', 'เด็กชาย', 'ก', 'ทดสอบ', 'ช', '2018-05-01'),
  ('50000000-0000-0000-0000-000000000002', '5000000000002', '7220', 'เด็กหญิง', 'ข', 'ทดสอบ', 'ญ', '2018-06-01');
insert into public.enrollments (student_id, year, classroom_id, number)
select s.id, 2569, c.id, row_number() over (order by s.citizen_id) from public.students s, public.classrooms c;

-- วันที่มีบันทึกในระบบใหม่แล้ว ต้องไม่ถูกเขียนทับ
insert into public.attendance_daily (student_id, date, classroom_id, status)
select '50000000-0000-0000-0000-000000000002', '2026-06-23', id, 1 from public.classrooms;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$select * from public.legacy_match(2569, array['7317'])$$, 'เฉพาะผู้ดูแลระบบ%');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$
declare r jsonb; c integer := (select id from public.classrooms);
begin
  -- เลขประจำตัวที่มี 0 นำหน้าก็จับคู่ได้, เลขที่ไม่มีในระบบไม่คืนค่า
  assert (select count(*) from public.legacy_match(2569, array['7317', '7220', '9999'])) = 2;
  r := public.import_legacy_attendance(2569, jsonb_build_array(
    jsonb_build_object('s', '50000000-0000-0000-0000-000000000001', 'c', c, 'd', '2026-06-22', 'a', 0, 'm', true, 'b', false),
    jsonb_build_object('s', '50000000-0000-0000-0000-000000000001', 'c', c, 'd', '2026-06-23', 'a', 3, 'n', 'ลา (นำเข้าจากระบบเดิม ไม่ระบุประเภท)', 'm', true, 'b', true),
    jsonb_build_object('s', '50000000-0000-0000-0000-000000000002', 'c', c, 'd', '2026-06-23', 'a', 4, 'm', false, 'b', false)));
  assert (r ->> 'attendance')::int = 2 and (r ->> 'skipped')::int = 1 and (r ->> 'health')::int = 2, r::text;
  assert (select status from public.attendance_daily where student_id = '50000000-0000-0000-0000-000000000002') = 1, 'ห้ามเขียนทับข้อมูลระบบใหม่';
  assert (select note from public.attendance_daily where date = '2026-06-23' and status = 3) like 'ลา (นำเข้า%';
  assert not exists (select 1 from public.health_daily where date = '2026-06-23'), 'วันลา/ขาดไม่บันทึกนม';
  -- นำเข้าซ้ำ = ไม่เพิ่ม
  r := public.import_legacy_attendance(2569, jsonb_build_array(jsonb_build_object('s', '50000000-0000-0000-0000-000000000001', 'c', c, 'd', '2026-06-22', 'a', 0, 'm', true, 'b', true)));
  assert (r ->> 'attendance')::int = 0;

  r := public.import_legacy_measurements(2569, jsonb_build_array(
    jsonb_build_object('s', '50000000-0000-0000-0000-000000000001', 'c', c, 'round', 'มิ.ย. 2569', 'start', '2026-06-01', 'end', '2026-06-30', 'd', '2026-06-15', 'w', 22, 'h', 120),
    jsonb_build_object('s', '50000000-0000-0000-0000-000000000002', 'c', c, 'round', 'ก.ค. 2569', 'start', '2026-07-01', 'end', '2026-07-31', 'd', '2026-07-15', 'w', 20, 'h', 118)));
  assert (r ->> 'measurements')::int = 2 and (r ->> 'rounds')::int = 2, r::text;
  assert (select count(*) from public.measurement_rounds where year = 2569) = 2;
  assert (select age_months from public.measurements where student_id = '50000000-0000-0000-0000-000000000001') = 97;
  r := public.import_legacy_measurements(2569, jsonb_build_array(
    jsonb_build_object('s', '50000000-0000-0000-0000-000000000001', 'c', c, 'round', 'มิ.ย. 2569', 'start', '2026-06-01', 'end', '2026-06-30', 'd', '2026-06-16', 'w', 30, 'h', 130)));
  assert (r ->> 'measurements')::int = 0 and (r ->> 'rounds')::int = 0, r::text;
end $$;
