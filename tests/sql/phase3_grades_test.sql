-- ทดสอบผลการเรียน (ข้อมูลสมมติ)
\set ON_ERROR_STOP 1
\i supabase/migrations/0006_care.sql
-- ไฟล์ต้องรันซ้ำได้
\i supabase/migrations/0007_grades.sql

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@example.com', '{"full_name":"วิไล ใจงาม"}'),
  ('00000000-0000-0000-0000-00000000000b', 'homeroom@example.com', '{"full_name":"สมใจ รักเรียน"}'),
  ('00000000-0000-0000-0000-00000000000c', 'math@example.com', '{"full_name":"คณิต เก่งเลข"}'),
  ('00000000-0000-0000-0000-00000000000d', 'academic@example.com', '{"full_name":"วิชาการ ใจดี"}'),
  ('00000000-0000-0000-0000-00000000000e', 'other@example.com', '{"full_name":"ครู ห้องอื่น"}');
create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p::text, false); perform set_config('role', 'authenticated', false); end $$;
create function pg_temp.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin execute p_sql; raise exception 'คาดว่าจะ error แต่ไม่ error: %', p_sql;
exception when others then if sqlerrm not like p_like then raise exception 'error ไม่ตรง: % (ได้ %)', p_like, sqlerrm; end if; end $$;

update public.staff set approved = true;
update public.staff set roles = '{admin}' where email = 'admin@example.com';
update public.staff set roles = '{academic}' where email = 'academic@example.com';
insert into public.academic_years (year) values (2569);
update public.school_settings set current_year = 2569;
insert into public.terms (year, term, start_date, end_date) values (2569, 1, public.today_th() - 60, public.today_th() + 30);
insert into public.classrooms (year, grade, room) values (2569, 'ป.6', 1), (2569, 'ป.6', 2);
insert into public.students (id, citizen_id, prefix, first_name, last_name) values
  ('30000000-0000-0000-0000-000000000001', '3000000000001', 'เด็กชาย', 'ก', 'ทดสอบ'),
  ('30000000-0000-0000-0000-000000000002', '3000000000002', 'เด็กหญิง', 'ข', 'ทดสอบ');
insert into public.enrollments (student_id, year, classroom_id, number)
select s.id, 2569, c.id, row_number() over (order by s.citizen_id) from public.students s, public.classrooms c where c.room = 1;
insert into public.homeroom_assignments (classroom_id, staff_id, kind)
select c.id, s.id, 'homeroom' from public.classrooms c, public.staff s where c.room = 1 and s.email = 'homeroom@example.com';
insert into public.homeroom_assignments (classroom_id, staff_id, kind)
select c.id, s.id, 'homeroom' from public.classrooms c, public.staff s where c.room = 2 and s.email = 'other@example.com';
insert into public.subjects (code, name, grade, hours_per_year, learning_area) values ('ค16101', 'คณิตศาสตร์', 'ป.6', 160, 'คณิตศาสตร์');
insert into public.teaching_assignments (term_id, subject_id, classroom_id, staff_id)
select t.id, sub.id, c.id, s.id from public.terms t, public.subjects sub, public.classrooms c, public.staff s
where c.room = 1 and s.email = 'math@example.com';

create function pg_temp.payload(p_th text, p_math text) returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('citizen_id', '3000000000001', 'number', 1,
      'results', jsonb_build_array(
        jsonb_build_object('code', 'ท16101', 'term', 1, 'mid', 30, 'final', 12, 'total', 42, 'percent', 84, 'grade', p_th),
        jsonb_build_object('code', 'ค16101', 'term', 1, 'mid', 20, 'final', 10, 'total', 30, 'percent', 60, 'grade', p_math)),
      'assessments', jsonb_build_array(jsonb_build_object('term', 1, 'kind', 'rtw', 'items', '[3,3,2,3,3]'::jsonb, 'result', 'ดีเยี่ยม'))),
    jsonb_build_object('citizen_id', '3000000000002', 'number', 2,
      'results', jsonb_build_array(jsonb_build_object('code', 'ท16101', 'term', 1, 'mid', 10, 'final', 5, 'total', 15, 'percent', 30, 'grade', 'ร')),
      'assessments', '[]'::jsonb),
    jsonb_build_object('citizen_id', '9999999999999', 'number', 3, 'results', '[]'::jsonb, 'assessments', '[]'::jsonb))
$$;
create function pg_temp.subjects() returns jsonb language sql as $$
  select '[{"code":"ท16101","name":"ภาษาไทย","hours":160,"area":"ภาษาไทย","grade":"ป.6"},{"code":"ค16101","name":"คณิตศาสตร์","hours":160,"area":"คณิตศาสตร์","grade":"ป.6"}]'::jsonb
$$;

-- ครูที่ปรึกษา: ตรวจก่อนนำเข้า (ยังไม่บันทึก)
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$
declare r jsonb; c integer := (select id from public.classrooms where room = 1);
begin
  r := public.import_pp5(c, 1::smallint, 'ป6-1.xlsb', pg_temp.subjects(), pg_temp.payload('4', '2'), true);
  assert (r ->> 'matched')::int = 2 and r -> 'unmatched' = '[3]' and (r ->> 'added')::int = 3 and (r ->> 'subjects_new')::int = 1, r::text;
  assert not exists (select 1 from public.grade_results), 'dry run ต้องไม่บันทึก';
  r := public.import_pp5(c, 1::smallint, 'ป6-1.xlsb', pg_temp.subjects(), pg_temp.payload('4', '2'), false);
  assert (select count(*) from public.grade_results) = 3;
  assert (select grade_point from public.grade_results g join public.subjects s on s.id = g.subject_id where s.code = 'ท16101' and g.student_id = '30000000-0000-0000-0000-000000000001') = 4;
  assert (select grade_point from public.grade_results where grade = 'ร') is null;
  assert (select result from public.student_assessments) = 'ดีเยี่ยม';
  -- นำเข้าซ้ำ: เปลี่ยนเกรด 1 รายการ และคณิตถูกลบออกจากไฟล์
  r := public.import_pp5(c, 1::smallint, 'ป6-1.xlsb', pg_temp.subjects(),
    jsonb_set(pg_temp.payload('3.5', '2'), '{0,results}', jsonb_build_array(jsonb_build_object('code', 'ท16101', 'term', 1, 'total', 40, 'grade', '3.5'))), false);
  assert (r ->> 'changed')::int = 1 and (r ->> 'removed')::int = 1 and (r ->> 'unchanged')::int = 1, r::text;
  assert (select count(*) from public.grade_results) = 2;
  assert (select count(*) from public.grade_imports) = 2;
  -- ห้องอื่นนำเข้าไม่ได้
  perform pg_temp.expect_error(format('select public.import_pp5(%s, 1::smallint, null, ''[]'', ''[]'', true)', (select id from public.classrooms where room = 2)), 'นำเข้าได้เฉพาะ%');
end $$;
select public.import_pp5((select id from public.classrooms where room = 1), 1::smallint, 'ป6-1.xlsb', pg_temp.subjects(), pg_temp.payload('4', '2'), false);

-- ครูประจำวิชาคณิต: เห็นเฉพาะคณิต ไม่เห็นผลประเมินคุณลักษณะ
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
do $$
begin
  assert (select count(*) from public.grade_results) = 1, 'ครูคณิตต้องเห็น 1 รายการ';
  assert (select count(*) from public.student_assessments) = 0;
  assert (select count(*) from public.grade_distribution(2569, 1::smallint)) = 1;
end $$;
-- ครูห้องอื่น: ไม่เห็นเลย
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
do $$ begin assert (select count(*) from public.grade_results) = 0; end $$;
select pg_temp.expect_error('select * from public.sar_summary(2569)', 'เฉพาะผู้บริหาร%');

-- งานวิชาการ: สถิติทั้งโรงเรียน และ SAR พร้อมค่าเป้าหมาย
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
insert into public.sar_targets (year, key, target) values (2569, 'grade3', 70);
insert into public.national_tests (year, test, subject, school_avg, national_avg) values (2569, 'O-NET', 'ภาษาไทย', 55.5, 50.1);
do $$
declare d record; s record;
begin
  select * into d from public.grade_distribution(2569, 1::smallint) where code = 'ท16101';
  assert d.n = 2 and d.g4 = 1 and d.r = 1 and d.pct3 = 50, d::text;
  select * into s from public.sar_summary(2569) where key = 'grade3';
  -- ท 4, ค 2, ท ร → 1 ใน 3
  assert s.value = 33.33 and s.base = 3 and s.target = 70, s::text;
  select * into s from public.sar_summary(2569) where key = 'rtw_good';
  assert s.value = 100 and s.base = 1, s::text;
end $$;
