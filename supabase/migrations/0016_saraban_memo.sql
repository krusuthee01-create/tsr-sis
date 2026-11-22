-- =====================================================================
-- TSR-SIS: สารบรรณ — บันทึกข้อความภายใน
-- - ครูเขียนบันทึกข้อความในระบบ → ได้เลขบันทึกข้อความ (ชุดแยก: ศธ 04109.84/บ n) และเข้าระบบเป็นหนังสือรับ 1 เล่ม
--   (ชนิด หนังสือภายใน อยู่ที่ธุรการ) แล้วใช้ขั้นตอนเดิม: ธุรการเสนอ › ผอ. เกษียน › ผู้รับ
-- - ผู้เขียนแนบไฟล์ต้นฉบับ (PDF ที่ระบบสร้าง) ได้เองขณะยังอยู่ขั้นลงรับ
-- - รายการ "บันทึกของฉัน" (p_filter = 'mine')
-- =====================================================================
alter table public.saraban_outgoing drop constraint if exists saraban_outgoing_kind_check;
alter table public.saraban_outgoing add constraint saraban_outgoing_kind_check
  check (kind in ('letter', 'circular', 'order', 'announce', 'memo'));
alter table public.saraban_outgoing drop constraint if exists saraban_outgoing_series_check;
alter table public.saraban_outgoing add constraint saraban_outgoing_series_check
  check (series in ('out', 'order', 'announce', 'memo'));
alter table public.saraban_outgoing add column if not exists book_id uuid references public.saraban_books(id);

-- สร้างบันทึกข้อความ: {"book_id", "doc_no", "receive_no", "year"}
-- p: unit (ส่วนราชการ), subject, to_text (เรียน), doc_date
create or replace function public.saraban_memo_create(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := my_staff_id();
  v_year int := saraban_year();
  v_subject text := nullif(btrim(p ->> 'subject'), '');
  v_unit text := coalesce(nullif(btrim(p ->> 'unit'), ''), (select school_name from school_settings where id = 1));
  v_to text := nullif(btrim(p ->> 'to_text'), '');
  v_date date := coalesce(nullif(p ->> 'doc_date', '')::date, today_th());
  v_seq int;
  v_prefix text;
  v_doc_no text;
  v_no int;
  v_clerk uuid;
  v_book uuid;
begin
  if v_me is null then raise exception 'ไม่มีสิทธิ์เขียนบันทึกข้อความ'; end if;
  if v_subject is null then raise exception 'กรุณากรอกเรื่อง'; end if;
  if length(v_subject) > 1000 or length(coalesce(v_to, '')) > 300 or length(coalesce(v_unit, '')) > 300 then
    raise exception 'ข้อความยาวเกินไป';
  end if;

  -- เลขบันทึกข้อความ (ชุดแยกจากหนังสือส่ง)
  insert into saraban_counters (year, kind, last_no) values (v_year, 'memo', 1)
  on conflict (year, kind) do update set last_no = saraban_counters.last_no + 1
  returning last_no into v_seq;
  select coalesce(nullif(btrim(saraban_prefix), ''), 'ศธ 04109.84') into v_prefix from school_settings where id = 1;
  v_doc_no := format('%s/บ %s', v_prefix, v_seq);

  -- เลขทะเบียนรับ (ชุดเดียวกับหนังสือรับ)
  loop
    insert into saraban_counters (year, kind, last_no) values (v_year, 'in', 1)
    on conflict (year, kind) do update set last_no = saraban_counters.last_no + 1
    returning last_no into v_no;
    exit when not exists (select 1 from saraban_books where year = v_year and receive_no = v_no);
  end loop;

  -- ไปที่ธุรการ (คนแรกที่ยังทำงาน) — ไม่มีธุรการก็ไม่มีผู้ถือ (ผอ./ธุรการเห็นในรายการทั้งหมด)
  select id into v_clerk from staff where saraban_role = 'clerk' and approved and active order by created_at, id limit 1;

  insert into saraban_books (year, receive_no, doc_no, doc_date, from_org, to_text, subject, urgency, secret,
    status, current_holder, created_by, doc_type)
  values (v_year, v_no, v_doc_no, v_date, coalesce(current_staff_name(), v_unit), v_to, v_subject, 0, false,
    'registered', v_clerk, v_me, 'internal')
  returning id into v_book;
  insert into saraban_actions (book_id, actor, action, note) values (v_book, v_me, 'register', 'บันทึกข้อความ ' || v_doc_no);

  insert into saraban_outgoing (kind, series, year, seq, doc_no, doc_date, to_text, subject, secret, requested_by, book_id)
  values ('memo', 'memo', v_year, v_seq, v_doc_no, v_date, v_to, v_subject, false, v_me, v_book);

  return jsonb_build_object('book_id', v_book, 'doc_no', v_doc_no, 'receive_no', v_no, 'year', v_year);
end $$;

-- อัปโหลดไฟล์ได้หรือไม่: เพิ่มกรณีผู้เขียนบันทึกข้อความแนบต้นฉบับขณะยังอยู่ขั้นลงรับ
create or replace function public.saraban_can_upload(p_book uuid, p_kind text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when p_kind in ('original', 'attachment') then
           saraban_role() in ('director', 'clerk')
        or (b.created_by = my_staff_id() and b.status = 'registered' and b.doc_type = 'internal')
      when p_kind = 'stamped' then
           (b.status = 'registered' and saraban_role() in ('clerk', 'director'))
        or (b.status = 'proposed' and saraban_role() = 'director')
        or (b.status = 'endorsed' and saraban_role() = 'head' and b.current_holder = my_staff_id())
      else false
    end
    from saraban_books b
    where b.id = p_book and b.deleted_at is null and my_staff_id() is not null
  ), false)
$$;

-- รายการหนังสือ: เพิ่มตัวกรอง 'mine' (หนังสือ/บันทึกที่ฉันลงรับหรือเขียน)
create or replace function public.saraban_inbox(p_q text default null, p_filter text default 'all', p_offset int default 0)
returns table(id uuid, year int, receive_no int, doc_no text, subject text, from_org text, urgency smallint,
  secret boolean, due_date date, status text, received_at timestamptz, holder_name text, unread boolean, total bigint)
language plpgsql stable security invoker set search_path = public as $$
declare
  v_me uuid := my_staff_id();
  v_q text := nullif(btrim(p_q), '');
  v_no int := case when v_q ~ '^[0-9]{1,9}$' then v_q::int end; -- คำค้นที่เป็นตัวเลขตรงกับเลขรับด้วย
  v_filter text := coalesce(p_filter, 'all');
begin
  if v_filter not in ('all', 'todo', 'unread', 'mine') then
    raise exception 'ตัวกรองไม่ถูกต้อง: %', p_filter;
  end if;
  return query
  select b.id, b.year, b.receive_no, b.doc_no, b.subject, b.from_org, b.urgency, b.secret, b.due_date, b.status,
    b.received_at,
    case when h.id is not null then concat_ws(' ', h.prefix, h.first_name, nullif(h.last_name, '')) end,
    (r.staff_id is not null and r.read_at is null),
    count(*) over ()
  from saraban_books b
  left join staff h on h.id = b.current_holder
  left join saraban_recipients r on r.book_id = b.id and r.staff_id = v_me
  where b.deleted_at is null
    and (v_q is null
      or (coalesce(b.doc_no, '') || ' ' || b.subject || ' ' || b.from_org) ilike '%' || saraban_like_escape(v_q) || '%'
      or b.receive_no = v_no)
    and (v_filter = 'all'
      or (v_filter = 'unread' and r.staff_id is not null and r.read_at is null)
      or (v_filter = 'todo' and (b.current_holder = v_me or (r.staff_id is not null and r.read_at is null)))
      or (v_filter = 'mine' and b.created_by = v_me))
  order by b.urgency desc, b.due_date asc nulls last, b.year desc, b.receive_no desc
  limit 50 offset greatest(coalesce(p_offset, 0), 0);
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.saraban_add_file(uuid, text, text, text, bigint, uuid) from public, anon, authenticated;
revoke execute on function public.saraban_due_reminders() from public, anon, authenticated;
revoke execute on function public.saraban_out_add_file(uuid, text, text, bigint, uuid) from public, anon, authenticated;
grant execute on function public.saraban_add_file(uuid, text, text, text, bigint, uuid) to service_role;
grant execute on function public.saraban_due_reminders() to service_role;
grant execute on function public.saraban_out_add_file(uuid, text, text, bigint, uuid) to service_role;
