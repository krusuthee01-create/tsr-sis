-- =====================================================================
-- เฟส 3: ผลการเรียน (นำเข้าจากโปรแกรม ปพ.5-6) สถิติ ผลสอบระดับชาติ และข้อมูล SAR
-- ไฟล์นี้รันซ้ำได้ (ใช้ if not exists / create or replace)
-- =====================================================================

-- บทบาทใหม่: งานวิชาการ
alter table public.staff drop constraint if exists staff_roles_check;
alter table public.staff add constraint staff_roles_check
  check (roles <@ array['admin','executive','health','guidance','academic']::text[]);

-- ---------------------------------------------------------------------
-- ตาราง
-- ---------------------------------------------------------------------
create table if not exists public.grade_results (
  student_id uuid not null references public.students(id) on delete cascade,
  year integer not null references public.academic_years(year),
  term smallint not null check (term in (0, 1, 2)),          -- 0 = สรุปทั้งปี
  subject_id integer not null references public.subjects(id) on delete restrict,
  classroom_id integer not null references public.classrooms(id),
  mid_score numeric(6,2),
  final_score numeric(6,2),
  total numeric(6,2),
  percent numeric(6,2),
  grade text not null check (grade in ('4','3.5','3','2.5','2','1.5','1','0','ร','มส')),
  grade_point numeric(2,1) generated always as (case when grade in ('ร','มส') then null else grade::numeric end) stored,
  import_id uuid,
  imported_at timestamptz not null default now(),
  primary key (student_id, year, term, subject_id)
);
create index if not exists grade_results_class_idx on public.grade_results (classroom_id, year, term);

create table if not exists public.student_assessments (
  student_id uuid not null references public.students(id) on delete cascade,
  year integer not null references public.academic_years(year),
  term smallint not null check (term in (0, 1, 2)),
  classroom_id integer not null references public.classrooms(id),
  kind text not null check (kind in ('trait','rtw','values','competency','activity')),
  items jsonb not null default '[]',   -- คะแนนรายข้อ 0–3 หรือ {"ชื่อกิจกรรม":"ผ่าน"}
  result text check (result in ('ไม่ผ่าน','ผ่าน','ดี','ดีเยี่ยม')),
  import_id uuid,
  primary key (student_id, year, term, kind)
);
create index if not exists student_assessments_class_idx on public.student_assessments (classroom_id, year, term);

create table if not exists public.grade_imports (
  id uuid primary key default gen_random_uuid(),
  classroom_id integer not null references public.classrooms(id),
  year integer not null,
  term smallint,
  file_name text,
  summary jsonb not null default '{}',
  imported_by uuid references public.staff(id),
  imported_at timestamptz not null default now()
);

-- ผลสอบระดับชาติ (ค่าเฉลี่ยระดับโรงเรียน)
create table if not exists public.national_tests (
  id serial primary key,
  year integer not null,
  test text not null check (test in ('RT','NT','O-NET')),
  subject text not null,
  school_avg numeric(6,2),
  province_avg numeric(6,2),
  national_avg numeric(6,2),
  students integer,
  unique (year, test, subject)
);

-- ค่าเป้าหมายตัวชี้วัด SAR (ร้อยละ หรือค่าเฉลี่ย)
create table if not exists public.sar_targets (
  year integer not null,
  key text not null,
  target numeric(6,2) not null,
  primary key (year, key)
);

-- ---------------------------------------------------------------------
-- สิทธิ์
-- ---------------------------------------------------------------------
-- ผู้บริหาร งานวิชาการ ผู้ดูแลระบบ: ทุกห้อง / ครูที่ปรึกษา: ห้องตัวเอง / ครูประจำวิชา: เฉพาะวิชาที่สอน
create or replace function public.can_view_grades(p_classroom integer, p_subject integer) returns boolean
language sql stable security definer set search_path = public as $$
  select has_any_role(array['admin','executive','academic'])
    or is_homeroom_of(p_classroom, false)
    or (p_subject is not null and exists (
      select 1 from teaching_assignments t
      where t.classroom_id = p_classroom and t.subject_id = p_subject and t.staff_id = my_staff_id()))
$$;

create or replace function public.can_import_grades(p_classroom integer) returns boolean
language sql stable security definer set search_path = public as $$
  select has_any_role(array['admin','academic']) or is_homeroom_of(p_classroom, false)
$$;

-- ---------------------------------------------------------------------
-- นำเข้าไฟล์ ปพ.5 ของห้อง (p_dry_run = true: แสดงรายการที่จะเปลี่ยนโดยยังไม่บันทึก)
-- p_subjects: [{code,name,hours,area,grade}]
-- p_students: [{citizen_id, number, results:[{code,term,mid,final,total,percent,grade}], assessments:[{term,kind,items,result}]}]
-- ---------------------------------------------------------------------
create or replace function public.import_pp5(p_classroom integer, p_term smallint, p_file_name text,
  p_subjects jsonb, p_students jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_year integer;
  v_import uuid := gen_random_uuid();
  r jsonb;
begin
  if not can_import_grades(p_classroom) then
    raise exception 'นำเข้าได้เฉพาะครูที่ปรึกษาของห้องนี้ งานวิชาการ หรือผู้ดูแลระบบ' using errcode = '42501';
  end if;
  select year into v_year from classrooms where id = p_classroom;
  if v_year is null then raise exception 'ไม่พบห้องเรียน' using errcode = '22023'; end if;
  drop table if exists _st, _new, _old, _na;

  create temp table _st on commit drop as
    select x.citizen_id, x.number, s.id as sid, x.results, x.assessments,
      exists (select 1 from enrollments e where e.student_id = s.id and e.year = v_year and e.classroom_id = p_classroom) as in_room
    from jsonb_to_recordset(p_students) x(citizen_id text, number integer, results jsonb, assessments jsonb)
    left join students s on s.citizen_id = x.citizen_id;

  create temp table _new on commit drop as
    select st.sid, y.code, y.term::smallint as term, y.mid, y.final, y.total, y.percent, y.grade
    from _st st, jsonb_to_recordset(st.results) y(code text, term integer, mid numeric, final numeric, total numeric, percent numeric, grade text)
    where st.sid is not null;

  create temp table _old on commit drop as
    select g.student_id as sid, sub.code, g.term, g.total, g.grade
    from grade_results g join subjects sub on sub.id = g.subject_id
    where g.year = v_year and g.student_id in (select sid from _st where sid is not null)
      and g.term in (select distinct term from _new)
      and sub.code in (select x ->> 'code' from jsonb_array_elements(p_subjects) x);

  create temp table _na on commit drop as
    select st.sid, a.term::smallint as term, a.kind, coalesce(a.items, '[]'::jsonb) as items, a.result
    from _st st, jsonb_to_recordset(st.assessments) a(term integer, kind text, items jsonb, result text)
    where st.sid is not null;

  r := jsonb_build_object(
    'year', v_year,
    'students', (select count(*) from _st),
    'matched', (select count(*) from _st where sid is not null),
    'unmatched', coalesce((select jsonb_agg(number order by number) from _st where sid is null), '[]'),
    'other_room', coalesce((select jsonb_agg(number order by number) from _st where sid is not null and not in_room), '[]'),
    'subjects_new', (select count(*) from jsonb_array_elements(p_subjects) x where not exists (select 1 from subjects s where s.code = x ->> 'code')),
    'terms', coalesce((select jsonb_agg(distinct term) from _new), '[]'),
    'added', (select count(*) from _new n where not exists (select 1 from _old o where o.sid = n.sid and o.code = n.code and o.term = n.term)),
    'changed', (select count(*) from _new n join _old o on o.sid = n.sid and o.code = n.code and o.term = n.term
                where o.grade is distinct from n.grade or o.total is distinct from n.total),
    'unchanged', (select count(*) from _new n join _old o on o.sid = n.sid and o.code = n.code and o.term = n.term
                where o.grade is not distinct from n.grade and o.total is not distinct from n.total),
    'removed', (select count(*) from _old o where not exists (select 1 from _new n where o.sid = n.sid and o.code = n.code and o.term = n.term)),
    'assessments', (select count(*) from _na));

  if p_dry_run then return r; end if;

  insert into subjects (code, name, hours_per_year, learning_area, grade)
  select x ->> 'code', x ->> 'name', (x ->> 'hours')::numeric, nullif(x ->> 'area', ''), nullif(x ->> 'grade', '')
  from jsonb_array_elements(p_subjects) x
  on conflict (code) do update set name = excluded.name,
    hours_per_year = coalesce(excluded.hours_per_year, subjects.hours_per_year),
    learning_area = coalesce(excluded.learning_area, subjects.learning_area),
    grade = coalesce(subjects.grade, excluded.grade);

  -- คะแนนที่ถูกลบออกจากไฟล์ใหม่ ลบออกจากระบบด้วย (ใช้ไฟล์ล่าสุด)
  delete from grade_results g using subjects sub, _old o
  where sub.id = g.subject_id and o.sid = g.student_id and o.code = sub.code and o.term = g.term and g.year = v_year
    and not exists (select 1 from _new n where n.sid = o.sid and n.code = o.code and n.term = o.term);

  insert into grade_results (student_id, year, term, subject_id, classroom_id, mid_score, final_score, total, percent, grade, import_id, imported_at)
  select n.sid, v_year, n.term, sub.id, p_classroom, n.mid, n.final, n.total, n.percent, n.grade, v_import, now()
  from _new n join subjects sub on sub.code = n.code
  on conflict (student_id, year, term, subject_id) do update set classroom_id = excluded.classroom_id,
    mid_score = excluded.mid_score, final_score = excluded.final_score, total = excluded.total, percent = excluded.percent,
    grade = excluded.grade, import_id = excluded.import_id, imported_at = excluded.imported_at;

  delete from student_assessments a
  where a.year = v_year and a.student_id in (select sid from _st where sid is not null)
    and not exists (select 1 from _na n where n.sid = a.student_id and n.term = a.term and n.kind = a.kind);
  insert into student_assessments (student_id, year, term, classroom_id, kind, items, result, import_id)
  select n.sid, v_year, n.term, p_classroom, n.kind, n.items, n.result, v_import from _na n
  on conflict (student_id, year, term, kind) do update set classroom_id = excluded.classroom_id, items = excluded.items,
    result = excluded.result, import_id = excluded.import_id;

  insert into grade_imports (id, classroom_id, year, term, file_name, summary, imported_by)
  values (v_import, p_classroom, v_year, p_term, p_file_name, r, my_staff_id());
  insert into audit_log (actor, actor_name, table_name, record_key, action, note)
  values (auth.uid(), current_staff_name(), 'grade_results', p_classroom::text, 'import',
    format('นำเข้า ปพ.5 %s: เพิ่ม %s แก้ไข %s ลบ %s รายการ', coalesce(p_file_name, ''), r ->> 'added', r ->> 'changed', r ->> 'removed'));
  return r;
end $$;

-- ---------------------------------------------------------------------
-- สถิติ (ใช้สิทธิ์ของผู้เรียกใช้ จึงเห็นเฉพาะห้อง/วิชาที่มีสิทธิ์)
-- ---------------------------------------------------------------------
create or replace function public.grade_distribution(p_year integer, p_term smallint)
returns table (classroom_id integer, subject_id integer, code text, name text, learning_area text, hours numeric,
  n integer, g4 integer, g35 integer, g3 integer, g25 integer, g2 integer, g15 integer, g1 integer, g0 integer,
  r integer, ms integer, pct3 numeric, avg_point numeric)
language sql stable set search_path = public as $$
  select g.classroom_id, s.id, s.code, s.name, s.learning_area, s.hours_per_year,
    count(*)::int,
    count(*) filter (where g.grade = '4')::int, count(*) filter (where g.grade = '3.5')::int,
    count(*) filter (where g.grade = '3')::int, count(*) filter (where g.grade = '2.5')::int,
    count(*) filter (where g.grade = '2')::int, count(*) filter (where g.grade = '1.5')::int,
    count(*) filter (where g.grade = '1')::int, count(*) filter (where g.grade = '0')::int,
    count(*) filter (where g.grade = 'ร')::int, count(*) filter (where g.grade = 'มส')::int,
    round(100.0 * count(*) filter (where g.grade_point >= 3) / nullif(count(*), 0), 2),
    round(avg(g.grade_point), 2)
  from grade_results g join subjects s on s.id = g.subject_id
  where g.year = p_year and g.term = p_term
  group by g.classroom_id, s.id
$$;

-- ---------------------------------------------------------------------
-- ข้อมูลสำหรับ SAR: ตัวชี้วัดที่คำนวณได้จากทุกระบบ
-- ---------------------------------------------------------------------
create or replace function public.sar_summary(p_year integer)
returns table (section text, key text, label text, value numeric, base integer, unit text, target numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_any_role(array['admin','executive','academic']) then
    raise exception 'เฉพาะผู้บริหาร งานวิชาการ และผู้ดูแลระบบ' using errcode = '42501';
  end if;
  return query
  with g as (
    -- ใช้ผลทั้งปีถ้ามี ไม่เช่นนั้นใช้ภาคเรียนล่าสุด
    select distinct on (gr.student_id, gr.subject_id) gr.student_id, gr.grade, gr.grade_point, s.learning_area
    from grade_results gr join subjects s on s.id = gr.subject_id
    where gr.year = p_year
    order by gr.student_id, gr.subject_id, (gr.term = 0) desc, gr.term desc
  ), a as (
    select distinct on (sa.student_id, sa.kind) sa.kind, sa.result
    from student_assessments sa where sa.year = p_year
    order by sa.student_id, sa.kind, (sa.term = 0) desc, sa.term desc
  ), m as (
    select distinct on (ms.student_id) ms.wfh, ms.hfa
    from measurements ms join measurement_rounds rd on rd.id = ms.round_id
    where rd.year = p_year
    order by ms.student_id, rd.start_date desc
  ), att as (
    select ad.status from attendance_daily ad join classrooms c on c.id = ad.classroom_id where c.year = p_year
  ), stu as (
    select e.student_id from enrollments e join students s on s.id = e.student_id
    where e.year = p_year and s.status = 'studying'
  ), sc as (
    select x.student_id, x.overall from screenings x where x.year = p_year
  ), rows as (
    select 'ผลสัมฤทธิ์ทางการเรียน' as section, 'grade3' as key, 'ร้อยละของผลการเรียนระดับ 3 ขึ้นไป (ทุกรายวิชา)' as label,
      round(100.0 * count(*) filter (where g.grade_point >= 3) / nullif(count(*), 0), 2) as value, count(*)::int as base, '%' as unit, 1 as ord
      from g
    union all
    select 'ผลสัมฤทธิ์ทางการเรียน', 'grade3:' || coalesce(g.learning_area, 'อื่น ๆ'), 'ระดับ 3 ขึ้นไป: ' || coalesce(g.learning_area, 'อื่น ๆ'),
      round(100.0 * count(*) filter (where g.grade_point >= 3) / nullif(count(*), 0), 2), count(*)::int, '%', 2
      from g group by g.learning_area
    union all
    select 'ผลสัมฤทธิ์ทางการเรียน', 'gpa', 'ระดับผลการเรียนเฉลี่ย (ทุกรายวิชา)', round(avg(g.grade_point), 2), count(*)::int, 'คะแนน', 3 from g
    union all
    select 'ผลสัมฤทธิ์ทางการเรียน', 'below1', 'ร้อยละของผลการเรียน 0 ร มส (ต้องแก้ไข)',
      round(100.0 * count(*) filter (where g.grade in ('0','ร','มส')) / nullif(count(*), 0), 2), count(*)::int, '%', 4 from g
    union all
    select 'คุณลักษณะและการอ่าน', 'rtw_good', 'ร้อยละนักเรียนอ่าน คิดวิเคราะห์ เขียน ระดับดีขึ้นไป',
      round(100.0 * count(*) filter (where a.result in ('ดี','ดีเยี่ยม')) / nullif(count(*), 0), 2), count(*)::int, '%', 5 from a where a.kind = 'rtw'
    union all
    select 'คุณลักษณะและการอ่าน', 'trait_good', 'ร้อยละนักเรียนมีคุณลักษณะอันพึงประสงค์ระดับดีขึ้นไป',
      round(100.0 * count(*) filter (where a.result in ('ดี','ดีเยี่ยม')) / nullif(count(*), 0), 2), count(*)::int, '%', 6 from a where a.kind = 'trait'
    union all
    select 'คุณลักษณะและการอ่าน', 'values_good', 'ร้อยละนักเรียนมีค่านิยมหลัก 12 ประการระดับดีขึ้นไป',
      round(100.0 * count(*) filter (where a.result in ('ดี','ดีเยี่ยม')) / nullif(count(*), 0), 2), count(*)::int, '%', 7 from a where a.kind = 'values'
    union all
    select 'คุณลักษณะและการอ่าน', 'competency_good', 'ร้อยละนักเรียนมีสมรรถนะสำคัญระดับดีขึ้นไป',
      round(100.0 * count(*) filter (where a.result in ('ดี','ดีเยี่ยม')) / nullif(count(*), 0), 2), count(*)::int, '%', 8 from a where a.kind = 'competency'
    union all
    select 'คุณลักษณะและการอ่าน', 'activity_pass', 'ร้อยละนักเรียนผ่านกิจกรรมพัฒนาผู้เรียน',
      round(100.0 * count(*) filter (where a.result = 'ผ่าน') / nullif(count(*), 0), 2), count(*)::int, '%', 9 from a where a.kind = 'activity'
    union all
    select 'สุขภาวะ', 'wfh_normal', 'ร้อยละนักเรียนมีน้ำหนักตามส่วนสูงสมส่วน (ครั้งล่าสุด)',
      round(100.0 * count(*) filter (where m.wfh = 3) / nullif(count(*) filter (where m.wfh is not null), 0), 2), count(*) filter (where m.wfh is not null)::int, '%', 10 from m
    union all
    select 'สุขภาวะ', 'hfa_normal', 'ร้อยละนักเรียนมีส่วนสูงตามเกณฑ์ขึ้นไป (ครั้งล่าสุด)',
      round(100.0 * count(*) filter (where m.hfa >= 3) / nullif(count(*) filter (where m.hfa is not null), 0), 2), count(*) filter (where m.hfa is not null)::int, '%', 11 from m
    union all
    select 'การมาเรียน', 'attendance', 'ร้อยละการมาเรียน (มา + สาย จากวันที่บันทึก)',
      round(100.0 * count(*) filter (where att.status <= 1) / nullif(count(*), 0), 2), count(*)::int, '%', 12 from att
    union all
    select 'การดูแลช่วยเหลือ', 'screened', 'ร้อยละนักเรียนที่ได้รับการคัดกรอง',
      round(100.0 * count(sc.student_id) / nullif(count(*), 0), 2), count(*)::int, '%', 13 from stu left join sc on sc.student_id = stu.student_id
    union all
    select 'การดูแลช่วยเหลือ', 'visited', 'ร้อยละนักเรียนที่ได้รับการเยี่ยมบ้าน',
      round(100.0 * count(*) filter (where exists (select 1 from home_visits h where h.student_id = stu.student_id and h.year = p_year)) / nullif(count(*), 0), 2),
      count(*)::int, '%', 14 from stu
    union all
    select 'การดูแลช่วยเหลือ', 'helped', 'ร้อยละนักเรียนกลุ่มเสี่ยง/มีปัญหาที่ได้รับการช่วยเหลือ',
      round(100.0 * count(*) filter (where exists (select 1 from interventions i where i.student_id = sc.student_id and i.year = p_year)) / nullif(count(*), 0), 2),
      count(*)::int, '%', 15 from sc where sc.overall >= 2
  )
  select rows.section, rows.key, rows.label, rows.value, rows.base, rows.unit, t.target
  from rows left join sar_targets t on t.year = p_year and t.key = rows.key
  order by rows.ord, rows.label;
end $$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.grade_results enable row level security;
alter table public.student_assessments enable row level security;
alter table public.grade_imports enable row level security;
alter table public.national_tests enable row level security;
alter table public.sar_targets enable row level security;

drop policy if exists grade_results_read on public.grade_results;
create policy grade_results_read on public.grade_results for select to authenticated using (public.can_view_grades(classroom_id, subject_id));
drop policy if exists student_assessments_read on public.student_assessments;
create policy student_assessments_read on public.student_assessments for select to authenticated using (public.can_view_grades(classroom_id, null));
drop policy if exists grade_imports_read on public.grade_imports;
create policy grade_imports_read on public.grade_imports for select to authenticated using (public.can_view_grades(classroom_id, null));

drop policy if exists national_tests_read on public.national_tests;
create policy national_tests_read on public.national_tests for select to authenticated using (true);
drop policy if exists national_tests_write on public.national_tests;
create policy national_tests_write on public.national_tests for all to authenticated
  using (public.has_any_role(array['admin','academic'])) with check (public.has_any_role(array['admin','academic']));
drop policy if exists sar_targets_read on public.sar_targets;
create policy sar_targets_read on public.sar_targets for select to authenticated using (true);
drop policy if exists sar_targets_write on public.sar_targets;
create policy sar_targets_write on public.sar_targets for all to authenticated
  using (public.has_any_role(array['admin','academic'])) with check (public.has_any_role(array['admin','academic']));

do $$
declare t text;
begin
  foreach t in array array['national_tests', 'sar_targets'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_trigger()', t || '_audit', t);
  end loop;
end $$;

grant select on public.grade_results, public.student_assessments, public.grade_imports to authenticated, service_role;
grant select, insert, update, delete on public.national_tests, public.sar_targets to authenticated, service_role;
grant usage on sequence public.national_tests_id_seq to authenticated, service_role;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
