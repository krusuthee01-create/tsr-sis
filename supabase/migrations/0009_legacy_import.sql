-- =====================================================================
-- นำเข้าข้อมูลจากระบบเช็กชื่อเดิม (Google Sheets) — ไฟล์นี้รันซ้ำได้
-- ข้อมูลที่บันทึกในระบบใหม่แล้วจะไม่ถูกเขียนทับ
-- =====================================================================

alter table public.attendance_daily add column if not exists note text;

-- จับคู่เลขประจำตัวนักเรียนในไฟล์เดิมกับนักเรียนที่ลงทะเบียนในปีการศึกษานั้น
create or replace function public.legacy_match(p_year integer, p_codes text[])
returns table (code text, student_id uuid, classroom_id integer, grade text, room smallint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_any_role(array['admin']) then
    raise exception 'เฉพาะผู้ดูแลระบบ' using errcode = '42501';
  end if;
  return query
    select distinct on (c.code) c.code, s.id, e.classroom_id, cl.grade, cl.room
    from unnest(p_codes) c(code)
    join students s on ltrim(s.student_code, '0') = ltrim(c.code, '0') and s.student_code is not null
    join enrollments e on e.student_id = s.id and e.year = p_year
    join classrooms cl on cl.id = e.classroom_id
    order by c.code;
end $$;

-- เช็กชื่อ + ดื่มนม + แปรงฟัน: p_rows [{s, c, d, a, n, m, b}]
create or replace function public.import_legacy_attendance(p_year integer, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_att integer; v_health integer; v_total integer;
begin
  if not has_any_role(array['admin']) then
    raise exception 'เฉพาะผู้ดูแลระบบ' using errcode = '42501';
  end if;
  drop table if exists _lg;
  create temp table _lg on commit drop as
    select x.s, x.c, x.d, x.a::smallint as a, x.n, x.m, x.b
    from jsonb_to_recordset(p_rows) x(s uuid, c integer, d date, a integer, n text, m boolean, b boolean)
    join classrooms cl on cl.id = x.c and cl.year = p_year
    where x.d <= today_th();
  v_total := (select count(*) from _lg);

  insert into attendance_daily (student_id, date, classroom_id, status, note)
  select s, d, c, a, n from _lg
  on conflict (student_id, date) do nothing;
  get diagnostics v_att = row_count;

  insert into health_daily (student_id, date, kind, classroom_id, done)
  select s, d, k.kind, c, k.done from _lg, lateral (values ('milk', m), ('brush', b)) k(kind, done)
  where k.done is not null and a <= 1  -- นม/แปรงฟัน นับเฉพาะวันที่มาเรียน
  on conflict (student_id, date, kind) do nothing;
  get diagnostics v_health = row_count;

  insert into audit_log (actor, actor_name, table_name, record_key, action, note)
  values (auth.uid(), current_staff_name(), 'attendance_daily', p_year::text, 'import',
    format('นำเข้าเช็กชื่อจากระบบเดิม %s รายการ (ใหม่ %s, ดื่มนม/แปรงฟัน %s)', v_total, v_att, v_health));
  return jsonb_build_object('rows', v_total, 'attendance', v_att, 'health', v_health, 'skipped', v_total - v_att);
end $$;

-- น้ำหนัก ส่วนสูง: สร้างรอบรายเดือนถ้ายังไม่มี แล้วแปลผลตามเกณฑ์ปัจจุบัน
-- p_rows [{s, c, round, start, end, d, w, h}]
create or replace function public.import_legacy_measurements(p_year integer, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_rounds integer; v_count integer := 0; e record; g record;
begin
  if not has_any_role(array['admin']) then
    raise exception 'เฉพาะผู้ดูแลระบบ' using errcode = '42501';
  end if;
  insert into measurement_rounds (year, name, start_date, end_date)
  select distinct p_year, x.round, x.start, x."end"
  from jsonb_to_recordset(p_rows) x(round text, start date, "end" date)
  on conflict (year, name) do nothing;
  get diagnostics v_rounds = row_count;

  for e in
    select x.s, x.c, x.d, x.w, x.h, r.id as round_id, st.gender, st.birth_date
    from jsonb_to_recordset(p_rows) x(s uuid, c integer, round text, d date, w numeric, h numeric)
    join measurement_rounds r on r.year = p_year and r.name = x.round
    join students st on st.id = x.s
    join classrooms cl on cl.id = x.c and cl.year = p_year
    where x.w between 5 and 150 and x.h between 50 and 210 and x.d <= today_th()
      and not exists (select 1 from measurements m where m.student_id = x.s and m.round_id = r.id)
  loop
    select * into g from classify_growth(case e.gender when 'ช' then 1 when 'ญ' then 2 end::smallint,
      age_in_months(e.birth_date, e.d), e.w, e.h);
    insert into measurements (student_id, round_id, classroom_id, measured_on, weight, height, age_months, wfa, hfa, wfh)
    values (e.s, e.round_id, e.c, e.d, e.w, e.h, age_in_months(e.birth_date, e.d), g.wfa, g.hfa, g.wfh)
    on conflict (student_id, round_id) do nothing;
    v_count := v_count + 1;
  end loop;

  insert into audit_log (actor, actor_name, table_name, record_key, action, note)
  values (auth.uid(), current_staff_name(), 'measurements', p_year::text, 'import',
    format('นำเข้าน้ำหนักส่วนสูงจากระบบเดิม %s รายการ (สร้างรอบใหม่ %s รอบ)', v_count, v_rounds));
  return jsonb_build_object('measurements', v_count, 'rounds', v_rounds);
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
