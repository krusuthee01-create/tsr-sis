-- ทดสอบภาวะโภชนาการ (ข้อมูลสมมติ)
\set ON_ERROR_STOP 1

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@example.com', '{"full_name":"วิไล ใจงาม"}'),
  ('00000000-0000-0000-0000-00000000000b', 'homeroom@example.com', '{"full_name":"สมใจ รักเรียน"}'),
  ('00000000-0000-0000-0000-00000000000c', 'other@example.com', '{"full_name":"มานะ สอนดี"}'),
  ('00000000-0000-0000-0000-00000000000e', 'health@example.com', '{"full_name":"อนามัย ดูแล"}');

create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p::text, false);
  perform set_config('role', 'authenticated', false);
end $$;
create function pg_temp.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'คาดว่าจะ error แต่ไม่ error: %', p_sql;
exception when others then
  if sqlerrm not like p_like then raise exception 'error ไม่ตรง: % (ได้ %)', p_like, sqlerrm; end if;
end $$;

update public.staff set approved = true;
update public.staff set roles = '{admin}' where email = 'admin@example.com';
update public.staff set roles = '{health}' where email = 'health@example.com';
insert into public.academic_years (year) values (2569);
update public.school_settings set current_year = 2569;
insert into public.classrooms (year, grade, room) values (2569, 'ป.1', 1), (2569, 'ป.1', 2);
-- เด็กชายอายุ 73 เดือนพอดี ณ 2026-10-15 (เกิด 2020-09-15)
insert into public.students (id, citizen_id, prefix, first_name, last_name, gender, birth_date) values
  ('10000000-0000-0000-0000-000000000001', '1000000000001', 'เด็กชาย', 'ก', 'ทดสอบ', 'ช', '2020-09-15'),
  ('10000000-0000-0000-0000-000000000002', '1000000000002', 'เด็กหญิง', 'ข', 'ทดสอบ', 'ญ', '2020-03-01'),
  ('10000000-0000-0000-0000-000000000003', '1000000000003', 'เด็กชาย', 'ค', 'ห้องอื่น', 'ช', '2020-03-01');
insert into public.enrollments (student_id, year, classroom_id, number)
select '10000000-0000-0000-0000-000000000001'::uuid, 2569, id, 1 from public.classrooms where room = 1
union all select '10000000-0000-0000-0000-000000000002', 2569, id, 2 from public.classrooms where room = 1
union all select '10000000-0000-0000-0000-000000000003', 2569, id, 1 from public.classrooms where room = 2;
insert into public.homeroom_assignments (classroom_id, staff_id)
select c.id, s.id from public.classrooms c, public.staff s where c.room = 1 and s.email = 'homeroom@example.com';
insert into public.measurement_rounds (year, name, start_date, end_date) values (2569, 'ต.ค. 2569', '2026-10-01', '2026-10-31');

do $$
declare g record;
begin
  assert (select count(*) from public.growth_ref_age) = 456, 'ตารางเกณฑ์ตามอายุไม่ครบ';
  assert (select count(*) from public.growth_ref_height) = 252, 'ตารางน้ำหนักตามส่วนสูงไม่ครบ';
  assert public.age_in_months('2020-09-15', '2026-10-15') = 73;
  assert public.age_in_months('2020-09-16', '2026-10-15') = 72;
  -- ค่าเดียวกับที่โปรแกรม ปพ.5 แสดง: ชาย 73 เดือน W median 21.6 (-2SD 15.6, -1.5SD 16.7, +1.5SD 25.6, +2SD 27.6)
  select * into g from public.classify_growth(1::smallint, 73::smallint, 21.6, 115);
  assert g.wfa = 3 and g.hfa = 3, 'ค่ากลางต้องตามเกณฑ์';
  select * into g from public.classify_growth(1::smallint, 73::smallint, 15.5, null);
  assert g.wfa = 1 and g.wfh is null, 'ต่ำกว่า -2SD ต้องน้อยกว่าเกณฑ์';
  select * into g from public.classify_growth(1::smallint, 73::smallint, 16.0, null);
  assert g.wfa = 2, '-2SD ถึง -1.5SD ต้องค่อนข้างน้อย';
  select * into g from public.classify_growth(1::smallint, 73::smallint, 27.6, null);
  assert g.wfa = 4, 'เท่ากับ +2SD ต้องค่อนข้างมาก';
  select * into g from public.classify_growth(1::smallint, 73::smallint, 27.7, null);
  assert g.wfa = 5, 'เกิน +2SD ต้องมากกว่าเกณฑ์';
  -- น้ำหนักตามส่วนสูง: ใช้ค่าจากตารางเอง
  select * into g from public.classify_growth(1::smallint, 73::smallint,
    (select p3 + 0.1 from public.growth_ref_height where sex = 1 and height_cm = 115), 115.2);
  assert g.wfh = 6, 'เกิน +3SD ต้องอ้วน';
  select * into g from public.classify_growth(1::smallint, 73::smallint,
    (select median from public.growth_ref_height where sex = 1 and height_cm = 115), 114.6);
  assert g.wfh = 3, 'ส่วนสูงปัดเป็น 115 แล้วค่ากลางต้องสมส่วน';
end $$;

-- ครูที่ปรึกษาบันทึกห้องตัวเองได้
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$
declare c integer := (select id from public.classrooms where room = 1); r integer := (select id from public.measurement_rounds);
  res jsonb;
begin
  res := public.save_measurements(c, r, '2026-10-15', '[
    {"s":"10000000-0000-0000-0000-000000000001","w":21.6,"h":115},
    {"s":"10000000-0000-0000-0000-000000000002","w":null,"h":null},
    {"s":"10000000-0000-0000-0000-000000000003","w":20,"h":110}]');
  assert (res ->> 'saved')::int = 1, 'ต้องบันทึก 1 คน (อีกคนเว้นว่าง อีกคนไม่ใช่ห้องนี้) ได้ ' || res::text;
  assert (select wfa from public.measurements where student_id = '10000000-0000-0000-0000-000000000001') = 3;
  assert (select age_months from public.measurements where student_id = '10000000-0000-0000-0000-000000000001') = 73;
  assert (select count(*) from public.measurements) = 1, 'ครูที่ปรึกษาเห็นเฉพาะห้องตัวเอง';
  assert (select measured from public.nutrition_summary(r) where classroom_id = c) = 1;
end $$;
select pg_temp.expect_error(format('select public.save_measurements(%s, %s, ''2026-10-15'', ''[{"s":"10000000-0000-0000-0000-000000000001","w":500,"h":115}]'')',
  (select id from public.classrooms where room = 1), (select id from public.measurement_rounds)), '%ไม่อยู่ในช่วง%');
select pg_temp.expect_error(format('select public.save_measurements(%s, %s, ''2026-10-15'', ''[]'')',
  (select id from public.classrooms where room = 2), (select id from public.measurement_rounds)), '%บันทึกได้เฉพาะ%');

-- ครูทั่วไปไม่เห็นข้อมูลโภชนาการ
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
do $$ begin assert (select count(*) from public.measurements) = 0, 'ครูทั่วไปต้องไม่เห็นข้อมูลโภชนาการ'; end $$;

-- งานอนามัยบันทึกได้ทุกห้องและเห็นทั้งโรงเรียน
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
do $$ begin
  perform public.save_measurements((select id from public.classrooms where room = 2), (select id from public.measurement_rounds), '2026-10-15',
    '[{"s":"10000000-0000-0000-0000-000000000003","w":20,"h":110}]');
  assert (select count(*) from public.measurements) = 2, 'งานอนามัยต้องเห็นทุกห้อง';
end $$;

-- เปลี่ยนตารางเกณฑ์แล้วแปลผลใหม่
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin
  update public.growth_ref_age set w_p2 = 20, w_p15 = 19 where sex = 1 and age_months = 73;
  assert public.reclassify_measurements() = 2;
  assert (select wfa from public.measurements where student_id = '10000000-0000-0000-0000-000000000001') = 5, 'แปลผลใหม่ต้องใช้เกณฑ์ใหม่';
end $$;

-- รายชื่อพร้อมค่าครั้งก่อน และลบรอบที่มีข้อมูลไม่ได้
do $$
declare c integer := (select id from public.classrooms where room = 1);
  r1 integer := (select id from public.measurement_rounds);
  r2 integer;
begin
  insert into public.measurement_rounds (year, name, start_date, end_date) values (2569, 'พ.ย. 2569', '2026-11-01', '2026-11-30') returning id into r2;
  assert (select prev_weight from public.nutrition_roster(c, r2) where student_id = '10000000-0000-0000-0000-000000000001') = 21.6, 'ต้องเห็นค่าครั้งก่อน';
  assert (select count(*) from public.nutrition_roster(c, r2)) = 2;
  begin
    delete from public.measurement_rounds where id = r1;
    raise exception 'ลบรอบที่มีข้อมูลได้';
  exception when foreign_key_violation then null;
  end;
end $$;

-- เปลี่ยนตารางเกณฑ์ทั้งชุด
do $$
declare r jsonb;
begin
  r := public.replace_growth_refs('ทดสอบ 2564',
    '[{"sex":1,"age_months":73,"w_median":20,"w_m2":14,"w_m15":15,"w_p15":24,"w_p2":26,"h_median":115,"h_m2":105,"h_m15":108,"h_p15":122,"h_p2":124}]',
    '[{"sex":1,"height_cm":115,"median":20,"m2":16,"m15":17,"p15":22,"p2":23,"p3":25}]');
  assert (r ->> 'age')::int = 1 and (r ->> 'height')::int = 1, r::text;
  assert (select growth_reference_name from public.school_settings) = 'ทดสอบ 2564';
  assert (select wfa from public.measurements where student_id = '10000000-0000-0000-0000-000000000001') = 3;
  begin
    perform public.replace_growth_refs('ว่าง', '[]', '[]');
    raise exception 'ตารางว่างต้องไม่ผ่าน';
  exception when others then
    if sqlerrm not like '%ว่าง%' then raise; end if;
  end;
  assert (select count(*) from public.growth_ref_age) = 1, 'ผิดพลาดแล้วต้องไม่ลบตารางเดิม';
end $$;
