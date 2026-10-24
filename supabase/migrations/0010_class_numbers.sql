-- =====================================================================
-- ครูที่ปรึกษากำหนดเลขที่นักเรียนในห้องของตนเอง — ไฟล์นี้รันซ้ำได้
-- =====================================================================

-- p_numbers: [{"s": student_id, "n": เลขที่}] ต้องครบทุกคนในห้อง และเลขที่ไม่ซ้ำกัน
create or replace function public.set_class_numbers(p_classroom integer, p_numbers jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_year integer; v_changed integer;
begin
  select year into v_year from classrooms where id = p_classroom;
  if v_year is null then raise exception 'ไม่พบห้องเรียน' using errcode = '22023'; end if;
  if not (has_any_role(array['admin']) or (is_homeroom_of(p_classroom, false)
          and v_year = (select current_year from school_settings where id = 1))) then
    raise exception 'กำหนดเลขที่ได้เฉพาะครูที่ปรึกษาของห้องนี้ (ปีการศึกษาปัจจุบัน) หรือผู้ดูแลระบบ' using errcode = '42501';
  end if;

  drop table if exists _num;
  create temp table _num on commit drop as
    select x.s, x.n from jsonb_to_recordset(p_numbers) x(s uuid, n integer);

  if exists (select 1 from _num where n is null or n < 1 or n > 99) then
    raise exception 'เลขที่ต้องอยู่ระหว่าง 1–99' using errcode = '22023';
  end if;
  if (select count(*) from _num) <> (select count(distinct n) from _num) or (select count(*) from _num) <> (select count(distinct s) from _num) then
    raise exception 'มีเลขที่หรือนักเรียนซ้ำกัน กรุณาตรวจอีกครั้ง' using errcode = '22023';
  end if;
  if exists (select 1 from _num x where not exists (select 1 from enrollments e where e.student_id = x.s and e.classroom_id = p_classroom))
     or exists (select 1 from enrollments e where e.classroom_id = p_classroom and not exists (select 1 from _num x where x.s = e.student_id)) then
    raise exception 'รายชื่อไม่ตรงกับนักเรียนในห้อง (อาจมีการย้ายห้องระหว่างนี้) กรุณาโหลดหน้าใหม่' using errcode = '22023';
  end if;

  update enrollments e set number = x.n from _num x
  where e.student_id = x.s and e.classroom_id = p_classroom and e.number is distinct from x.n;
  get diagnostics v_changed = row_count;

  if v_changed > 0 then
    insert into audit_log (actor, actor_name, table_name, record_key, action, note)
    values (auth.uid(), current_staff_name(), 'enrollments', p_classroom::text, 'renumber',
      format('กำหนดเลขที่ห้อง %s ใหม่ %s คน', (select grade || '/' || room from classrooms where id = p_classroom), v_changed));
  end if;
  return v_changed;
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
