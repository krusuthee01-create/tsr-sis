-- =====================================================================
-- TSR-SIS เฟส 1 : ฟังก์ชันช่วย, ประวัติการแก้ไข, สิทธิ์ (RLS), RPC
-- =====================================================================

-- ---------------------------------------------------------------------
-- ฟังก์ชันช่วยเรื่องเวลาและสิทธิ์
-- ---------------------------------------------------------------------
create or replace function public.today_th() returns date
language sql stable as $$ select (now() at time zone 'Asia/Bangkok')::date $$;

create or replace function public.my_staff_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from staff where user_id = auth.uid() and approved and active
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where user_id = auth.uid() and approved and active)
$$;

create or replace function public.has_role(r text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from staff where user_id = auth.uid() and approved and active and r = any(roles)
  )
$$;

create or replace function public.has_any_role(rs text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from staff where user_id = auth.uid() and approved and active and roles && rs
  )
$$;

-- ครูที่ปรึกษา (kind = homeroom) หรือครูพี่เลี้ยง (assistant) ของห้อง
create or replace function public.is_homeroom_of(p_classroom integer, p_include_assistant boolean default true)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from homeroom_assignments h
    where h.classroom_id = p_classroom
      and h.staff_id = my_staff_id()
      and (p_include_assistant or h.kind = 'homeroom')
  )
$$;

create or replace function public.teaches_classroom(p_classroom integer) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from teaching_assignments t
    where t.classroom_id = p_classroom and t.staff_id = my_staff_id()
  )
$$;

-- เห็นรายชื่อและการมาเรียนของห้อง
create or replace function public.can_view_classroom(p_classroom integer) returns boolean
language sql stable security definer set search_path = public as $$
  select has_any_role(array['admin','executive','guidance','health'])
      or is_homeroom_of(p_classroom)
      or teaches_classroom(p_classroom)
$$;

-- เห็นข้อมูลส่วนตัวเต็มของนักเรียน (ผู้ปกครอง ที่อยู่ ข้อมูลจาก DMC)
create or replace function public.can_view_student_full(p_student uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select has_any_role(array['admin','executive','guidance'])
      or exists (
        select 1 from enrollments e
        join homeroom_assignments h on h.classroom_id = e.classroom_id and h.kind = 'homeroom'
        where e.student_id = p_student and h.staff_id = my_staff_id()
      )
$$;

create or replace function public.current_staff_name() returns text
language sql stable security definer set search_path = public as $$
  select concat_ws(' ', prefix, first_name, last_name) from staff where user_id = auth.uid()
$$;

-- ---------------------------------------------------------------------
-- วันเรียน
-- ---------------------------------------------------------------------
create or replace function public.is_school_day(p_date date) returns boolean
language sql stable security definer set search_path = public as $$
  select extract(isodow from p_date) < 6
     and not exists (select 1 from holidays where date = p_date)
     and exists (select 1 from terms where p_date between start_date and end_date)
$$;

create or replace function public.school_days(p_from date, p_to date) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer
  from generate_series(p_from, p_to, interval '1 day') d
  where is_school_day(d::date)
$$;

create or replace function public.assert_can_record(p_classroom integer, p_date date)
returns void
language plpgsql stable security definer set search_path = public as $$
declare
  v_window smallint;
  v_year integer;
begin
  if my_staff_id() is null then
    raise exception 'บัญชีนี้ยังไม่ได้รับอนุมัติให้ใช้งาน' using errcode = '42501';
  end if;
  select year into v_year from classrooms where id = p_classroom;
  if v_year is null then
    raise exception 'ไม่พบห้องเรียนนี้' using errcode = 'P0002';
  end if;
  if not exists (select 1 from terms where year = v_year and p_date between start_date and end_date) then
    raise exception 'วันที่ % ไม่อยู่ในภาคเรียนของปีการศึกษา % (ตรวจสอบที่หน้า ตั้งค่า › ปฏิทิน)', p_date, v_year
      using errcode = '22023';
  end if;
  if extract(isodow from p_date) >= 6 then
    raise exception 'วันที่ % เป็นวันเสาร์-อาทิตย์ ไม่ต้องบันทึก', p_date using errcode = '22023';
  end if;
  if exists (select 1 from holidays where date = p_date) then
    raise exception 'วันที่ % เป็นวันหยุดของโรงเรียน ไม่ต้องบันทึก', p_date using errcode = '22023';
  end if;
  if p_date > today_th() then
    raise exception 'บันทึกล่วงหน้าไม่ได้' using errcode = '22023';
  end if;
  if not has_role('admin') then
    select edit_window_days into v_window from school_settings where id = 1;
    if p_date < today_th() - v_window then
      raise exception 'แก้ไขย้อนหลังได้ไม่เกิน % วัน กรุณาติดต่อผู้ดูแลระบบ', v_window using errcode = '42501';
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- ประวัติการแก้ไข (trigger กลาง)
-- ---------------------------------------------------------------------
create or replace function public.audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_ignore text[] := array['updated_at', 'dmc_raw', 'dmc_imported_at', 'last_seen_at', 'recorded_at'];
  v_key text;
  v_diff_old jsonb := '{}';
  v_diff_new jsonb := '{}';
  v_row jsonb := coalesce(v_new, v_old);
begin
  if tg_op = 'UPDATE' then
    for v_key in select jsonb_object_keys(v_new) loop
      if not (v_key = any(v_ignore)) and (v_old -> v_key) is distinct from (v_new -> v_key) then
        v_diff_old := v_diff_old || jsonb_build_object(v_key, v_old -> v_key);
        v_diff_new := v_diff_new || jsonb_build_object(v_key, v_new -> v_key);
      end if;
    end loop;
    if v_diff_new = '{}' then
      return new;
    end if;
    v_old := v_diff_old;
    v_new := v_diff_new;
  else
    v_old := v_old - v_ignore;
    v_new := v_new - v_ignore;
  end if;

  insert into audit_log (actor, actor_name, table_name, record_key, action, old_data, new_data)
  values (
    auth.uid(),
    current_staff_name(),
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'student_id', v_row ->> 'year', v_row ->> 'date', v_row ->> 'no'),
    lower(tg_op),
    v_old,
    v_new
  );
  return coalesce(new, old);
end $$;

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'school_settings','academic_years','terms','holidays','periods','classrooms','subjects',
    'staff','homeroom_assignments','teaching_assignments','students','enrollments'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_trigger()',
      t || '_audit', t);
  end loop;
  foreach t in array array['school_settings','staff','students'] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.touch_updated_at()',
      t || '_touch', t);
  end loop;
end $$;

-- ครูที่ปรึกษาไม่เกิน 2 คนต่อห้อง (ครูพี่เลี้ยงไม่นับ)
create or replace function public.check_homeroom_limit() returns trigger
language plpgsql as $$
begin
  if new.kind = 'homeroom' and (
    select count(*) from homeroom_assignments
    where classroom_id = new.classroom_id and kind = 'homeroom' and id <> coalesce(new.id, -1)
  ) >= 2 then
    raise exception 'ห้องนี้มีครูที่ปรึกษาครบ 2 คนแล้ว' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger homeroom_limit before insert or update on public.homeroom_assignments
  for each row execute function public.check_homeroom_limit();

-- ---------------------------------------------------------------------
-- เชื่อมบัญชีผู้ใช้ (auth.users) กับทะเบียนครู
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_staff uuid;
  v_name text := coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1));
begin
  -- บัญชีชื่อผู้ใช้ที่ผู้ดูแลระบบสร้าง: app_metadata.staff_id (ตั้งได้เฉพาะ service role)
  v_staff := nullif(new.raw_app_meta_data ->> 'staff_id', '')::uuid;
  if v_staff is not null then
    update staff set user_id = new.id where id = v_staff and user_id is null;
    return new;
  end if;

  -- บัญชี Google: จับคู่กับอีเมลที่ผู้ดูแลระบบลงทะเบียนไว้ล่วงหน้า
  update staff set user_id = new.id
  where lower(email) = lower(new.email) and user_id is null
  returning id into v_staff;

  if v_staff is null then
    insert into staff (user_id, first_name, last_name, email, approved)
    values (new.id, split_part(v_name, ' ', 1), coalesce(nullif(substr(v_name, length(split_part(v_name, ' ', 1)) + 2), ''), ''), new.email, false)
    on conflict (email) do nothing;
  end if;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ผู้ใช้คนแรกของระบบตั้งตัวเองเป็นผู้ดูแลระบบได้ (ใช้ครั้งเดียวตอนติดตั้ง)
create or replace function public.claim_first_admin() returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from staff where 'admin' = any(roles)) then
    return false;
  end if;
  update staff set roles = array_append(roles, 'admin'), approved = true, active = true
  where user_id = auth.uid();
  return found;
end $$;

-- ข้อมูลของฉัน (ใช้ทุกหน้า)
create or replace function public.my_profile() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', s.id, 'prefix', s.prefix, 'first_name', s.first_name, 'last_name', s.last_name,
    'roles', s.roles, 'approved', s.approved, 'active', s.active,
    'font_scale', s.font_scale, 'tour_done', s.tour_done, 'email', s.email,
    'has_admin', exists (select 1 from staff a where 'admin' = any(a.roles)),
    'homerooms', coalesce((
      select jsonb_agg(jsonb_build_object('classroom_id', c.id, 'grade', c.grade, 'room', c.room, 'year', c.year, 'kind', h.kind)
                       order by g.sort, c.room)
      from homeroom_assignments h
      join classrooms c on c.id = h.classroom_id
      join grade_levels g on g.code = c.grade
      where h.staff_id = s.id and c.year = (select current_year from school_settings where id = 1)
    ), '[]'::jsonb)
  )
  from staff s where s.user_id = auth.uid()
$$;

create or replace function public.update_my_prefs(p_font_scale numeric default null, p_tour_done boolean default null)
returns void
language sql security definer set search_path = public as $$
  update staff set
    font_scale = coalesce(p_font_scale, font_scale),
    tour_done = coalesce(p_tour_done, tour_done),
    last_seen_at = now()
  where user_id = auth.uid()
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.school_settings enable row level security;
alter table public.academic_years enable row level security;
alter table public.terms enable row level security;
alter table public.holidays enable row level security;
alter table public.periods enable row level security;
alter table public.grade_levels enable row level security;
alter table public.classrooms enable row level security;
alter table public.subjects enable row level security;
alter table public.staff enable row level security;
alter table public.homeroom_assignments enable row level security;
alter table public.teaching_assignments enable row level security;
alter table public.students enable row level security;
alter table public.enrollments enable row level security;
alter table public.student_status_history enable row level security;
alter table public.attendance_daily enable row level security;
alter table public.health_daily enable row level security;
alter table public.attendance_subject enable row level security;
alter table public.record_sessions enable row level security;
alter table public.audit_log enable row level security;

-- ข้อมูลอ้างอิง: บุคลากรที่อนุมัติแล้วอ่านได้ ผู้ดูแลระบบแก้ได้
do $$
declare t text;
begin
  foreach t in array array[
    'school_settings','academic_years','terms','holidays','periods','grade_levels','classrooms',
    'subjects','homeroom_assignments','teaching_assignments','enrollments','record_sessions'
  ] loop
    execute format('create policy %I on public.%I for select to authenticated using ((select public.is_staff()))', t || '_read', t);
  end loop;
  foreach t in array array[
    'school_settings','academic_years','terms','holidays','periods','classrooms',
    'subjects','homeroom_assignments','teaching_assignments','enrollments'
  ] loop
    execute format('create policy %I on public.%I for all to authenticated using ((select public.has_role(''admin''))) with check ((select public.has_role(''admin'')))', t || '_admin', t);
  end loop;
end $$;

-- ทะเบียนครู: ทุกคนเห็นรายชื่อ (ต้องใช้แสดงชื่อครูที่ปรึกษา) และเห็นแถวของตัวเองแม้ยังไม่อนุมัติ
create policy staff_read on public.staff for select to authenticated
  using ((select public.is_staff()) or user_id = auth.uid());
create policy staff_admin on public.staff for all to authenticated
  using ((select public.has_role('admin'))) with check ((select public.has_role('admin')));

-- นักเรียน: ข้อมูลเต็มเฉพาะผู้มีสิทธิ์ (ครูประจำวิชาใช้ฟังก์ชัน roster แทน)
create policy students_read on public.students for select to authenticated
  using (public.can_view_student_full(id));
create policy students_admin on public.students for all to authenticated
  using ((select public.has_role('admin'))) with check ((select public.has_role('admin')));

create policy status_history_read on public.student_status_history for select to authenticated
  using (public.can_view_student_full(student_id));

-- การมาเรียน: อ่านตามห้องที่เกี่ยวข้อง เขียนผ่าน RPC เท่านั้น
create policy attendance_daily_read on public.attendance_daily for select to authenticated
  using (public.can_view_classroom(classroom_id));
create policy health_daily_read on public.health_daily for select to authenticated
  using (public.can_view_classroom(classroom_id));
create policy attendance_subject_read on public.attendance_subject for select to authenticated
  using (public.can_view_classroom(classroom_id));

create policy audit_read on public.audit_log for select to authenticated
  using ((select public.has_any_role(array['admin','executive'])));

-- ---------------------------------------------------------------------
-- รายชื่อนักเรียนในห้อง (ข้อมูลพื้นฐาน ไม่มีข้อมูลอ่อนไหว)
-- ---------------------------------------------------------------------
create or replace function public.roster(p_classroom integer, p_only_active boolean default true)
returns table (
  student_id uuid, number smallint, prefix text, first_name text, last_name text,
  nickname text, gender text, student_code text, status text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not can_view_classroom(p_classroom) then
    raise exception 'ไม่มีสิทธิ์ดูรายชื่อห้องนี้' using errcode = '42501';
  end if;
  return query
    select s.id, e.number, s.prefix, s.first_name, s.last_name, s.nickname, s.gender, s.student_code, s.status
    from enrollments e join students s on s.id = e.student_id
    where e.classroom_id = p_classroom
      and (not p_only_active or s.status = 'studying')
    order by e.number nulls last, s.gender, s.first_name;
end $$;

-- ---------------------------------------------------------------------
-- บันทึกเช็กชื่อเข้าแถว / ดื่มนม / แปรงฟัน (ทั้งห้องในครั้งเดียว)
-- p_entries = [{"s": "<student uuid>", "v": 0..4 | true/false}]
-- ---------------------------------------------------------------------
create or replace function public.save_daily(p_classroom integer, p_date date, p_kind text, p_entries jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_staff uuid := my_staff_id();
  v_changes jsonb;
  v_count integer;
begin
  if p_kind not in ('line', 'milk', 'brush') then
    raise exception 'ประเภทการบันทึกไม่ถูกต้อง' using errcode = '22023';
  end if;
  perform assert_can_record(p_classroom, p_date);
  if not (has_role('admin') or is_homeroom_of(p_classroom)) then
    raise exception 'บันทึกได้เฉพาะครูที่ปรึกษาหรือครูพี่เลี้ยงของห้องนี้' using errcode = '42501';
  end if;

  if p_kind = 'line' then
    with e as (
      select x.s, x.v::smallint as v
      from jsonb_to_recordset(p_entries) as x(s uuid, v integer)
      join enrollments en on en.student_id = x.s and en.classroom_id = p_classroom
      where x.v between 0 and 4
    )
    select coalesce(jsonb_agg(jsonb_build_object('s', e.s, 'from', a.status, 'to', e.v)), '[]'::jsonb), count(*)
      into v_changes, v_count
    from e left join attendance_daily a on a.student_id = e.s and a.date = p_date
    where a.status is distinct from e.v;

    insert into attendance_daily (student_id, date, classroom_id, status, recorded_by)
    select x.s, p_date, p_classroom, x.v::smallint, v_staff
    from jsonb_to_recordset(p_entries) as x(s uuid, v integer)
    join enrollments en on en.student_id = x.s and en.classroom_id = p_classroom
    where x.v between 0 and 4
    on conflict (student_id, date) do update
      set status = excluded.status, classroom_id = excluded.classroom_id,
          recorded_by = excluded.recorded_by, recorded_at = now()
      where attendance_daily.status <> excluded.status;

    -- นักเรียนที่ลาหรือขาด ต้องไม่มีบันทึกดื่มนม/แปรงฟันของวันนั้น
    delete from health_daily h
    using attendance_daily a
    where a.student_id = h.student_id and a.date = h.date
      and h.date = p_date and h.classroom_id = p_classroom and a.status >= 2;
  else
    with e as (
      select x.s, x.v
      from jsonb_to_recordset(p_entries) as x(s uuid, v boolean)
      join enrollments en on en.student_id = x.s and en.classroom_id = p_classroom
      where not exists (select 1 from attendance_daily a where a.student_id = x.s and a.date = p_date and a.status >= 2)
    )
    select coalesce(jsonb_agg(jsonb_build_object('s', e.s, 'from', h.done, 'to', e.v)), '[]'::jsonb), count(*)
      into v_changes, v_count
    from e left join health_daily h on h.student_id = e.s and h.date = p_date and h.kind = p_kind
    where h.done is distinct from e.v;

    insert into health_daily (student_id, date, kind, classroom_id, done, recorded_by)
    select x.s, p_date, p_kind, p_classroom, x.v, v_staff
    from jsonb_to_recordset(p_entries) as x(s uuid, v boolean)
    join enrollments en on en.student_id = x.s and en.classroom_id = p_classroom
    where not exists (select 1 from attendance_daily a where a.student_id = x.s and a.date = p_date and a.status >= 2)
    on conflict (student_id, date, kind) do update
      set done = excluded.done, recorded_by = excluded.recorded_by, recorded_at = now()
      where health_daily.done <> excluded.done;
  end if;

  insert into record_sessions (classroom_id, date, kind, saved_by)
  values (p_classroom, p_date, p_kind, v_staff)
  on conflict (classroom_id, date, kind) do update set saved_by = excluded.saved_by, saved_at = now();

  if v_count > 0 then
    insert into audit_log (actor, actor_name, table_name, record_key, action, new_data, note)
    values (auth.uid(), current_staff_name(),
            case p_kind when 'line' then 'attendance_daily' else 'health_daily' end,
            p_classroom || ':' || p_date, 'save', v_changes,
            p_kind || ' ' || v_count || ' รายการ');
  end if;

  update staff set last_seen_at = now() where id = v_staff;
  return jsonb_build_object('saved_at', now(), 'changed', v_count);
end $$;

-- ---------------------------------------------------------------------
-- เช็กชื่อประจำวิชา (ป.1-6)
-- ---------------------------------------------------------------------
create or replace function public.save_subject_attendance(
  p_classroom integer, p_date date, p_period smallint, p_subject integer, p_entries jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_staff uuid := my_staff_id();
  v_count integer;
  v_changes jsonb;
begin
  perform assert_can_record(p_classroom, p_date);
  if exists (select 1 from classrooms c join grade_levels g on g.code = c.grade where c.id = p_classroom and g.is_kindergarten) then
    raise exception 'ระดับอนุบาลไม่มีการเช็กชื่อรายวิชา' using errcode = '22023';
  end if;
  if not (has_role('admin') or is_homeroom_of(p_classroom) or exists (
    select 1 from teaching_assignments t join terms tm on tm.id = t.term_id
    where t.classroom_id = p_classroom and t.subject_id = p_subject and t.staff_id = v_staff
      and p_date between tm.start_date and tm.end_date
  )) then
    raise exception 'บันทึกได้เฉพาะครูที่สอนวิชานี้ในห้องนี้' using errcode = '42501';
  end if;

  with e as (
    select x.s, x.v::smallint as v
    from jsonb_to_recordset(p_entries) as x(s uuid, v integer)
    join enrollments en on en.student_id = x.s and en.classroom_id = p_classroom
    where x.v between 0 and 4
  )
  select coalesce(jsonb_agg(jsonb_build_object('s', e.s, 'from', a.status, 'to', e.v)), '[]'::jsonb), count(*)
    into v_changes, v_count
  from e left join attendance_subject a on a.student_id = e.s and a.date = p_date and a.period = p_period
  where a.status is distinct from e.v or a.subject_id is distinct from p_subject;

  insert into attendance_subject (student_id, date, period, subject_id, classroom_id, status, recorded_by)
  select x.s, p_date, p_period, p_subject, p_classroom, x.v::smallint, v_staff
  from jsonb_to_recordset(p_entries) as x(s uuid, v integer)
  join enrollments en on en.student_id = x.s and en.classroom_id = p_classroom
  where x.v between 0 and 4
  on conflict (student_id, date, period) do update
    set status = excluded.status, subject_id = excluded.subject_id,
        recorded_by = excluded.recorded_by, recorded_at = now();

  if v_count > 0 then
    insert into audit_log (actor, actor_name, table_name, record_key, action, new_data, note)
    values (auth.uid(), current_staff_name(), 'attendance_subject',
            p_classroom || ':' || p_date || ':' || p_period, 'save', v_changes,
            'วิชา ' || p_subject || ' ' || v_count || ' รายการ');
  end if;
  return jsonb_build_object('saved_at', now(), 'changed', v_count);
end $$;

-- ---------------------------------------------------------------------
-- สรุปการมาเรียนรายคน
-- ---------------------------------------------------------------------
create or replace function public.attendance_summary(p_classroom integer, p_from date, p_to date)
returns table (
  student_id uuid, number smallint, prefix text, first_name text, last_name text,
  present integer, late integer, sick integer, personal integer, absent integer, recorded integer
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not can_view_classroom(p_classroom) then
    raise exception 'ไม่มีสิทธิ์ดูข้อมูลห้องนี้' using errcode = '42501';
  end if;
  return query
    select s.id, e.number, s.prefix, s.first_name, s.last_name,
      count(*) filter (where a.status = 0)::integer,
      count(*) filter (where a.status = 1)::integer,
      count(*) filter (where a.status = 2)::integer,
      count(*) filter (where a.status = 3)::integer,
      count(*) filter (where a.status = 4)::integer,
      count(a.status)::integer
    from enrollments e
    join students s on s.id = e.student_id
    left join attendance_daily a on a.student_id = s.id and a.date between p_from and p_to
    where e.classroom_id = p_classroom
    group by s.id, e.number, s.prefix, s.first_name, s.last_name, s.gender
    order by e.number nulls last, s.gender, s.first_name;
end $$;

-- ห้องที่บันทึก/ยังไม่บันทึกในวันที่กำหนด
create or replace function public.daily_progress(p_date date)
returns table (
  classroom_id integer, grade text, room smallint, students integer,
  line_at timestamptz, milk_at timestamptz, brush_at timestamptz,
  present integer, late integer, leave integer, absent integer, homeroom text
)
language plpgsql stable security definer set search_path = public as $$
declare v_year integer;
begin
  if not is_staff() then
    raise exception 'ไม่มีสิทธิ์' using errcode = '42501';
  end if;
  select year into v_year from terms where p_date between start_date and end_date limit 1;
  v_year := coalesce(v_year, (select current_year from school_settings where id = 1));
  return query
    select c.id, c.grade, c.room,
      (select count(*)::integer from enrollments e join students s on s.id = e.student_id
        where e.classroom_id = c.id and s.status = 'studying'),
      (select saved_at from record_sessions r where r.classroom_id = c.id and r.date = p_date and r.kind = 'line'),
      (select saved_at from record_sessions r where r.classroom_id = c.id and r.date = p_date and r.kind = 'milk'),
      (select saved_at from record_sessions r where r.classroom_id = c.id and r.date = p_date and r.kind = 'brush'),
      (select count(*)::integer from attendance_daily a where a.classroom_id = c.id and a.date = p_date and a.status = 0),
      (select count(*)::integer from attendance_daily a where a.classroom_id = c.id and a.date = p_date and a.status = 1),
      (select count(*)::integer from attendance_daily a where a.classroom_id = c.id and a.date = p_date and a.status in (2, 3)),
      (select count(*)::integer from attendance_daily a where a.classroom_id = c.id and a.date = p_date and a.status = 4),
      (select string_agg(concat_ws(' ', st.prefix, st.first_name), ', ' order by st.first_name)
        from homeroom_assignments h join staff st on st.id = h.staff_id
        where h.classroom_id = c.id and h.kind = 'homeroom')
    from classrooms c join grade_levels g on g.code = c.grade
    where c.year = v_year
    order by g.sort, c.room;
end $$;

-- รายงานการใช้งานระบบรายครู
create or replace function public.usage_report(p_from date, p_to date)
returns table (staff_id uuid, name text, last_seen_at timestamptz, sessions integer, edits integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_any_role(array['admin','executive']) then
    raise exception 'ไม่มีสิทธิ์' using errcode = '42501';
  end if;
  return query
    select st.id, concat_ws(' ', st.prefix, st.first_name, st.last_name), st.last_seen_at,
      (select count(*)::integer from record_sessions r where r.saved_by = st.id and r.date between p_from and p_to),
      (select count(*)::integer from audit_log l where l.actor = st.user_id and l.at::date between p_from and p_to)
    from staff st
    where st.approved and st.active
    order by st.first_name;
end $$;

-- ---------------------------------------------------------------------
-- งานทะเบียน (ผู้ดูแลระบบ)
-- ---------------------------------------------------------------------
create or replace function public.assert_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_role('admin') then
    raise exception 'เฉพาะผู้ดูแลระบบเท่านั้น' using errcode = '42501';
  end if;
end $$;

-- นำเข้าข้อมูลจาก DMC (ข้อมูลผ่านการแปลงรูปแบบจากหน้าเว็บแล้ว)
create or replace function public.import_dmc(p_year integer, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  v_id uuid;
  v_inserted boolean;
  v_class integer;
  v_old_class integer;
  n_new integer := 0;
  n_updated integer := 0;
  n_moved integer := 0;
begin
  perform assert_admin();
  insert into academic_years (year) values (p_year) on conflict do nothing;

  for r in select * from jsonb_array_elements(p_rows) loop
    if coalesce(r ->> 'citizen_id', '') = '' or coalesce(r ->> 'first_name', '') = '' then
      continue;
    end if;

    insert into students as s (
      citizen_id, student_code, prefix, first_name, last_name, first_name_en, last_name_en,
      gender, birth_date, blood_group, nationality, religion,
      father_name, father_phone, mother_name, mother_phone,
      guardian_name, guardian_relation, guardian_phone,
      address_registered, address_current, weight_dmc, height_dmc, dmc_raw, dmc_imported_at
    ) values (
      r ->> 'citizen_id', r ->> 'student_code', r ->> 'prefix', r ->> 'first_name', r ->> 'last_name',
      r ->> 'first_name_en', r ->> 'last_name_en', r ->> 'gender', (r ->> 'birth_date')::date,
      r ->> 'blood_group', r ->> 'nationality', r ->> 'religion',
      r ->> 'father_name', r ->> 'father_phone', r ->> 'mother_name', r ->> 'mother_phone',
      r ->> 'guardian_name', r ->> 'guardian_relation', r ->> 'guardian_phone',
      r ->> 'address_registered', r ->> 'address_current',
      (r ->> 'weight')::numeric, (r ->> 'height')::numeric, r -> 'raw', now()
    )
    on conflict (citizen_id) do update set
      student_code = excluded.student_code, prefix = excluded.prefix,
      first_name = excluded.first_name, last_name = excluded.last_name,
      first_name_en = excluded.first_name_en, last_name_en = excluded.last_name_en,
      gender = excluded.gender, birth_date = excluded.birth_date, blood_group = excluded.blood_group,
      nationality = excluded.nationality, religion = excluded.religion,
      father_name = excluded.father_name, father_phone = excluded.father_phone,
      mother_name = excluded.mother_name, mother_phone = excluded.mother_phone,
      guardian_name = excluded.guardian_name, guardian_relation = excluded.guardian_relation,
      guardian_phone = excluded.guardian_phone,
      address_registered = excluded.address_registered, address_current = excluded.address_current,
      weight_dmc = excluded.weight_dmc, height_dmc = excluded.height_dmc,
      dmc_raw = excluded.dmc_raw, dmc_imported_at = now()
    returning s.id, (xmax = 0) into v_id, v_inserted;

    if v_inserted then n_new := n_new + 1; else n_updated := n_updated + 1; end if;

    if coalesce(r ->> 'grade', '') <> '' and coalesce(r ->> 'room', '') <> '' then
      insert into classrooms (year, grade, room) values (p_year, r ->> 'grade', (r ->> 'room')::smallint)
      on conflict (year, grade, room) do nothing;
      select id into v_class from classrooms
        where year = p_year and grade = r ->> 'grade' and room = (r ->> 'room')::smallint;

      select classroom_id into v_old_class from enrollments where student_id = v_id and year = p_year;
      if v_old_class is null then
        insert into enrollments (student_id, year, classroom_id, number)
        values (v_id, p_year, v_class,
          (select coalesce(max(number), 0) + 1 from enrollments where classroom_id = v_class));
      elsif v_old_class <> v_class then
        update enrollments set classroom_id = v_class,
          number = (select coalesce(max(number), 0) + 1 from enrollments where classroom_id = v_class)
        where student_id = v_id and year = p_year;
        n_moved := n_moved + 1;
      end if;
    end if;
  end loop;

  insert into audit_log (actor, actor_name, table_name, record_key, action, note)
  values (auth.uid(), current_staff_name(), 'students', p_year::text, 'import',
          format('นำเข้า DMC: ใหม่ %s, อัปเดต %s, ย้ายห้อง %s', n_new, n_updated, n_moved));

  return jsonb_build_object('new', n_new, 'updated', n_updated, 'moved', n_moved);
end $$;

create or replace function public.change_student_status(
  p_student uuid, p_status text, p_date date, p_reason text
) returns void
language plpgsql security definer set search_path = public as $$
declare v_from text;
begin
  perform assert_admin();
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'กรุณาระบุเหตุผล' using errcode = '22023';
  end if;
  select status into v_from from students where id = p_student for update;
  if v_from is null then
    raise exception 'ไม่พบนักเรียน' using errcode = 'P0002';
  end if;
  update students set status = p_status, status_date = p_date, status_note = p_reason where id = p_student;
  insert into student_status_history (student_id, from_status, to_status, effective_date, reason, changed_by)
  values (p_student, v_from, p_status, p_date, p_reason, my_staff_id());
end $$;

create or replace function public.move_student(p_student uuid, p_classroom integer)
returns void
language plpgsql security definer set search_path = public as $$
declare v_year integer;
begin
  perform assert_admin();
  select year into v_year from classrooms where id = p_classroom;
  insert into enrollments (student_id, year, classroom_id, number)
  values (p_student, v_year, p_classroom,
    (select coalesce(max(number), 0) + 1 from enrollments where classroom_id = p_classroom))
  on conflict (student_id, year) do update
    set classroom_id = excluded.classroom_id, number = excluded.number;
end $$;

create or replace function public.renumber_classroom(p_classroom integer, p_students uuid[])
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin();
  update enrollments e set number = x.ord
  from unnest(p_students) with ordinality as x(sid, ord)
  where e.student_id = x.sid and e.classroom_id = p_classroom;
end $$;

-- เลื่อนชั้นสิ้นปีการศึกษา
create or replace function public.promote_year(p_from integer, p_to integer, p_repeaters uuid[] default '{}')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  n_promoted integer := 0;
  n_repeated integer := 0;
  n_graduated integer := 0;
  v_grad_date date;
begin
  perform assert_admin();
  if p_to <> p_from + 1 then
    raise exception 'ปีปลายทางต้องเป็นปีถัดไป' using errcode = '22023';
  end if;
  insert into academic_years (year) values (p_to) on conflict do nothing;

  -- ห้องเรียนปีใหม่ ใช้จำนวนห้องเดิมของแต่ละชั้น
  insert into classrooms (year, grade, room)
  select p_to, grade, room from classrooms where year = p_from
  on conflict do nothing;

  -- ซ้ำชั้น: ชั้นเดิม ห้องเดิม
  insert into enrollments (student_id, year, classroom_id, number, repeated)
  select e.student_id, p_to, c2.id, e.number, true
  from enrollments e
  join students s on s.id = e.student_id and s.status = 'studying'
  join classrooms c on c.id = e.classroom_id
  join classrooms c2 on c2.year = p_to and c2.grade = c.grade and c2.room = c.room
  where e.year = p_from and e.student_id = any(p_repeaters)
  on conflict do nothing;
  get diagnostics n_repeated = row_count;

  -- เลื่อนชั้น: ชั้นถัดไป ห้องเดิม (ป.6 ไม่มีชั้นถัดไป)
  insert into classrooms (year, grade, room)
  select distinct p_to, g.next_code, c.room
  from enrollments e join classrooms c on c.id = e.classroom_id
  join grade_levels g on g.code = c.grade
  where e.year = p_from and g.next_code is not null
  on conflict do nothing;

  insert into enrollments (student_id, year, classroom_id, number)
  select e.student_id, p_to, c2.id, e.number
  from enrollments e
  join students s on s.id = e.student_id and s.status = 'studying'
  join classrooms c on c.id = e.classroom_id
  join grade_levels g on g.code = c.grade and g.next_code is not null
  join classrooms c2 on c2.year = p_to and c2.grade = g.next_code and c2.room = c.room
  where e.year = p_from and not (e.student_id = any(p_repeaters))
  on conflict do nothing;
  get diagnostics n_promoted = row_count;

  -- ป.6 ที่ไม่ซ้ำชั้น: จบการศึกษา
  v_grad_date := coalesce((select max(end_date) from terms where year = p_from), today_th());
  with grads as (
    select s.id, s.status
    from enrollments e
    join students s on s.id = e.student_id and s.status = 'studying'
    join classrooms c on c.id = e.classroom_id and c.grade = 'ป.6'
    where e.year = p_from and not (e.student_id = any(p_repeaters))
  ), hist as (
    insert into student_status_history (student_id, from_status, to_status, effective_date, reason, changed_by)
    select id, status, 'graduated', v_grad_date, 'จบการศึกษาชั้น ป.6 ปีการศึกษา ' || p_from, my_staff_id()
    from grads
  )
  update students set status = 'graduated', status_date = v_grad_date,
    status_note = 'จบการศึกษาชั้น ป.6 ปีการศึกษา ' || p_from
  where id in (select id from grads);
  get diagnostics n_graduated = row_count;

  insert into audit_log (actor, actor_name, table_name, record_key, action, note)
  values (auth.uid(), current_staff_name(), 'enrollments', p_to::text, 'promote',
          format('เลื่อนชั้น %s คน ซ้ำชั้น %s คน จบการศึกษา %s คน', n_promoted, n_repeated, n_graduated));

  return jsonb_build_object('promoted', n_promoted, 'repeated', n_repeated, 'graduated', n_graduated);
end $$;

-- ครูที่ปรึกษาแก้ข้อมูลที่ DMC ไม่มี (ชื่อเล่น หมายเหตุ)
create or replace function public.update_student_extra(p_student uuid, p_nickname text, p_note text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_view_student_full(p_student) then
    raise exception 'ไม่มีสิทธิ์แก้ไขข้อมูลนักเรียนคนนี้' using errcode = '42501';
  end if;
  update students set nickname = nullif(trim(p_nickname), ''), note = nullif(trim(p_note), '')
  where id = p_student;
end $$;

-- ---------------------------------------------------------------------
-- สิทธิ์เรียกใช้ฟังก์ชัน
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
