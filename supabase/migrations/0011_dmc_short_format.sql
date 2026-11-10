-- =====================================================================
-- นำเข้า DMC แบบย่อได้: ฟิลด์ที่ไฟล์ไม่มี (ไม่ได้ส่งมา) คงค่าเดิมในระบบ — ไฟล์นี้รันซ้ำได้
-- เช่น ไฟล์แบบย่อไม่มีเบอร์โทร ชื่ออังกฤษ ที่อยู่ทะเบียนบ้าน จึงต้องไม่ล้างข้อมูลเหล่านี้
-- =====================================================================

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
      student_code = case when r ? 'student_code' then excluded.student_code else s.student_code end,
      prefix = case when r ? 'prefix' then excluded.prefix else s.prefix end,
      first_name = case when r ? 'first_name' then excluded.first_name else s.first_name end,
      last_name = case when r ? 'last_name' then excluded.last_name else s.last_name end,
      first_name_en = case when r ? 'first_name_en' then excluded.first_name_en else s.first_name_en end,
      last_name_en = case when r ? 'last_name_en' then excluded.last_name_en else s.last_name_en end,
      gender = case when r ? 'gender' then excluded.gender else s.gender end,
      birth_date = case when r ? 'birth_date' then excluded.birth_date else s.birth_date end,
      blood_group = case when r ? 'blood_group' then excluded.blood_group else s.blood_group end,
      nationality = case when r ? 'nationality' then excluded.nationality else s.nationality end,
      religion = case when r ? 'religion' then excluded.religion else s.religion end,
      father_name = case when r ? 'father_name' then excluded.father_name else s.father_name end,
      father_phone = case when r ? 'father_phone' then excluded.father_phone else s.father_phone end,
      mother_name = case when r ? 'mother_name' then excluded.mother_name else s.mother_name end,
      mother_phone = case when r ? 'mother_phone' then excluded.mother_phone else s.mother_phone end,
      guardian_name = case when r ? 'guardian_name' then excluded.guardian_name else s.guardian_name end,
      guardian_relation = case when r ? 'guardian_relation' then excluded.guardian_relation else s.guardian_relation end,
      guardian_phone = case when r ? 'guardian_phone' then excluded.guardian_phone else s.guardian_phone end,
      address_registered = case when r ? 'address_registered' then excluded.address_registered else s.address_registered end,
      address_current = case when r ? 'address_current' then excluded.address_current else s.address_current end,
      weight_dmc = case when r ? 'weight' then excluded.weight_dmc else s.weight_dmc end,
      height_dmc = case when r ? 'height' then excluded.height_dmc else s.height_dmc end,
      dmc_raw = coalesce(s.dmc_raw, '{}'::jsonb) || coalesce(excluded.dmc_raw, '{}'::jsonb), dmc_imported_at = now()
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

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
