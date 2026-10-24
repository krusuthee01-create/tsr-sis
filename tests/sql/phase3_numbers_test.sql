-- ทดสอบกำหนดเลขที่นักเรียน (ข้อมูลสมมติ)
\set ON_ERROR_STOP 1
\i supabase/migrations/0010_class_numbers.sql

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000b', 'homeroom@example.com', '{"full_name":"สมใจ รักเรียน"}'),
  ('00000000-0000-0000-0000-00000000000c', 'assistant@example.com', '{"full_name":"พี่เลี้ยง ใจดี"}'),
  ('00000000-0000-0000-0000-00000000000e', 'other@example.com', '{"full_name":"ครู ห้องอื่น"}');
create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p::text, false); perform set_config('role', 'authenticated', false); end $$;
create function pg_temp.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin execute p_sql; raise exception 'คาดว่าจะ error แต่ไม่ error: %', p_sql;
exception when others then if sqlerrm not like p_like then raise exception 'error ไม่ตรง: % (ได้ %)', p_like, sqlerrm; end if; end $$;

update public.staff set approved = true;
insert into public.academic_years (year) values (2568), (2569);
update public.school_settings set current_year = 2569;
insert into public.classrooms (year, grade, room) values (2569, 'ป.1', 1), (2569, 'ป.1', 2), (2568, 'อ.3', 1);
insert into public.students (id, citizen_id, first_name, last_name) values
  ('60000000-0000-0000-0000-000000000001', '6000000000001', 'ก', 'ทดสอบ'),
  ('60000000-0000-0000-0000-000000000002', '6000000000002', 'ข', 'ทดสอบ'),
  ('60000000-0000-0000-0000-000000000003', '6000000000003', 'ค', 'ทดสอบ');
insert into public.enrollments (student_id, year, classroom_id, number)
select s.id, 2569, c.id, row_number() over (order by s.citizen_id) from public.students s, public.classrooms c where c.grade = 'ป.1' and c.room = 1;
insert into public.enrollments (student_id, year, classroom_id, number)
select s.id, 2568, c.id, 1 from public.students s, public.classrooms c where c.year = 2568 and s.citizen_id = '6000000000001';
insert into public.homeroom_assignments (classroom_id, staff_id, kind)
select c.id, s.id, case s.email when 'assistant@example.com' then 'assistant' else 'homeroom' end
from public.classrooms c, public.staff s where (c.room = 1 and s.email in ('homeroom@example.com', 'assistant@example.com'))
  or (c.room = 2 and c.year = 2569 and s.email = 'other@example.com');
insert into public.homeroom_assignments (classroom_id, staff_id, kind)
select c.id, s.id, 'homeroom' from public.classrooms c, public.staff s where c.year = 2568 and s.email = 'homeroom@example.com'
on conflict do nothing;

create function pg_temp.nums(a int, b int, c int) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('s', '60000000-0000-0000-0000-000000000001', 'n', a),
    jsonb_build_object('s', '60000000-0000-0000-0000-000000000002', 'n', b),
    jsonb_build_object('s', '60000000-0000-0000-0000-000000000003', 'n', c))
$$;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$
declare c integer := (select id from public.classrooms where year = 2569 and room = 1);
begin
  assert public.set_class_numbers(c, pg_temp.nums(3, 1, 2)) = 3;
  assert (select string_agg(s.first_name, '' order by e.number) from public.enrollments e join public.students s on s.id = e.student_id where e.classroom_id = c) = 'ขคก';
  assert public.set_class_numbers(c, pg_temp.nums(3, 1, 2)) = 0, 'ไม่เปลี่ยน = 0';
  perform pg_temp.expect_error(format('select public.set_class_numbers(%s, pg_temp.nums(1, 1, 2))', c), 'มีเลขที่หรือนักเรียนซ้ำ%');
  perform pg_temp.expect_error(format('select public.set_class_numbers(%s, pg_temp.nums(0, 1, 2))', c), 'เลขที่ต้องอยู่ระหว่าง%');
  perform pg_temp.expect_error(format('select public.set_class_numbers(%s, pg_temp.nums(1, 2, 3) - 2)', c), 'รายชื่อไม่ตรง%');
  -- ห้องปีเก่า และห้องอื่น ทำไม่ได้
  perform pg_temp.expect_error(format('select public.set_class_numbers(%s, ''[]'')', (select id from public.classrooms where year = 2568)), 'กำหนดเลขที่ได้เฉพาะ%');
  perform pg_temp.expect_error(format('select public.set_class_numbers(%s, ''[]'')', (select id from public.classrooms where year = 2569 and room = 2)), 'กำหนดเลขที่ได้เฉพาะ%');
end $$;

-- ครูพี่เลี้ยงทำไม่ได้
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect_error(format('select public.set_class_numbers(%s, pg_temp.nums(1, 2, 3))', (select id from public.classrooms where year = 2569 and room = 1)), 'กำหนดเลขที่ได้เฉพาะ%');

reset role;
do $$ begin assert (select count(*) from public.audit_log where action = 'renumber') = 1; end $$;
