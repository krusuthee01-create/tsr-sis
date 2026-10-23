-- =====================================================================
-- TSR-SIS เฟส 2B : ระบบดูแลช่วยเหลือนักเรียน
-- เยี่ยมบ้าน, SDQ, EQ, คัดกรอง 6 ด้าน, การช่วยเหลือ/ส่งต่อ
-- ไฟล์นี้รันซ้ำได้ (ไม่ error ถ้าเคยรันแล้ว)
-- ระดับ: 1 ปกติ, 2 เสี่ยง, 3 มีปัญหา
-- =====================================================================

-- เกณฑ์ที่ผู้ดูแลระบบปรับได้ ------------------------------------------------
alter table public.school_settings add column if not exists sdq_cutoffs jsonb not null default '{
  "teacher": {"total": [15, 18], "emotional": [3, 4], "conduct": [3, 4], "hyperactivity": [5, 6], "peer": [3, 4], "prosocial": [3]},
  "parent":  {"total": [16, 19], "emotional": [3, 4], "conduct": [3, 4], "hyperactivity": [5, 6], "peer": [3, 4], "prosocial": [3]},
  "self":    {"total": [17, 19], "emotional": [5, 6], "conduct": [4, 5], "hyperactivity": [5, 6], "peer": [3, 4], "prosocial": [3]}
}';
alter table public.school_settings add column if not exists eq_ranges jsonb not null default '{}';
alter table public.school_settings add column if not exists screening_rules jsonb not null default '{
  "attendance_risk": 80, "attendance_problem": 70,
  "income_per_person_risk": 5000, "income_per_person_problem": 3000,
  "followup_days": 14
}';

-- ใครดูข้อมูลอ่อนไหวของนักเรียนได้ (เยี่ยมบ้าน SDQ คัดกรอง): ผู้ดูแลระบบ ผู้บริหาร แนะแนว ครูที่ปรึกษา (ไม่รวมครูพี่เลี้ยง)
create or replace function public.can_view_sensitive(p_classroom integer) returns boolean
language sql stable security definer set search_path = public as $$
  select has_any_role(array['admin','executive','guidance']) or is_homeroom_of(p_classroom, false)
$$;
create or replace function public.can_edit_care(p_classroom integer) returns boolean
language sql stable security definer set search_path = public as $$
  select has_any_role(array['admin','guidance']) or is_homeroom_of(p_classroom, false)
$$;
-- ห้องปัจจุบันของนักเรียน (ปีการศึกษาปัจจุบัน)
create or replace function public.current_classroom_of(p_student uuid) returns integer
language sql stable security definer set search_path = public as $$
  select e.classroom_id from enrollments e
  where e.student_id = p_student and e.year = (select current_year from school_settings where id = 1)
$$;

-- เยี่ยมบ้าน ------------------------------------------------------------------
create table if not exists public.home_visits (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  year integer not null references public.academic_years(year),
  classroom_id integer not null references public.classrooms(id),
  visit_date date not null,
  visitor_id uuid references public.staff(id),
  data jsonb not null default '{}',         -- คำตอบในแบบบันทึก (ครอบครัว ที่อยู่อาศัย การเดินทาง ฯลฯ)
  household_size smallint check (household_size between 1 and 30),
  monthly_income numeric(10,0) check (monthly_income >= 0),
  safety_risk boolean not null default false,
  latitude numeric(9,6),
  longitude numeric(9,6),
  photos text[] not null default '{}',      -- path ใน Storage bucket home-visits (ไม่เกิน 3 รูป)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (coalesce(array_length(photos, 1), 0) <= 3)
);
create index if not exists home_visits_student_idx on public.home_visits (student_id, year);
create index if not exists home_visits_class_idx on public.home_visits (classroom_id, year);

-- SDQ (25 ข้อ คำตอบ 0/1/2) --------------------------------------------------
create table if not exists public.sdq_results (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  year integer not null references public.academic_years(year),
  term smallint not null check (term in (1, 2)),
  classroom_id integer not null references public.classrooms(id),
  informant text not null check (informant in ('teacher', 'parent', 'self')),
  answers smallint[] not null check (array_length(answers, 1) = 25),
  emotional smallint, conduct smallint, hyperactivity smallint, peer smallint, prosocial smallint, total smallint,
  levels jsonb,                     -- {"total":1,"emotional":2,...,"prosocial":1}
  level smallint,                   -- ระดับรวม (จากคะแนนรวมปัญหา)
  recorded_by uuid references public.staff(id),
  recorded_at timestamptz not null default now(),
  unique (student_id, year, term, informant)
);
create index if not exists sdq_class_idx on public.sdq_results (classroom_id, year, term);

-- EQ (คะแนนรวมรายด้าน ดี เก่ง สุข) ---------------------------------------------
create table if not exists public.eq_results (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  year integer not null references public.academic_years(year),
  term smallint not null check (term in (1, 2)),
  classroom_id integer not null references public.classrooms(id),
  version text not null check (version in ('3-5', '6-11')),
  good numeric(6,1), smart numeric(6,1), happy numeric(6,1),
  levels jsonb,                     -- {"good":1,"smart":2,"happy":1} 0 = ต่ำกว่าปกติ 1 = ปกติ 2 = สูงกว่าปกติ
  recorded_by uuid references public.staff(id),
  recorded_at timestamptz not null default now(),
  unique (student_id, year, term)
);

-- คัดกรอง 6 ด้าน (ครูที่ปรึกษายืนยัน) -----------------------------------------
create table if not exists public.screenings (
  student_id uuid not null references public.students(id) on delete cascade,
  year integer not null references public.academic_years(year),
  classroom_id integer not null references public.classrooms(id),
  learning smallint not null check (learning between 1 and 3),
  health smallint not null check (health between 1 and 3),
  economic smallint not null check (economic between 1 and 3),
  safety smallint not null check (safety between 1 and 3),
  behavior smallint not null check (behavior between 1 and 3),
  talent text,                      -- ความสามารถพิเศษ (ถ้ามี)
  notes jsonb not null default '{}',-- เหตุผลรายด้าน
  overall smallint generated always as (greatest(learning, health, economic, safety, behavior)) stored,
  confirmed_by uuid references public.staff(id),
  confirmed_at timestamptz not null default now(),
  primary key (student_id, year)
);

-- การช่วยเหลือ / ส่งเสริม / ส่งต่อ --------------------------------------------
create table if not exists public.interventions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  year integer not null references public.academic_years(year),
  classroom_id integer not null references public.classrooms(id),
  action_date date not null,
  domain text not null check (domain in ('learning','health','economic','safety','behavior','talent','attendance','other')),
  activity text not null,
  responsible text,
  result text,
  status text not null default 'ongoing' check (status in ('ongoing','improved','referred_internal','referred_external','closed')),
  created_by uuid references public.staff(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists interventions_student_idx on public.interventions (student_id, action_date desc);

-- ---------------------------------------------------------------------
-- คะแนน SDQ: ข้อกลับคะแนน 7, 11, 14, 21, 25
-- อารมณ์ 3,8,13,16,24 | เกเร 5,7,12,18,22 | อยู่ไม่นิ่ง 2,10,15,21,25 | เพื่อน 6,11,14,19,23 | สัมพันธภาพทางสังคม 1,4,9,17,20
-- ---------------------------------------------------------------------
create or replace function public.sdq_band(v integer, cut jsonb) returns smallint
language sql immutable as $$
  select case when v is null or cut is null then null
    when v <= (cut ->> 0)::int then 1
    when jsonb_array_length(cut) > 1 and v <= (cut ->> 1)::int then 2
    else 3 end::smallint
$$;

create or replace function public.sdq_score(p_answers smallint[], p_informant text,
  out emotional smallint, out conduct smallint, out hyperactivity smallint, out peer smallint,
  out prosocial smallint, out total smallint, out levels jsonb, out level smallint)
language plpgsql stable security definer set search_path = public as $$
declare
  a smallint[] := p_answers;
  r smallint[];
  cut jsonb;
begin
  if array_length(a, 1) <> 25 or exists (select 1 from unnest(a) v where v is null or v not between 0 and 2) then
    raise exception 'คำตอบ SDQ ต้องครบ 25 ข้อ และแต่ละข้อเป็น 0, 1 หรือ 2' using errcode = '22023';
  end if;
  r := a;
  r[7] := 2 - a[7]; r[11] := 2 - a[11]; r[14] := 2 - a[14]; r[21] := 2 - a[21]; r[25] := 2 - a[25];
  emotional := r[3] + r[8] + r[13] + r[16] + r[24];
  conduct := r[5] + r[7] + r[12] + r[18] + r[22];
  hyperactivity := r[2] + r[10] + r[15] + r[21] + r[25];
  peer := r[6] + r[11] + r[14] + r[19] + r[23];
  prosocial := r[1] + r[4] + r[9] + r[17] + r[20];
  total := emotional + conduct + hyperactivity + peer;
  select sdq_cutoffs -> p_informant into cut from school_settings where id = 1;
  levels := jsonb_build_object(
    'total', sdq_band(total, cut -> 'total'),
    'emotional', sdq_band(emotional, cut -> 'emotional'),
    'conduct', sdq_band(conduct, cut -> 'conduct'),
    'hyperactivity', sdq_band(hyperactivity, cut -> 'hyperactivity'),
    'peer', sdq_band(peer, cut -> 'peer'),
    -- สัมพันธภาพทางสังคม: คะแนนสูง = จุดแข็ง (1 มีจุดแข็ง, 3 ไม่มีจุดแข็ง)
    'prosocial', case when cut -> 'prosocial' is null then null when prosocial <= (cut -> 'prosocial' ->> 0)::int then 3 else 1 end);
  level := (levels ->> 'total')::smallint;
end $$;

create or replace function public.save_sdq(p_student uuid, p_term smallint, p_informant text, p_answers smallint[])
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_class integer := current_classroom_of(p_student); v_year integer; s record;
begin
  if v_class is null or not can_edit_care(v_class) then
    raise exception 'บันทึกได้เฉพาะครูที่ปรึกษา งานแนะแนว หรือผู้ดูแลระบบ' using errcode = '42501';
  end if;
  select year into v_year from classrooms where id = v_class;
  select * into s from sdq_score(p_answers, p_informant);
  insert into sdq_results (student_id, year, term, classroom_id, informant, answers, emotional, conduct, hyperactivity, peer, prosocial, total, levels, level, recorded_by)
  values (p_student, v_year, p_term, v_class, p_informant, p_answers, s.emotional, s.conduct, s.hyperactivity, s.peer, s.prosocial, s.total, s.levels, s.level, my_staff_id())
  on conflict (student_id, year, term, informant) do update set
    answers = excluded.answers, emotional = excluded.emotional, conduct = excluded.conduct, hyperactivity = excluded.hyperactivity,
    peer = excluded.peer, prosocial = excluded.prosocial, total = excluded.total, levels = excluded.levels, level = excluded.level,
    classroom_id = excluded.classroom_id, recorded_by = excluded.recorded_by, recorded_at = now();
  return jsonb_build_object('total', s.total, 'level', s.level, 'levels', s.levels);
end $$;

create or replace function public.eq_level(v numeric, rng jsonb) returns smallint
language sql immutable as $$
  select case when v is null or rng is null or jsonb_array_length(rng) < 2 then null
    when v < (rng ->> 0)::numeric then 0 when v > (rng ->> 1)::numeric then 2 else 1 end::smallint
$$;

create or replace function public.save_eq(p_student uuid, p_term smallint, p_version text, p_good numeric, p_smart numeric, p_happy numeric)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_class integer := current_classroom_of(p_student); v_year integer; rng jsonb; lv jsonb;
begin
  if v_class is null or not can_edit_care(v_class) then
    raise exception 'บันทึกได้เฉพาะครูที่ปรึกษา งานแนะแนว หรือผู้ดูแลระบบ' using errcode = '42501';
  end if;
  select year into v_year from classrooms where id = v_class;
  select eq_ranges -> p_version into rng from school_settings where id = 1;
  lv := jsonb_build_object('good', eq_level(p_good, rng -> 'good'), 'smart', eq_level(p_smart, rng -> 'smart'), 'happy', eq_level(p_happy, rng -> 'happy'));
  insert into eq_results (student_id, year, term, classroom_id, version, good, smart, happy, levels, recorded_by)
  values (p_student, v_year, p_term, v_class, p_version, p_good, p_smart, p_happy, lv, my_staff_id())
  on conflict (student_id, year, term) do update set version = excluded.version, good = excluded.good, smart = excluded.smart,
    happy = excluded.happy, levels = excluded.levels, classroom_id = excluded.classroom_id, recorded_by = excluded.recorded_by, recorded_at = now();
  return lv;
end $$;

-- ---------------------------------------------------------------------
-- ข้อเสนอผลคัดกรองจากข้อมูลที่มีอยู่แล้ว (ครูไม่ต้องกรอกซ้ำ)
-- ---------------------------------------------------------------------
create or replace function public.screening_suggestions(p_classroom integer)
returns table (
  student_id uuid, number smallint, prefix text, first_name text, last_name text,
  attendance_pct numeric, wfh smallint, hfa smallint, wfa smallint, sdq_level smallint,
  income_per_person numeric, safety_risk boolean, visited boolean,
  s_learning smallint, s_health smallint, s_economic smallint, s_safety smallint, s_behavior smallint,
  learning smallint, health smallint, economic smallint, safety smallint, behavior smallint, talent text, notes jsonb, confirmed_at timestamptz,
  last_action date
)
language plpgsql stable security definer set search_path = public as $$
declare v_year integer; rules jsonb; v_from date; v_to date := today_th();
begin
  if not can_view_sensitive(p_classroom) then
    raise exception 'ไม่มีสิทธิ์ดูข้อมูลการดูแลช่วยเหลือของห้องนี้' using errcode = '42501';
  end if;
  select year into v_year from classrooms where id = p_classroom;
  select screening_rules into rules from school_settings where id = 1;
  select min(start_date) into v_from from terms where year = v_year;
  return query
  with base as (
    select s.id, e.number, s.prefix, s.first_name, s.last_name,
      -- ร้อยละจากวันที่บันทึกเช็กชื่อแล้ว (ไม่นับวันที่ยังไม่ได้ใช้ระบบ)
      (select case when count(*) > 0 then round(100.0 * count(*) filter (where a.status <= 1) / count(*), 1) end
         from attendance_daily a where a.student_id = s.id and a.date between coalesce(v_from, v_to) and v_to) as att,
      m.wfh, m.hfa, m.wfa,
      (select q.level from sdq_results q where q.student_id = s.id and q.informant = 'teacher' order by q.year desc, q.term desc limit 1) as sdq,
      (select case when h.household_size > 0 and h.monthly_income is not null then round(h.monthly_income / h.household_size) end
         from home_visits h where h.student_id = s.id order by h.visit_date desc limit 1) as ipp,
      coalesce((select h.safety_risk from home_visits h where h.student_id = s.id order by h.visit_date desc limit 1), false) as risk,
      exists (select 1 from home_visits h where h.student_id = s.id and h.year = v_year) as visited
    from enrollments e
    join students s on s.id = e.student_id and s.status = 'studying'
    left join lateral (
      select mm.wfh, mm.hfa, mm.wfa from measurements mm join measurement_rounds r on r.id = mm.round_id
      where mm.student_id = s.id order by r.start_date desc limit 1
    ) m on true
    where e.classroom_id = p_classroom
  )
  select b.id, b.number, b.prefix, b.first_name, b.last_name, b.att, b.wfh, b.hfa, b.wfa, b.sdq, b.ipp, b.risk, b.visited,
    (case when b.att is null then 1 when b.att < (rules ->> 'attendance_problem')::numeric then 3
          when b.att < (rules ->> 'attendance_risk')::numeric then 2 else 1 end)::smallint,
    (case when b.wfh in (1, 6) or b.hfa = 1 then 3 when b.wfh in (2, 5) or b.hfa = 2 or b.wfa = 1 then 2 else 1 end)::smallint,
    (case when b.ipp is null then 1 when b.ipp < (rules ->> 'income_per_person_problem')::numeric then 3
          when b.ipp < (rules ->> 'income_per_person_risk')::numeric then 2 else 1 end)::smallint,
    (case when b.risk then 2 else 1 end)::smallint,
    coalesce(b.sdq, 1)::smallint,
    sc.learning, sc.health, sc.economic, sc.safety, sc.behavior, sc.talent, sc.notes, sc.confirmed_at,
    (select max(i.action_date) from interventions i where i.student_id = b.id)
  from base b
  left join screenings sc on sc.student_id = b.id and sc.year = v_year
  order by b.number nulls last, b.first_name;
end $$;

-- ยืนยันผลคัดกรองทั้งห้อง: p_rows = [{"s":uuid,"learning":1,"health":2,...,"talent":"ดนตรี","notes":{...}}]
create or replace function public.save_screenings(p_classroom integer, p_rows jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_year integer; n integer;
begin
  if not can_edit_care(p_classroom) then
    raise exception 'บันทึกได้เฉพาะครูที่ปรึกษา งานแนะแนว หรือผู้ดูแลระบบ' using errcode = '42501';
  end if;
  select year into v_year from classrooms where id = p_classroom;
  insert into screenings (student_id, year, classroom_id, learning, health, economic, safety, behavior, talent, notes, confirmed_by)
  select x.s, v_year, p_classroom, x.learning, x.health, x.economic, x.safety, x.behavior, nullif(trim(x.talent), ''), coalesce(x.notes, '{}'), my_staff_id()
  from jsonb_to_recordset(p_rows) as x(s uuid, learning smallint, health smallint, economic smallint, safety smallint, behavior smallint, talent text, notes jsonb)
  join enrollments e on e.student_id = x.s and e.classroom_id = p_classroom
  on conflict (student_id, year) do update set
    classroom_id = excluded.classroom_id, learning = excluded.learning, health = excluded.health, economic = excluded.economic,
    safety = excluded.safety, behavior = excluded.behavior, talent = excluded.talent, notes = excluded.notes,
    confirmed_by = excluded.confirmed_by, confirmed_at = now();
  get diagnostics n = row_count;
  insert into audit_log (actor, actor_name, table_name, record_key, action, note)
  values (auth.uid(), current_staff_name(), 'screenings', p_classroom::text, 'save', format('ยืนยันผลคัดกรอง %s คน', n));
  return n;
end $$;

-- ภาพรวมทั้งโรงเรียน: จำนวนเสี่ยง/มีปัญหารายห้อง และงานที่ค้าง
create or replace function public.care_overview()
returns table (classroom_id integer, grade text, room smallint, students integer, screened integer, risk integer, problem integer,
  visited integer, sdq_done integer, needs_action integer)
language plpgsql stable security definer set search_path = public as $$
declare v_year integer := (select current_year from school_settings where id = 1);
  v_days integer := coalesce(((select screening_rules from school_settings where id = 1) ->> 'followup_days')::int, 14);
begin
  if not has_any_role(array['admin','executive','guidance']) then
    raise exception 'ไม่มีสิทธิ์' using errcode = '42501';
  end if;
  return query
    select c.id, c.grade, c.room,
      count(s.id)::integer,
      count(sc.student_id)::integer,
      count(*) filter (where sc.overall = 2)::integer,
      count(*) filter (where sc.overall = 3)::integer,
      count(*) filter (where exists (select 1 from home_visits h where h.student_id = s.id and h.year = v_year))::integer,
      count(*) filter (where exists (select 1 from sdq_results q where q.student_id = s.id and q.year = v_year and q.informant = 'teacher'))::integer,
      count(*) filter (where sc.overall >= 2 and not exists (
        select 1 from interventions i where i.student_id = s.id and i.action_date >= today_th() - v_days))::integer
    from classrooms c
    join grade_levels g on g.code = c.grade
    left join enrollments e on e.classroom_id = c.id
    left join students s on s.id = e.student_id and s.status = 'studying'
    left join screenings sc on sc.student_id = s.id and sc.year = v_year
    where c.year = v_year
    group by c.id, c.grade, c.room, g.sort
    order by g.sort, c.room;
end $$;

-- บันทึกเกณฑ์ดูแลช่วยเหลือ แล้วแปลผล SDQ/EQ ที่บันทึกไว้ทั้งหมดใหม่ตามเกณฑ์ล่าสุด
create or replace function public.save_care_settings(p_sdq jsonb, p_eq jsonb, p_rules jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare n_sdq integer; n_eq integer;
begin
  if not has_any_role(array['admin']) then
    raise exception 'เฉพาะผู้ดูแลระบบ' using errcode = '42501';
  end if;
  if jsonb_typeof(p_sdq) <> 'object' or jsonb_typeof(p_eq) <> 'object' or jsonb_typeof(p_rules) <> 'object' then
    raise exception 'รูปแบบเกณฑ์ไม่ถูกต้อง' using errcode = '22023';
  end if;
  update school_settings set sdq_cutoffs = p_sdq, eq_ranges = p_eq, screening_rules = p_rules where id = 1;
  update sdq_results q set levels = x.levels, level = x.level
    from (select q2.id, (sdq_score(q2.answers, q2.informant)).* from sdq_results q2) x
    where x.id = q.id and (q.levels is distinct from x.levels or q.level is distinct from x.level);
  get diagnostics n_sdq = row_count;
  update eq_results e set levels = jsonb_build_object(
      'good', eq_level(e.good, p_eq -> e.version -> 'good'),
      'smart', eq_level(e.smart, p_eq -> e.version -> 'smart'),
      'happy', eq_level(e.happy, p_eq -> e.version -> 'happy'));
  get diagnostics n_eq = row_count;
  return jsonb_build_object('sdq', n_sdq, 'eq', n_eq);
end $$;

-- ---------------------------------------------------------------------
-- สิทธิ์ (RLS)
-- ---------------------------------------------------------------------
alter table public.home_visits enable row level security;
alter table public.sdq_results enable row level security;
alter table public.eq_results enable row level security;
alter table public.screenings enable row level security;
alter table public.interventions enable row level security;

drop policy if exists home_visits_read on public.home_visits;
create policy home_visits_read on public.home_visits for select to authenticated using (public.can_view_sensitive(classroom_id));
drop policy if exists home_visits_write on public.home_visits;
create policy home_visits_write on public.home_visits for all to authenticated
  using (public.can_edit_care(classroom_id)) with check (public.can_edit_care(classroom_id));

drop policy if exists sdq_read on public.sdq_results;
create policy sdq_read on public.sdq_results for select to authenticated using (public.can_view_sensitive(classroom_id));
drop policy if exists eq_read on public.eq_results;
create policy eq_read on public.eq_results for select to authenticated using (public.can_view_sensitive(classroom_id));
drop policy if exists screenings_read on public.screenings;
create policy screenings_read on public.screenings for select to authenticated using (public.can_view_sensitive(classroom_id));

drop policy if exists interventions_read on public.interventions;
create policy interventions_read on public.interventions for select to authenticated using (public.can_view_sensitive(classroom_id));
drop policy if exists interventions_write on public.interventions;
create policy interventions_write on public.interventions for all to authenticated
  using (public.can_edit_care(classroom_id)) with check (public.can_edit_care(classroom_id));

-- ประวัติการแก้ไข
do $$
declare t text;
begin
  foreach t in array array['home_visits', 'sdq_results', 'eq_results', 'interventions'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_trigger()', t || '_audit', t);
  end loop;
  foreach t in array array['home_visits', 'interventions'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.touch_updated_at()', t || '_touch', t);
  end loop;
end $$;

-- ที่เก็บรูปเยี่ยมบ้าน (Supabase Storage) — path: <student_id>/<ชื่อไฟล์>
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('home-visits', 'home-visits', false, 1048576, array['image/jpeg', 'image/webp'])
    on conflict (id) do nothing;
    execute 'drop policy if exists home_visit_photos_read on storage.objects';
    execute $p$create policy home_visit_photos_read on storage.objects for select to authenticated
      using (bucket_id = 'home-visits' and public.can_view_sensitive(public.current_classroom_of(((storage.foldername(name))[1])::uuid)))$p$;
    execute 'drop policy if exists home_visit_photos_write on storage.objects';
    execute $p$create policy home_visit_photos_write on storage.objects for insert to authenticated
      with check (bucket_id = 'home-visits' and public.can_edit_care(public.current_classroom_of(((storage.foldername(name))[1])::uuid)))$p$;
    execute 'drop policy if exists home_visit_photos_delete on storage.objects';
    execute $p$create policy home_visit_photos_delete on storage.objects for delete to authenticated
      using (bucket_id = 'home-visits' and public.can_edit_care(public.current_classroom_of(((storage.foldername(name))[1])::uuid)))$p$;
  end if;
end $$;

grant select, insert, update, delete on public.home_visits, public.sdq_results, public.eq_results, public.screenings, public.interventions
  to authenticated, service_role;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
