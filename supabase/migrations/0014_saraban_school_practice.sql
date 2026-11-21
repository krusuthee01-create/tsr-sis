-- =====================================================================
-- TSR-SIS: สารบรรณ — ปรับตามการใช้งานจริงของโรงเรียน (เทียบระบบเดิม)
-- - ชนิดหนังสือ (ระเบียบงานสารบรรณ 6 ชนิด), อ้างถึง, รายละเอียด
-- - ผอ. "ส่งคืนงานธุรการ" (กลับขั้นลงรับ ให้ธุรการแก้ไขแล้วเสนอใหม่)
-- =====================================================================
alter table public.saraban_books add column if not exists doc_type text not null default 'external';
alter table public.saraban_books drop constraint if exists saraban_books_doc_type_check;
alter table public.saraban_books add constraint saraban_books_doc_type_check
  check (doc_type in ('external', 'internal', 'stamped', 'order', 'announce', 'record'));
alter table public.saraban_books add column if not exists ref_text text;   -- อ้างถึง
alter table public.saraban_books add column if not exists detail text;     -- รายละเอียด/สาระสำคัญ

alter table public.saraban_actions drop constraint if exists saraban_actions_action_check;
alter table public.saraban_actions add constraint saraban_actions_action_check
  check (action in ('register', 'propose', 'endorse', 'forward', 'close', 'read', 'renumber', 'delete', 'upload', 'return'));

-- ลงรับ: รับชนิดหนังสือ อ้างถึง รายละเอียด
create or replace function public.saraban_register(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := my_staff_id();
  v_year int := saraban_year();
  v_no int := nullif(p ->> 'receive_no', '')::int;
  v_subject text := nullif(btrim(p ->> 'subject'), '');
  v_from text := nullif(btrim(p ->> 'from_org'), '');
  v_urgency smallint := coalesce(nullif(p ->> 'urgency', '')::smallint, 0);
  v_doc_type text := coalesce(nullif(p ->> 'doc_type', ''), 'external');
  v_id uuid;
begin
  if coalesce(saraban_role(), '') not in ('director', 'clerk') then
    raise exception 'ไม่มีสิทธิ์ลงรับหนังสือ';
  end if;
  if v_subject is null or v_from is null then
    raise exception 'กรุณากรอกเรื่องและหน่วยงานที่ส่ง';
  end if;
  if v_urgency not between 0 and 3 then
    raise exception 'ระดับความเร่งด่วนไม่ถูกต้อง';
  end if;
  if v_doc_type not in ('external', 'internal', 'stamped', 'order', 'announce', 'record') then
    raise exception 'ชนิดหนังสือไม่ถูกต้อง';
  end if;

  if v_no is not null then
    if v_no < 1 then raise exception 'เลขรับต้องมากกว่า 0'; end if;
    -- upsert ตัวนับก่อน เพื่อล็อกแถวและเรียงลำดับกับการลงรับพร้อมกัน
    insert into saraban_counters (year, kind, last_no) values (v_year, 'in', v_no)
    on conflict (year, kind) do update set last_no = greatest(saraban_counters.last_no, excluded.last_no);
    if exists (select 1 from saraban_books where year = v_year and receive_no = v_no) then
      raise exception 'เลขรับ % มีแล้วในปี %', v_no, v_year;
    end if;
  else
    loop -- ข้ามเลขที่ถูกใช้ไปแล้ว (เช่น แก้เลขด้วยมือ)
      insert into saraban_counters (year, kind, last_no) values (v_year, 'in', 1)
      on conflict (year, kind) do update set last_no = saraban_counters.last_no + 1
      returning last_no into v_no;
      exit when not exists (select 1 from saraban_books where year = v_year and receive_no = v_no);
    end loop;
  end if;

  begin
    insert into saraban_books (year, receive_no, doc_no, doc_date, from_org, to_text, subject, urgency, secret,
      due_date, status, current_holder, created_by, doc_type, ref_text, detail)
    values (v_year, v_no, nullif(btrim(p ->> 'doc_no'), ''), nullif(p ->> 'doc_date', '')::date, v_from,
      nullif(btrim(p ->> 'to_text'), ''), v_subject, v_urgency, coalesce((p ->> 'secret')::boolean, false),
      nullif(p ->> 'due_date', '')::date, 'registered', v_me, v_me, v_doc_type,
      nullif(btrim(p ->> 'ref_text'), ''), nullif(btrim(p ->> 'detail'), ''))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'เลขรับ % มีแล้วในปี %', v_no, v_year;
  end;
  insert into saraban_actions (book_id, actor, action) values (v_id, v_me, 'register');
  return jsonb_build_object('id', v_id, 'year', v_year, 'receive_no', v_no);
end $$;

-- ผอ. เกษียน: 'head' ถึงหัวหน้ากลุ่มงาน 1 คน, 'teachers' มอบผู้รับโดยตรง, 'close' จัดเก็บ, 'return' ส่งคืนธุรการ
-- คืน {"line": true} เมื่อควรแจ้ง LINE (head/teachers)
create or replace function public.saraban_endorse(p_book uuid, p_route text, p_note text, p_targets uuid[], p_file uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := my_staff_id();
  v_book saraban_books;
  v_targets uuid[] := coalesce((select array_agg(distinct t) from unnest(p_targets) t where t is not null), '{}');
begin
  if coalesce(saraban_role(), '') <> 'director' then
    raise exception 'ไม่มีสิทธิ์เกษียนหนังสือ';
  end if;
  select * into v_book from saraban_books where id = p_book and deleted_at is null for update;
  if not found then raise exception 'ไม่พบหนังสือ'; end if;
  -- รอเกษียน หรือ ผอ. ลงรับเอง
  if not (v_book.status = 'proposed' or (v_book.status = 'registered' and v_book.created_by = v_me)) then
    raise exception 'สถานะหนังสือไม่อยู่ในขั้นรอเกษียน';
  end if;
  if p_file is not null and not exists (select 1 from saraban_files where id = p_file and book_id = p_book) then
    raise exception 'ไฟล์ไม่ใช่ของหนังสือเล่มนี้';
  end if;

  if p_route = 'head' then
    if cardinality(v_targets) <> 1 or not exists (
      select 1 from staff where id = v_targets[1] and saraban_role = 'head' and approved and active
    ) then
      raise exception 'ต้องเลือกหัวหน้ากลุ่มงาน 1 คน';
    end if;
    update saraban_books set status = 'endorsed', current_holder = v_targets[1] where id = p_book;
    insert into saraban_actions (book_id, actor, action, note, file_id, targets)
    values (p_book, v_me, 'endorse', nullif(btrim(p_note), ''), p_file, v_targets);
    return jsonb_build_object('line', true);
  elsif p_route = 'teachers' then
    if cardinality(v_targets) = 0 then raise exception 'กรุณาเลือกผู้รับ'; end if;
    if exists (select 1 from unnest(v_targets) t
               where not exists (select 1 from staff s where s.id = t and s.approved and s.active)) then
      raise exception 'ผู้รับไม่ถูกต้อง';
    end if;
    insert into saraban_recipients (book_id, staff_id, assigned_by)
    select p_book, t, v_me from unnest(v_targets) t
    on conflict (book_id, staff_id) do nothing;
    update saraban_books set status = 'assigned', current_holder = null where id = p_book;
    insert into saraban_actions (book_id, actor, action, note, file_id, targets)
    values (p_book, v_me, 'endorse', nullif(btrim(p_note), ''), p_file, v_targets);
    return jsonb_build_object('line', true);
  elsif p_route = 'return' then
    -- ส่งคืนงานธุรการ (เช่น หนังสือต้องแก้ไข/ขอข้อมูลเพิ่ม): กลับไปขั้นลงรับ ผู้ถือ = ผู้เสนอล่าสุด (ไม่มีก็ผู้ลงรับ)
    if nullif(btrim(p_note), '') is null then raise exception 'กรุณาระบุเหตุผลที่ส่งคืน'; end if;
    update saraban_books set status = 'registered',
      current_holder = coalesce(
        (select a.actor from saraban_actions a where a.book_id = p_book and a.action = 'propose' order by a.id desc limit 1),
        v_book.created_by)
    where id = p_book;
    insert into saraban_actions (book_id, actor, action, note, file_id)
    values (p_book, v_me, 'return', btrim(p_note), p_file);
    return jsonb_build_object('line', false);
  elsif p_route = 'close' then
    update saraban_books set status = 'closed', current_holder = null where id = p_book;
    insert into saraban_actions (book_id, actor, action, note, file_id)
    values (p_book, v_me, 'close', nullif(btrim(p_note), ''), p_file);
    return jsonb_build_object('line', false);
  else
    raise exception 'ไม่รู้จักการเกษียนแบบ %', p_route;
  end if;
end $$;
