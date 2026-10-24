-- ทดสอบพัฒนาการเด็กปฐมวัย (ข้อมูลสมมติ)
\set ON_ERROR_STOP 1
\i supabase/migrations/0008_kg_development.sql

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000b', 'homeroom@example.com', '{"full_name":"สมใจ รักเรียน"}'),
  ('00000000-0000-0000-0000-00000000000d', 'academic@example.com', '{"full_name":"วิชาการ ใจดี"}'),
  ('00000000-0000-0000-0000-00000000000e', 'other@example.com', '{"full_name":"ครู ห้องอื่น"}');
create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p::text, false); perform set_config('role', 'authenticated', false); end $$;
create function pg_temp.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin execute p_sql; raise exception 'คาดว่าจะ error แต่ไม่ error: %', p_sql;
exception when others then if sqlerrm not like p_like then raise exception 'error ไม่ตรง: % (ได้ %)', p_like, sqlerrm; end if; end $$;

update public.staff set approved = true;
update public.staff set roles = '{academic}' where email = 'academic@example.com';
insert into public.academic_years (year) values (2569);
update public.school_settings set current_year = 2569;
insert into public.classrooms (year, grade, room) values (2569, 'อ.3', 1);
insert into public.students (id, citizen_id, prefix, first_name, last_name) values
  ('40000000-0000-0000-0000-000000000001', '4000000000001', 'เด็กชาย', 'ภูมิ', 'ใจดี'),
  ('40000000-0000-0000-0000-000000000002', '4000000000002', 'เด็กหญิง', 'ฟ้า', 'สดใส');
insert into public.enrollments (student_id, year, classroom_id, number)
select s.id, 2569, c.id, row_number() over (order by s.citizen_id) from public.students s, public.classrooms c;
insert into public.homeroom_assignments (classroom_id, staff_id, kind)
select c.id, s.id, 'homeroom' from public.classrooms c, public.staff s where s.email = 'homeroom@example.com';

do $$
begin
  assert public.kg_levels(array_fill(3::smallint, array[33])) = '{"physical":3,"emotional":3,"civic":3,"intellectual":3}', public.kg_levels(array_fill(3::smallint, array[33]))::text;
  assert (public.kg_levels(array[1,1,2,1]::smallint[] || array_fill(2::smallint, array[29])) ->> 'physical')::int = 1;
  assert (public.kg_levels2(array[1,1,1,1]::smallint[], array[3,3,3,3]::smallint[]) ->> 'physical')::int = 2;
end $$;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$
declare r jsonb; c integer := (select id from public.classrooms);
  t3 jsonb := to_jsonb(array_fill(3, array[33]));
  t2 jsonb := to_jsonb(array_fill(2, array[33]));
  e jsonb := to_jsonb(array_fill(null::int, array[33]));
  rows jsonb;
begin
  -- คนที่ 1 ชื่อตรง (มีช่องว่าง/คำนำหน้าต่างกันได้), คนที่ 2 ชื่อสะกดต่าง → ใช้เลขที่, คนที่ 3 ไม่พบ
  rows := jsonb_build_array(
    jsonb_build_object('number', 1, 'name', 'ด.ช.ภูมิ  ใจดี', 't1', t3, 't2', e),
    jsonb_build_object('number', 2, 'name', 'เด็กหญิงฟ้าใส สดใส', 't1', t2, 't2', e),
    jsonb_build_object('number', 9, 'name', 'เด็กชายไม่มี ในระบบ', 't1', t2, 't2', e));
  r := public.import_kg(c, 'อ3-1.xlsx', rows, true);
  assert (r ->> 'matched')::int = 2 and r -> 'by_number' = '[2]' and r -> 'unmatched' = '["9"]' and (r ->> 'added')::int = 2, r::text;
  assert not exists (select 1 from public.kg_development);
  r := public.import_kg(c, 'อ3-1.xlsx', rows, false);
  assert (select count(*) from public.kg_development) = 2;
  assert (select levels ->> 'intellectual' from public.kg_development where student_id = '40000000-0000-0000-0000-000000000001') = '3';
  -- ภาคเรียนที่ 2 → สร้างผลทั้งปี
  rows := jsonb_set(rows, '{0,t2}', t2);
  r := public.import_kg(c, 'อ3-1.xlsx', rows, false);
  assert (r ->> 'added')::int = 1 and (r ->> 'unchanged')::int = 2, r::text;
  assert (select levels ->> 'physical' from public.kg_development where term = 0) = '3', 'เฉลี่ย 3 กับ 2 = 2.5 → ดี';
end $$;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
do $$ begin assert (select count(*) from public.kg_development) = 0; end $$;
select pg_temp.expect_error(format('select public.import_kg(%s, null, ''[]'', true)', (select id from public.classrooms)), 'นำเข้าได้เฉพาะ%');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
do $$
declare s record;
begin
  select * into s from public.sar_summary(2569) where key = 'kg_physical';
  -- คนที่ 1 ทั้งปี = ดี, คนที่ 2 ภาค 1 = พอใช้ → 50%
  assert s.value = 50 and s.base = 2, s::text;
end $$;
