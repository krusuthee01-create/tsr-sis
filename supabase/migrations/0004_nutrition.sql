-- =====================================================================
-- TSR-SIS เฟส 2A : ภาวะโภชนาการ (น้ำหนัก ส่วนสูง)
-- ตารางเกณฑ์อ้างอิงเก็บเป็นข้อมูล นำเข้า/เปลี่ยนชุดได้จากหน้าตั้งค่า
-- รหัสผล:
--   น้ำหนักตามอายุ (wfa)   1 น้อยกว่าเกณฑ์ 2 ค่อนข้างน้อย 3 ตามเกณฑ์ 4 ค่อนข้างมาก 5 มากกว่าเกณฑ์
--   ส่วนสูงตามอายุ (hfa)    1 เตี้ย 2 ค่อนข้างเตี้ย 3 ตามเกณฑ์ 4 ค่อนข้างสูง 5 สูง
--   น้ำหนักตามส่วนสูง (wfh) 1 ผอม 2 ค่อนข้างผอม 3 สมส่วน 4 ท้วม 5 เริ่มอ้วน 6 อ้วน
-- =====================================================================

alter table public.school_settings
  add column growth_reference_name text not null default 'ยังไม่ได้นำเข้าตารางเกณฑ์อ้างอิง',
  add column nutrition_alert_kg numeric(4,1) not null default 5;

-- เกณฑ์ตามอายุ (เดือนเต็ม) แยกเพศ: 1 ชาย 2 หญิง
create table public.growth_ref_age (
  sex smallint not null check (sex in (1, 2)),
  age_months smallint not null check (age_months between 0 and 240),
  w_median numeric(6,2), w_m2 numeric(6,2) not null, w_m15 numeric(6,2) not null, w_p15 numeric(6,2) not null, w_p2 numeric(6,2) not null,
  h_median numeric(6,2), h_m2 numeric(6,2) not null, h_m15 numeric(6,2) not null, h_p15 numeric(6,2) not null, h_p2 numeric(6,2) not null,
  primary key (sex, age_months)
);

-- เกณฑ์น้ำหนักตามส่วนสูง (เซนติเมตรเต็ม) แยกเพศ
create table public.growth_ref_height (
  sex smallint not null check (sex in (1, 2)),
  height_cm smallint not null check (height_cm between 40 and 220),
  median numeric(6,2), m2 numeric(6,2) not null, m15 numeric(6,2) not null, p15 numeric(6,2) not null, p2 numeric(6,2) not null, p3 numeric(6,2) not null,
  primary key (sex, height_cm)
);

-- รอบการชั่งน้ำหนัก/วัดส่วนสูง (ผู้ดูแลระบบสร้าง ค่าเริ่มต้นรายเดือน)
create table public.measurement_rounds (
  id serial primary key,
  year integer not null references public.academic_years(year) on delete cascade,
  name text not null,
  start_date date not null,
  end_date date not null,
  check (end_date >= start_date),
  unique (year, name)
);

create table public.measurements (
  student_id uuid not null references public.students(id) on delete cascade,
  round_id integer not null references public.measurement_rounds(id) on delete restrict,
  classroom_id integer not null references public.classrooms(id) on delete cascade,
  measured_on date not null,
  weight numeric(5,2) check (weight between 5 and 150),
  height numeric(5,1) check (height between 50 and 210),
  age_months smallint,
  wfa smallint, hfa smallint, wfh smallint,
  recorded_by uuid references public.staff(id),
  recorded_at timestamptz not null default now(),
  primary key (student_id, round_id)
);
create index measurements_round_class_idx on public.measurements (round_id, classroom_id);

-- ---------------------------------------------------------------------
-- การแปลผล (ใช้ทั้งตอนบันทึกและตอนเปลี่ยนตารางเกณฑ์)
-- ---------------------------------------------------------------------
create or replace function public.age_in_months(p_birth date, p_at date) returns smallint
language sql immutable as $$
  select case when p_birth is null or p_at is null or p_at < p_birth then null else
    ((extract(year from p_at) - extract(year from p_birth)) * 12
     + (extract(month from p_at) - extract(month from p_birth))
     - case when extract(day from p_at) < extract(day from p_birth) then 1 else 0 end)::smallint end
$$;

create or replace function public.band5(v numeric, m2 numeric, m15 numeric, p15 numeric, p2 numeric) returns smallint
language sql immutable as $$
  select case when v is null or m2 is null then null
    when v < m2 then 1 when v < m15 then 2 when v <= p15 then 3 when v <= p2 then 4 else 5 end::smallint
$$;

create or replace function public.classify_growth(p_sex smallint, p_age smallint, p_weight numeric, p_height numeric,
  out wfa smallint, out hfa smallint, out wfh smallint)
language plpgsql stable security definer set search_path = public as $$
declare a growth_ref_age; h growth_ref_height;
begin
  select * into a from growth_ref_age where sex = p_sex and age_months = p_age;
  if found then
    wfa := band5(p_weight, a.w_m2, a.w_m15, a.w_p15, a.w_p2);
    hfa := band5(p_height, a.h_m2, a.h_m15, a.h_p15, a.h_p2);
  end if;
  if p_height is not null and p_weight is not null then
    select * into h from growth_ref_height where sex = p_sex and height_cm = round(p_height)::smallint;
    if found then
      wfh := case when p_weight < h.m2 then 1 when p_weight < h.m15 then 2 when p_weight <= h.p15 then 3
                  when p_weight <= h.p2 then 4 when p_weight <= h.p3 then 5 else 6 end;
    end if;
  end if;
end $$;

-- ผู้ที่ดูข้อมูลสุขภาพ/การดูแลของห้องได้: ผู้ดูแลระบบ ผู้บริหาร อนามัย แนะแนว ครูที่ปรึกษา ครูพี่เลี้ยง
create or replace function public.can_view_care(p_classroom integer) returns boolean
language sql stable security definer set search_path = public as $$
  select has_any_role(array['admin','executive','health','guidance']) or is_homeroom_of(p_classroom)
$$;

-- ---------------------------------------------------------------------
-- บันทึกน้ำหนัก ส่วนสูง ทั้งห้อง: p_entries = [{"s": uuid, "w": 18.5, "h": 112}]
-- ---------------------------------------------------------------------
create or replace function public.save_measurements(p_classroom integer, p_round integer, p_date date, p_entries jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_staff uuid := my_staff_id();
  r measurement_rounds;
  v_count integer := 0;
  e record;
  g record;
  v_sex smallint;
  v_age smallint;
begin
  if v_staff is null then
    raise exception 'บัญชีนี้ยังไม่ได้รับอนุมัติให้ใช้งาน' using errcode = '42501';
  end if;
  if not (has_any_role(array['admin','health']) or is_homeroom_of(p_classroom)) then
    raise exception 'บันทึกได้เฉพาะครูที่ปรึกษา ครูพี่เลี้ยง งานอนามัย หรือผู้ดูแลระบบ' using errcode = '42501';
  end if;
  select * into r from measurement_rounds where id = p_round;
  if r.id is null then
    raise exception 'ไม่พบรอบการชั่งน้ำหนัก' using errcode = 'P0002';
  end if;
  if p_date > today_th() then
    raise exception 'บันทึกล่วงหน้าไม่ได้' using errcode = '22023';
  end if;

  for e in
    select x.s, x.w, x.h, s.gender, s.birth_date
    from jsonb_to_recordset(p_entries) as x(s uuid, w numeric, h numeric)
    join enrollments en on en.student_id = x.s and en.classroom_id = p_classroom
    join students s on s.id = x.s
  loop
    if e.w is null and e.h is null then
      delete from measurements where student_id = e.s and round_id = p_round;
      continue;
    end if;
    if e.w is not null and (e.w < 5 or e.w > 150) then
      raise exception 'น้ำหนัก % กก. ไม่อยู่ในช่วงที่เป็นไปได้ (5–150)', e.w using errcode = '22023';
    end if;
    if e.h is not null and (e.h < 50 or e.h > 210) then
      raise exception 'ส่วนสูง % ซม. ไม่อยู่ในช่วงที่เป็นไปได้ (50–210)', e.h using errcode = '22023';
    end if;
    v_sex := case e.gender when 'ช' then 1 when 'ญ' then 2 end;
    v_age := age_in_months(e.birth_date, p_date);
    select * into g from classify_growth(v_sex, v_age, e.w, e.h);
    insert into measurements (student_id, round_id, classroom_id, measured_on, weight, height, age_months, wfa, hfa, wfh, recorded_by)
    values (e.s, p_round, p_classroom, p_date, e.w, e.h, v_age, g.wfa, g.hfa, g.wfh, v_staff)
    on conflict (student_id, round_id) do update set
      classroom_id = excluded.classroom_id, measured_on = excluded.measured_on, weight = excluded.weight,
      height = excluded.height, age_months = excluded.age_months, wfa = excluded.wfa, hfa = excluded.hfa,
      wfh = excluded.wfh, recorded_by = excluded.recorded_by, recorded_at = now();
    v_count := v_count + 1;
  end loop;

  insert into audit_log (actor, actor_name, table_name, record_key, action, note)
  values (auth.uid(), current_staff_name(), 'measurements', p_classroom || ':' || p_round, 'save',
          format('บันทึกน้ำหนัก/ส่วนสูง %s คน รอบ %s', v_count, r.name));
  update staff set last_seen_at = now() where id = v_staff;
  return jsonb_build_object('saved', v_count, 'saved_at', now());
end $$;

-- แปลผลใหม่ทั้งหมด (หลังเปลี่ยนตารางเกณฑ์อ้างอิง)
create or replace function public.reclassify_measurements() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  perform assert_admin();
  update measurements m set (wfa, hfa, wfh) = (
    select g.wfa, g.hfa, g.wfh
    from students s, classify_growth(case s.gender when 'ช' then 1::smallint when 'ญ' then 2::smallint end, m.age_months, m.weight, m.height) g
    where s.id = m.student_id
  );
  get diagnostics n = row_count;
  insert into audit_log (actor, actor_name, table_name, record_key, action, note)
  values (auth.uid(), current_staff_name(), 'measurements', null, 'reclassify', format('แปลผลภาวะโภชนาการใหม่ %s รายการ', n));
  return n;
end $$;

-- เปลี่ยนตารางเกณฑ์อ้างอิงทั้งชุดในคำสั่งเดียว (ถ้าผิดพลาดจะไม่มีอะไรเปลี่ยน) แล้วแปลผลใหม่
create or replace function public.replace_growth_refs(p_name text, p_age jsonb, p_height jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare n_age integer; n_height integer; n_re integer;
begin
  perform assert_admin();
  if coalesce(trim(p_name), '') = '' then
    raise exception 'กรุณาตั้งชื่อชุดเกณฑ์' using errcode = '22023';
  end if;
  delete from growth_ref_age where true;
  delete from growth_ref_height where true;
  insert into growth_ref_age select * from jsonb_populate_recordset(null::growth_ref_age, p_age);
  get diagnostics n_age = row_count;
  insert into growth_ref_height select * from jsonb_populate_recordset(null::growth_ref_height, p_height);
  get diagnostics n_height = row_count;
  if n_age = 0 or n_height = 0 then
    raise exception 'ตารางเกณฑ์ว่าง' using errcode = '22023';
  end if;
  update school_settings set growth_reference_name = trim(p_name) where id = 1;
  n_re := reclassify_measurements();
  return jsonb_build_object('age', n_age, 'height', n_height, 'reclassified', n_re);
end $$;

-- สรุปทั้งโรงเรียนรายห้องของรอบที่เลือก
create or replace function public.nutrition_summary(p_round integer)
returns table (classroom_id integer, grade text, room smallint, students integer, measured integer,
  wfa1 integer, wfa2 integer, wfa4 integer, wfa5 integer, hfa1 integer, hfa2 integer,
  wfh1 integer, wfh2 integer, wfh3 integer, wfh4 integer, wfh5 integer, wfh6 integer)
language plpgsql stable security definer set search_path = public as $$
declare v_year integer;
begin
  if not is_staff() then
    raise exception 'ไม่มีสิทธิ์' using errcode = '42501';
  end if;
  select year into v_year from measurement_rounds where id = p_round;
  return query
    select c.id, c.grade, c.room,
      (select count(*)::integer from enrollments e join students s on s.id = e.student_id where e.classroom_id = c.id and s.status = 'studying'),
      count(m.student_id)::integer,
      count(*) filter (where m.wfa = 1)::integer, count(*) filter (where m.wfa = 2)::integer,
      count(*) filter (where m.wfa = 4)::integer, count(*) filter (where m.wfa = 5)::integer,
      count(*) filter (where m.hfa = 1)::integer, count(*) filter (where m.hfa = 2)::integer,
      count(*) filter (where m.wfh = 1)::integer, count(*) filter (where m.wfh = 2)::integer,
      count(*) filter (where m.wfh = 3)::integer, count(*) filter (where m.wfh = 4)::integer,
      count(*) filter (where m.wfh = 5)::integer, count(*) filter (where m.wfh = 6)::integer
    from classrooms c
    join grade_levels g on g.code = c.grade
    left join measurements m on m.classroom_id = c.id and m.round_id = p_round
    where c.year = v_year
    group by c.id, c.grade, c.room, g.sort
    order by g.sort, c.room;
end $$;

-- รายชื่อสำหรับหน้าชั่งน้ำหนัก: เพศ วันเกิด ค่ารอบนี้ และค่าครั้งก่อน
create or replace function public.nutrition_roster(p_classroom integer, p_round integer)
returns table (student_id uuid, number smallint, prefix text, first_name text, last_name text, gender text,
  birth_date date, student_code text, weight numeric, height numeric, measured_on date, wfa smallint, hfa smallint, wfh smallint,
  prev_weight numeric, prev_height numeric, prev_round text)
language plpgsql stable security definer set search_path = public as $$
declare v_start date;
begin
  if not can_view_care(p_classroom) then
    raise exception 'ไม่มีสิทธิ์ดูข้อมูลโภชนาการของห้องนี้' using errcode = '42501';
  end if;
  select start_date into v_start from measurement_rounds where id = p_round;
  return query
    select s.id, e.number, s.prefix, s.first_name, s.last_name, s.gender, s.birth_date, s.student_code,
      m.weight, m.height, m.measured_on, m.wfa, m.hfa, m.wfh,
      p.weight, p.height, p.name
    from enrollments e
    join students s on s.id = e.student_id and s.status = 'studying'
    left join measurements m on m.student_id = s.id and m.round_id = p_round
    left join lateral (
      select pm.weight, pm.height, r.name from measurements pm join measurement_rounds r on r.id = pm.round_id
      where pm.student_id = s.id and r.start_date < v_start
      order by r.start_date desc limit 1
    ) p on true
    where e.classroom_id = p_classroom
    order by e.number nulls last, s.gender, s.first_name;
end $$;

-- ---------------------------------------------------------------------
-- สิทธิ์
-- ---------------------------------------------------------------------
alter table public.growth_ref_age enable row level security;
alter table public.growth_ref_height enable row level security;
alter table public.measurement_rounds enable row level security;
alter table public.measurements enable row level security;

create policy growth_ref_age_read on public.growth_ref_age for select to authenticated using ((select public.is_staff()));
create policy growth_ref_age_admin on public.growth_ref_age for all to authenticated
  using ((select public.has_role('admin'))) with check ((select public.has_role('admin')));
create policy growth_ref_height_read on public.growth_ref_height for select to authenticated using ((select public.is_staff()));
create policy growth_ref_height_admin on public.growth_ref_height for all to authenticated
  using ((select public.has_role('admin'))) with check ((select public.has_role('admin')));
create policy rounds_read on public.measurement_rounds for select to authenticated using ((select public.is_staff()));
create policy rounds_admin on public.measurement_rounds for all to authenticated
  using ((select public.has_any_role(array['admin','health']))) with check ((select public.has_any_role(array['admin','health'])));
create policy measurements_read on public.measurements for select to authenticated using (public.can_view_care(classroom_id));

create trigger measurement_rounds_audit after insert or update or delete on public.measurement_rounds
  for each row execute function public.audit_trigger();

grant select, insert, update, delete on public.growth_ref_age, public.growth_ref_height, public.measurement_rounds, public.measurements
  to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
