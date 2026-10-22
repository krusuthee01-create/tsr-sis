-- ทดสอบสิทธิ์และการทำงานของ RPC เฟส 1 (ข้อมูลสมมติทั้งหมด)
\set ON_ERROR_STOP 1

-- ผู้ใช้จำลอง
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@example.com', '{"full_name":"วิไล ใจงาม"}'),
  ('00000000-0000-0000-0000-00000000000b', 'homeroom@example.com', '{"full_name":"สมใจ รักเรียน"}'),
  ('00000000-0000-0000-0000-00000000000c', 'subject@example.com', '{"full_name":"มานะ สอนดี"}'),
  ('00000000-0000-0000-0000-00000000000d', 'stranger@example.com', '{"full_name":"คนนอก ไม่อนุมัติ"}');

create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p::text, false);
  perform set_config('role', 'authenticated', false);
end $$;
create function pg_temp.as_super() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', false);
  perform set_config('request.jwt.claim.sub', '', false);
end $$;
create function pg_temp.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'คาดว่าจะ error แต่ไม่ error: %', p_sql;
exception when others then
  if sqlerrm not like p_like then
    raise exception 'error ไม่ตรง: % (ได้ %)', p_like, sqlerrm;
  end if;
end $$;
create function pg_temp.school_day() returns date language sql as $$
  select max(d)::date from generate_series(public.today_th() - 6, public.today_th(), interval '1 day') d
  where extract(isodow from d) < 6
$$;

do $$ begin
  assert (select count(*) from public.staff) = 4, 'trigger สร้าง staff ไม่ครบ';
  assert (select count(*) from public.staff where approved) = 0, 'staff ใหม่ต้องยังไม่อนุมัติ';
end $$;

-- ผู้ใช้คนแรกตั้งตัวเองเป็นผู้ดูแลระบบ และคนที่สองทำไม่ได้
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin assert public.claim_first_admin(), 'claim_first_admin ครั้งแรกต้องสำเร็จ'; end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
do $$ begin assert not public.claim_first_admin(), 'claim_first_admin ครั้งที่สองต้องไม่สำเร็จ'; end $$;

-- ผู้ดูแลระบบตั้งค่าเบื้องต้น
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update public.staff set approved = true where email in ('homeroom@example.com', 'subject@example.com');
insert into public.academic_years (year) values (2569);
update public.school_settings set current_year = 2569;
insert into public.terms (year, term, start_date, end_date)
  values (2569, 1, public.today_th() - 120, public.today_th() + 60);

select public.import_dmc(2569, '[
  {"citizen_id":"1000000000001","student_code":"9001","prefix":"เด็กชาย","first_name":"กวินท์","last_name":"แสงทอง","gender":"ช","birth_date":"2017-02-14","grade":"ป.3","room":"1","raw":{"x":1}},
  {"citizen_id":"1000000000002","student_code":"9002","prefix":"เด็กหญิง","first_name":"กัญญา","last_name":"ศรีงาม","gender":"ญ","birth_date":"2017-05-01","grade":"ป.3","room":"1","raw":{"x":2}},
  {"citizen_id":"1000000000003","student_code":"9003","prefix":"เด็กชาย","first_name":"ปกรณ์","last_name":"ทองดี","gender":"ช","birth_date":"2017-06-01","grade":"ป.3","room":"2","raw":{"x":3}},
  {"citizen_id":"1000000000004","student_code":"9004","prefix":"เด็กหญิง","first_name":"ปิยดา","last_name":"มาดี","gender":"ญ","birth_date":"2014-01-01","grade":"ป.6","room":"1","raw":{"x":4}}
]'::jsonb);

do $$
declare r jsonb;
begin
  assert (select count(*) from public.students) = 4, 'นำเข้าไม่ครบ';
  assert (select count(*) from public.classrooms) = 3, 'สร้างห้องไม่ครบ';
  -- นำเข้าซ้ำ: อัปเดตและย้ายห้อง
  r := public.import_dmc(2569, '[{"citizen_id":"1000000000003","first_name":"ปกรณ์","last_name":"ทองดีมาก","gender":"ช","grade":"ป.3","room":"1","raw":{}}]');
  assert (r ->> 'updated')::int = 1 and (r ->> 'moved')::int = 1, 'นำเข้าซ้ำผิด: ' || r::text;
  assert (select last_name from public.students where citizen_id = '1000000000003') = 'ทองดีมาก';
  assert exists (select 1 from public.audit_log where table_name = 'students' and action = 'update'
                 and new_data ->> 'last_name' = 'ทองดีมาก'), 'ไม่มีประวัติการแก้ไข';
end $$;

insert into public.homeroom_assignments (classroom_id, staff_id, kind)
select c.id, s.id, 'homeroom' from public.classrooms c, public.staff s
where c.grade = 'ป.3' and c.room = 1 and s.email = 'homeroom@example.com';
insert into public.subjects (code, name, grade) values ('ค13101', 'คณิตศาสตร์', 'ป.3');
insert into public.teaching_assignments (term_id, subject_id, classroom_id, staff_id)
select t.id, sj.id, c.id, s.id from public.terms t, public.subjects sj, public.classrooms c, public.staff s
where c.grade = 'ป.3' and c.room = 1 and s.email = 'subject@example.com';

-- ครูที่ปรึกษา: เช็กชื่อ ดื่มนม
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$
declare
  c integer := (select id from public.classrooms where grade = 'ป.3' and room = 1);
  s1 uuid := (select id from public.students where citizen_id = '1000000000001');
  s2 uuid := (select id from public.students where citizen_id = '1000000000002');
  s3 uuid := (select id from public.students where citizen_id = '1000000000003');
  d date := pg_temp.school_day();
  r jsonb;
begin
  assert (select count(*) from public.roster(c)) = 3, 'roster ห้อง ป.3/1 ต้องมี 3 คน';
  assert (select count(*) from public.students) = 3, 'ครูที่ปรึกษาต้องเห็นข้อมูลเต็มเฉพาะห้องตัวเอง';
  r := public.save_daily(c, d, 'line', jsonb_build_array(
    jsonb_build_object('s', s1, 'v', 0), jsonb_build_object('s', s2, 'v', 4), jsonb_build_object('s', s3, 'v', 1)));
  assert (r ->> 'changed')::int = 3, 'บันทึกเช็กชื่อผิด ' || r::text;
  r := public.save_daily(c, d, 'line', jsonb_build_array(jsonb_build_object('s', s1, 'v', 0)));
  assert (r ->> 'changed')::int = 0, 'บันทึกซ้ำค่าเดิมต้องไม่นับเป็นการเปลี่ยนแปลง';
  r := public.save_daily(c, d, 'milk', jsonb_build_array(
    jsonb_build_object('s', s1, 'v', true), jsonb_build_object('s', s2, 'v', true), jsonb_build_object('s', s3, 'v', false)));
  assert (select count(*) from public.health_daily where date = d) = 2, 'คนที่ขาดต้องไม่ถูกบันทึกดื่มนม';
  -- เปลี่ยน s1 เป็นลาป่วย: บันทึกดื่มนมของ s1 ต้องหายไป
  perform public.save_daily(c, d, 'line', jsonb_build_array(jsonb_build_object('s', s1, 'v', 2)));
  assert not exists (select 1 from public.health_daily where student_id = s1 and date = d), 'ลาแล้วต้องลบบันทึกดื่มนม';
  assert exists (select 1 from public.record_sessions where classroom_id = c and date = d and kind = 'line');
  assert (select absent from public.attendance_summary(c, d, d) where student_id = s2) = 1, 'สรุปการมาเรียนผิด';
  assert (select line_at is not null from public.daily_progress(d) where classroom_id = c), 'daily_progress ผิด';
end $$;
select pg_temp.expect_error(format('select public.save_daily(%s, %L, ''line'', ''[]'')',
  (select id from public.classrooms where grade = 'ป.3' and room = 1), public.today_th() - 20), '%ย้อนหลัง%');
select pg_temp.expect_error(format('select public.save_daily(%s, %L, ''line'', ''[]'')',
  (select id from public.classrooms where grade = 'ป.6' and room = 1), pg_temp.school_day()), '%เฉพาะครูที่ปรึกษา%');
select pg_temp.expect_error('select public.import_dmc(2569, ''[]'')', '%เฉพาะผู้ดูแลระบบ%');
select pg_temp.expect_error('insert into public.attendance_daily (student_id, date, classroom_id, status) select id, current_date, 1, 0 from public.students limit 1', '%row-level security%');

-- ครูประจำวิชา: เห็นรายชื่อแต่ไม่เห็นข้อมูลส่วนตัว
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
do $$
declare
  c integer := (select id from public.classrooms where grade = 'ป.3' and room = 1);
  sj integer := (select id from public.subjects limit 1);
  r jsonb;
begin
  assert (select count(*) from public.students) = 0, 'ครูประจำวิชาต้องไม่เห็นตาราง students';
  assert (select count(*) from public.roster(c)) = 3, 'ครูประจำวิชาต้องเห็นรายชื่อ';
  r := public.save_subject_attendance(c, pg_temp.school_day(), 1::smallint, sj,
    (select jsonb_agg(jsonb_build_object('s', student_id, 'v', 0)) from public.roster(c)));
  assert (r ->> 'changed')::int = 3, 'เช็กชื่อรายวิชาผิด';
  assert (select count(*) from public.audit_log) = 0, 'ครูทั่วไปต้องไม่เห็นประวัติการแก้ไข';
end $$;

-- คนที่ยังไม่อนุมัติ: ไม่เห็นอะไรเลย
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
do $$ begin
  assert (select count(*) from public.classrooms) = 0, 'คนที่ยังไม่อนุมัติต้องไม่เห็นข้อมูล';
  assert (select count(*) from public.staff) = 1, 'คนที่ยังไม่อนุมัติเห็นได้เฉพาะแถวตัวเอง';
  assert (public.my_profile() ->> 'approved')::boolean = false;
end $$;

-- ผู้ดูแลระบบ: ย้ายสถานะ และเลื่อนชั้น
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$
declare r jsonb;
  s2 uuid := (select id from public.students where citizen_id = '1000000000002');
  s3 uuid := (select id from public.students where citizen_id = '1000000000003');
begin
  perform public.change_student_status(s3, 'moved_out', public.today_th(), 'ย้ายตามผู้ปกครอง');
  assert (select count(*) from public.student_status_history) = 1;
  r := public.promote_year(2569, 2570, array[s2]);
  assert (r ->> 'promoted')::int = 1 and (r ->> 'repeated')::int = 1 and (r ->> 'graduated')::int = 1,
    'เลื่อนชั้นผิด ' || r::text;
  assert (select c.grade from public.enrollments e join public.classrooms c on c.id = e.classroom_id
          where e.year = 2570 and e.student_id = s2) = 'ป.3', 'คนซ้ำชั้นต้องอยู่ชั้นเดิม';
  assert (select c.grade from public.enrollments e join public.classrooms c on c.id = e.classroom_id
          join public.students s on s.id = e.student_id
          where e.year = 2570 and s.citizen_id = '1000000000001') = 'ป.4', 'ต้องเลื่อนเป็น ป.4';
  assert (select status from public.students where citizen_id = '1000000000004') = 'graduated', 'ป.6 ต้องจบการศึกษา';
  assert not exists (select 1 from public.enrollments where year = 2570 and student_id = s3), 'คนย้ายออกต้องไม่ถูกเลื่อนชั้น';
  assert (select count(*) from public.usage_report(public.today_th() - 30, public.today_th())) = 3;
end $$;

select pg_temp.as_super();
