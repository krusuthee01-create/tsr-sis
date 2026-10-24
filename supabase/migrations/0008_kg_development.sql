-- =====================================================================
-- เฟส 3B: พัฒนาการเด็กปฐมวัย (นำเข้าจากสมุดบันทึกพัฒนาการ) — ไฟล์นี้รันซ้ำได้
-- =====================================================================

create table if not exists public.kg_development (
  student_id uuid not null references public.students(id) on delete cascade,
  year integer not null references public.academic_years(year),
  term smallint not null check (term in (0, 1, 2)),          -- 0 = สรุปทั้งปี (เฉลี่ย 2 ภาค)
  classroom_id integer not null references public.classrooms(id),
  scores smallint[],                                         -- คะแนน 33 ตัวบ่งชี้ (1–3) ของภาคเรียนนั้น
  levels jsonb not null default '{}',                        -- {"physical":3,"emotional":2,"civic":3,"intellectual":2}
  import_id uuid,
  imported_at timestamptz not null default now(),
  primary key (student_id, year, term)
);
create index if not exists kg_development_class_idx on public.kg_development (classroom_id, year, term);

-- ระดับรายด้านจากคะแนนตัวบ่งชี้ (สูตรเดียวกับสมุดบันทึก: เฉลี่ย < 1.5 = 1, < 2.5 = 2, อื่น ๆ = 3)
create or replace function public.kg_levels(p_scores smallint[]) returns jsonb
language sql immutable set search_path = public as $$
  select coalesce(jsonb_object_agg(d.key, (select case when avg(v) is null then null when avg(v) < 1.5 then 1 when avg(v) < 2.5 then 2 else 3 end
      from unnest(p_scores[d.lo:d.hi]) v)), '{}')
  from (values ('physical', 1, 4), ('emotional', 5, 12), ('civic', 13, 18), ('intellectual', 19, 33)) d(key, lo, hi)
$$;

-- นำเข้าสมุดบันทึกพัฒนาการของห้อง: จับคู่ด้วยชื่อ-สกุล (ไม่สนใจคำนำหน้าและช่องว่าง) ไม่พบจึงใช้เลขที่
-- p_rows: [{number, name, t1:[33], t2:[33]}]
create or replace function public.import_kg(p_classroom integer, p_file_name text, p_rows jsonb, p_dry_run boolean default true)
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
  drop table if exists _kr, _knew;

  create temp table _kr on commit drop as
    with x as (
      select y.number, y.name, y.t1, y.t2,
        regexp_replace(regexp_replace(y.name, '^\s*(เด็กชาย|เด็กหญิง|ด\.ช\.|ด\.ญ\.|นาย|นางสาว)\s*', ''), '\s', '', 'g') as key
      from jsonb_to_recordset(p_rows) y(number integer, name text, t1 jsonb, t2 jsonb)
    ), roster as (
      select e.student_id, e.number, regexp_replace(s.first_name || s.last_name, '\s', '', 'g') as key
      from enrollments e join students s on s.id = e.student_id where e.classroom_id = p_classroom
    )
    select x.number, x.name, x.t1, x.t2,
      coalesce((select ro.student_id from roster ro where ro.key = x.key limit 1),
               (select ro.student_id from roster ro where ro.number = x.number limit 1)) as sid,
      not exists (select 1 from roster ro where ro.key = x.key) as by_number
    from x;

  create temp table _knew on commit drop as
    select k.sid, t.term::smallint as term,
      array(select nullif(v, 'null')::smallint from jsonb_array_elements_text(t.arr) with ordinality a(v, i) order by i) as scores
    from _kr k, lateral (values (1, k.t1), (2, k.t2)) t(term, arr)
    where k.sid is not null and exists (select 1 from jsonb_array_elements(t.arr) v where v <> 'null'::jsonb);

  r := jsonb_build_object(
    'year', v_year,
    'students', (select count(*) from _kr),
    'matched', (select count(*) from _kr where sid is not null),
    'unmatched', coalesce((select jsonb_agg(coalesce(number::text, name) order by number) from _kr where sid is null), '[]'),
    'by_number', coalesce((select jsonb_agg(number order by number) from _kr where sid is not null and by_number), '[]'),
    'terms', coalesce((select jsonb_agg(distinct term) from _knew), '[]'),
    'added', (select count(*) from _knew n where not exists (select 1 from kg_development d where d.student_id = n.sid and d.year = v_year and d.term = n.term)),
    'changed', (select count(*) from _knew n join kg_development d on d.student_id = n.sid and d.year = v_year and d.term = n.term where d.scores is distinct from n.scores),
    'unchanged', (select count(*) from _knew n join kg_development d on d.student_id = n.sid and d.year = v_year and d.term = n.term where d.scores is not distinct from n.scores));

  if p_dry_run then return r; end if;

  insert into kg_development (student_id, year, term, classroom_id, scores, levels, import_id, imported_at)
  select n.sid, v_year, n.term, p_classroom, n.scores, kg_levels(n.scores), v_import, now() from _knew n
  on conflict (student_id, year, term) do update set classroom_id = excluded.classroom_id, scores = excluded.scores,
    levels = excluded.levels, import_id = excluded.import_id, imported_at = excluded.imported_at;
  -- ทั้งปี: เมื่อมีภาคเรียนที่ 2 ใช้ค่าเฉลี่ยของทั้ง 2 ภาค
  insert into kg_development (student_id, year, term, classroom_id, scores, levels, import_id, imported_at)
  select t2.student_id, v_year, 0, p_classroom, null, kg_levels2(t1.scores, t2.scores), v_import, now()
  from kg_development t2 left join kg_development t1 on t1.student_id = t2.student_id and t1.year = v_year and t1.term = 1
  where t2.year = v_year and t2.term = 2 and t2.student_id in (select sid from _knew)
  on conflict (student_id, year, term) do update set classroom_id = excluded.classroom_id, levels = excluded.levels,
    import_id = excluded.import_id, imported_at = excluded.imported_at;

  insert into grade_imports (id, classroom_id, year, term, file_name, summary, imported_by)
  values (v_import, p_classroom, v_year, null, p_file_name, r, my_staff_id());
  insert into audit_log (actor, actor_name, table_name, record_key, action, note)
  values (auth.uid(), current_staff_name(), 'kg_development', p_classroom::text, 'import',
    format('นำเข้าสมุดบันทึกพัฒนาการ %s: เพิ่ม %s แก้ไข %s รายการ', coalesce(p_file_name, ''), r ->> 'added', r ->> 'changed'));
  return r;
end $$;

-- ระดับทั้งปี: เฉลี่ยคะแนนของทั้ง 2 ภาคเรียนในแต่ละด้าน
create or replace function public.kg_levels2(p_t1 smallint[], p_t2 smallint[]) returns jsonb
language sql immutable set search_path = public as $$
  select coalesce(jsonb_object_agg(d.key, (select case when avg(v) is null then null when avg(v) < 1.5 then 1 when avg(v) < 2.5 then 2 else 3 end
      from (select unnest((coalesce(p_t1, '{}'))[d.lo:d.hi]) union all select unnest(p_t2[d.lo:d.hi])) u(v))), '{}')
  from (values ('physical', 1, 4), ('emotional', 5, 12), ('civic', 13, 18), ('intellectual', 19, 33)) d(key, lo, hi)
$$;

-- ข้อมูล SAR: เพิ่มตัวชี้วัดพัฒนาการเด็กปฐมวัย
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
  ), kg as (
    select distinct on (k.student_id) k.levels
    from kg_development k where k.year = p_year
    order by k.student_id, (k.term = 0) desc, k.term desc
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
    union all
    select 'พัฒนาการเด็กปฐมวัย', 'kg_' || d.key, 'ร้อยละเด็กมีพัฒนาการ' || d.label || 'ระดับดี',
      round(100.0 * count(*) filter (where (kg.levels ->> d.key)::int = 3) / nullif(count(*) filter (where kg.levels ? d.key and kg.levels ->> d.key is not null), 0), 2),
      count(*) filter (where kg.levels ->> d.key is not null)::int, '%', 16 + d.ord
      from (values ('physical', 'ด้านสุขภาวะทางกาย', 1), ('emotional', 'ด้านอารมณ์ จิตใจ และสังคม', 2),
                   ('civic', 'ด้านความเป็นพลเมืองและความเป็นไทย', 3), ('intellectual', 'ด้านสติปัญญา', 4)) d(key, label, ord)
      cross join kg
      group by d.key, d.label, d.ord
  )
  select rows.section, rows.key, rows.label, rows.value, rows.base, rows.unit, t.target
  from rows left join sar_targets t on t.year = p_year and t.key = rows.key
  order by rows.ord, rows.label;
end $$;

alter table public.kg_development enable row level security;
drop policy if exists kg_development_read on public.kg_development;
create policy kg_development_read on public.kg_development for select to authenticated using (public.can_view_grades(classroom_id, null));
grant select on public.kg_development to authenticated, service_role;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
