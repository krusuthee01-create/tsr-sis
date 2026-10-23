-- ทดสอบระบบดูแลช่วยเหลือ (ข้อมูลสมมติ)
\set ON_ERROR_STOP 1
-- ไฟล์ต้องรันซ้ำได้
\i supabase/migrations/0006_care.sql

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@example.com', '{"full_name":"วิไล ใจงาม"}'),
  ('00000000-0000-0000-0000-00000000000b', 'homeroom@example.com', '{"full_name":"สมใจ รักเรียน"}'),
  ('00000000-0000-0000-0000-00000000000c', 'assistant@example.com', '{"full_name":"พี่เลี้ยง ใจดี"}'),
  ('00000000-0000-0000-0000-00000000000d', 'guidance@example.com', '{"full_name":"แนะแนว ช่วยเหลือ"}');
create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p::text, false); perform set_config('role', 'authenticated', false); end $$;
create function pg_temp.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin execute p_sql; raise exception 'คาดว่าจะ error แต่ไม่ error: %', p_sql;
exception when others then if sqlerrm not like p_like then raise exception 'error ไม่ตรง: % (ได้ %)', p_like, sqlerrm; end if; end $$;

update public.staff set approved = true;
update public.staff set roles = '{admin}' where email = 'admin@example.com';
update public.staff set roles = '{guidance}' where email = 'guidance@example.com';
insert into public.academic_years (year) values (2569);
update public.school_settings set current_year = 2569;
insert into public.terms (year, term, start_date, end_date) values (2569, 1, public.today_th() - 60, public.today_th() + 30);
insert into public.classrooms (year, grade, room) values (2569, 'ป.4', 1);
insert into public.students (id, citizen_id, prefix, first_name, last_name, gender, birth_date) values
  ('20000000-0000-0000-0000-000000000001', '2000000000001', 'เด็กชาย', 'ก', 'ทดสอบ', 'ช', '2016-05-01'),
  ('20000000-0000-0000-0000-000000000002', '2000000000002', 'เด็กหญิง', 'ข', 'ทดสอบ', 'ญ', '2016-06-01');
insert into public.enrollments (student_id, year, classroom_id, number)
select s.id, 2569, c.id, row_number() over (order by s.citizen_id) from public.students s, public.classrooms c;
insert into public.homeroom_assignments (classroom_id, staff_id, kind)
select c.id, s.id, case when s.email = 'homeroom@example.com' then 'homeroom' else 'assistant' end
from public.classrooms c, public.staff s where s.email in ('homeroom@example.com', 'assistant@example.com');

-- คะแนน SDQ ตามสูตรมาตรฐาน
do $$
declare r record;
begin
  select * into r from public.sdq_score(array_fill(0::smallint, array[25]), 'teacher');
  -- ตอบ 0 ทุกข้อ: ข้อกลับคะแนน (7,11,14,21,25) ได้ 2
  assert (r.emotional, r.conduct, r.hyperactivity, r.peer, r.prosocial, r.total) = (0::smallint, 2::smallint, 4::smallint, 4::smallint, 0::smallint, 10::smallint), r::text;
  assert r.level = 1 and (r.levels ->> 'prosocial')::int = 3 and (r.levels ->> 'hyperactivity')::int = 1, r.levels::text;
  select * into r from public.sdq_score(array_fill(2::smallint, array[25]), 'teacher');
  assert r.total = 30 and r.level = 3 and r.prosocial = 10 and (r.levels ->> 'prosocial')::int = 1, r::text;
  -- คะแนนรวม 16 = เสี่ยง (ครู 0-15 / 16-18 / 19-40)
  select * into r from public.sdq_score(array[0,2,2,0,0, 0,2,2,0,2, 2,0,2,2,2, 2,0,0,0,0, 2,0,0,2,2]::smallint[], 'teacher');
  -- อารมณ์ 10 + อยู่ไม่นิ่ง 6 (ข้อกลับคะแนนตอบ 2 = 0 คะแนน)
  assert r.emotional = 10 and r.hyperactivity = 6 and r.total = 16 and r.level = 2, r::text;
  select * into r from public.sdq_score(array[0,2,2,0,0, 0,2,2,0,2, 2,0,2,2,2, 2,0,0,0,0, 2,0,0,2,2]::smallint[], 'self');
  assert r.level = 1, 'ฉบับนักเรียนใช้เกณฑ์ต่างจากฉบับครู';
end $$;
select pg_temp.expect_error('select public.sdq_score(array[1,2,3]::smallint[], ''teacher'')', '%ครบ 25 ข้อ%');

-- ครูที่ปรึกษา: บันทึก SDQ เยี่ยมบ้าน คัดกรอง การช่วยเหลือ
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$
declare c integer := (select id from public.classrooms); r jsonb; sug record;
begin
  r := public.save_sdq('20000000-0000-0000-0000-000000000001', 1::smallint, 'teacher', array_fill(2::smallint, array[25]));
  assert (r ->> 'level')::int = 3;
  r := public.save_sdq('20000000-0000-0000-0000-000000000001', 1::smallint, 'teacher', array_fill(0::smallint, array[25]));
  assert (select count(*) from public.sdq_results) = 1, 'บันทึกซ้ำต้องแทนที่ของเดิม';
  perform public.save_sdq('20000000-0000-0000-0000-000000000002', 1::smallint, 'teacher', array_fill(2::smallint, array[25]));
  insert into public.home_visits (student_id, year, classroom_id, visit_date, household_size, monthly_income, safety_risk, data)
  values ('20000000-0000-0000-0000-000000000002', 2569, c, public.today_th(), 4, 8000, true, '{"living_with":"ตายาย"}');
  -- ขาดเรียนทุกวันที่ผ่านมา (ไม่มีบันทึก = 0%)
  select * into sug from public.screening_suggestions(c) where student_id = '20000000-0000-0000-0000-000000000002';
  assert sug.s_behavior = 3 and sug.s_economic = 3 and sug.s_safety = 2 and sug.visited, sug::text;
  assert sug.income_per_person = 2000;
  assert public.save_screenings(c, jsonb_build_array(jsonb_build_object('s', '20000000-0000-0000-0000-000000000002',
    'learning', 1, 'health', 1, 'economic', 3, 'safety', 2, 'behavior', 3, 'talent', 'วาดภาพ', 'notes', '{"economic":"รายได้น้อย"}'))) = 1;
  assert (select overall from public.screenings) = 3;
  insert into public.interventions (student_id, year, classroom_id, action_date, domain, activity, status)
  values ('20000000-0000-0000-0000-000000000002', 2569, c, public.today_th(), 'economic', 'เสนอขอทุนปัจจัยพื้นฐาน', 'ongoing');
  assert (select last_action from public.screening_suggestions(c) where student_id = '20000000-0000-0000-0000-000000000002') = public.today_th();
end $$;

-- ครูพี่เลี้ยง: ไม่เห็นข้อมูลอ่อนไหว บันทึกไม่ได้
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
do $$ begin
  assert (select count(*) from public.home_visits) = 0, 'ครูพี่เลี้ยงต้องไม่เห็นการเยี่ยมบ้าน';
  assert (select count(*) from public.sdq_results) = 0, 'ครูพี่เลี้ยงต้องไม่เห็น SDQ';
end $$;
select pg_temp.expect_error('select public.save_sdq(''20000000-0000-0000-0000-000000000001'', 1::smallint, ''teacher'', array_fill(0::smallint, array[25]))', '%บันทึกได้เฉพาะ%');
select pg_temp.expect_error(format('select * from public.screening_suggestions(%s)', (select id from public.classrooms)), '%ไม่มีสิทธิ์%');

-- งานแนะแนว: เห็นภาพรวมทั้งโรงเรียน
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
do $$
declare o record;
begin
  select * into o from public.care_overview();
  assert o.students = 2 and o.screened = 1 and o.problem = 1 and o.visited = 1 and o.sdq_done = 2 and o.needs_action = 0, o::text;
  assert (select count(*) from public.interventions) = 1;
end $$;

-- EQ: ยังไม่ตั้งช่วงปกติ = ไม่แปลผล / ตั้งแล้วแปลผล
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$
declare lv jsonb;
begin
  lv := public.save_eq('20000000-0000-0000-0000-000000000001', 1::smallint, '6-11', 50, 60, 70);
  assert lv ->> 'good' is null;
  update public.school_settings set eq_ranges = '{"6-11":{"good":[48,58],"smart":[45,57],"happy":[45,62]}}';
  lv := public.save_eq('20000000-0000-0000-0000-000000000001', 1::smallint, '6-11', 47, 50, 70);
  assert (lv ->> 'good')::int = 0 and (lv ->> 'smart')::int = 1 and (lv ->> 'happy')::int = 2, lv::text;
  assert (select count(*) from public.eq_results) = 1;
end $$;

-- เปลี่ยนเกณฑ์จากหน้าตั้งค่า: ผลเดิมถูกแปลใหม่ทั้งหมด
do $$
declare r jsonb; s jsonb;
begin
  s := (select sdq_cutoffs from public.school_settings);
  r := public.save_care_settings(jsonb_set(s, '{teacher,hyperactivity}', '[2,3]'),
    '{"6-11":{"good":[40,46],"smart":[45,57],"happy":[45,62]}}', '{"attendance_risk":80,"attendance_problem":70,"income_per_person_risk":5000,"income_per_person_problem":3000,"followup_days":7}');
  assert (r ->> 'eq')::int = 1, r::text;
  assert (select (levels ->> 'good')::int from public.eq_results) = 2;
  assert (select (screening_rules ->> 'followup_days')::int from public.school_settings) = 7;
  -- ตอบ 0 ทุกข้อ ได้ hyperactivity 4 > 3 จึงเป็น "มีปัญหา" ตามเกณฑ์ใหม่
  assert not exists (select 1 from public.sdq_results where informant = 'teacher' and answers = array_fill(0::smallint, array[25]) and (levels ->> 'hyperactivity')::int <> 3);
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$select public.save_care_settings('{}', '{}', '{}')$$, 'เฉพาะผู้ดูแลระบบ%');
