-- =====================================================================
-- TSR-SIS: ระบบสารบรรณอิเล็กทรอนิกส์ (e-Saraban) ระยะที่ 1
-- ตาราง สิทธิ์การมองเห็นหนังสือ และ RLS — การเขียนทั้งหมดผ่าน RPC (security definer) เท่านั้น
-- =====================================================================

-- ---------- 1) บทบาทสารบรรณของบุคลากร ----------
alter table public.staff add column if not exists saraban_role text not null default 'teacher';
alter table public.staff drop constraint if exists staff_saraban_role_check;
alter table public.staff add constraint staff_saraban_role_check
  check (saraban_role in ('director', 'clerk', 'head', 'teacher'));
alter table public.staff add column if not exists work_group text; -- กลุ่มงาน เช่น วิชาการ งบประมาณ

-- ---------- 2) ตาราง ----------
create table if not exists public.saraban_books (
  id uuid primary key default gen_random_uuid(),
  year int not null,                       -- ปี พ.ศ. ของเลขทะเบียนรับ
  receive_no int not null,                 -- เลขทะเบียนรับ
  doc_no text,                             -- เลขที่หนังสือ
  doc_date date,
  from_org text not null,                  -- จาก
  to_text text,                            -- ถึง
  subject text not null,                   -- เรื่อง
  urgency smallint not null default 0 check (urgency between 0 and 3),
  secret boolean not null default false,   -- หนังสือลับ
  due_date date,
  status text not null default 'registered'
    check (status in ('registered', 'proposed', 'endorsed', 'assigned', 'closed')),
  current_holder uuid references public.staff(id),
  received_at timestamptz not null default now(),
  created_by uuid references public.staff(id),
  deleted_at timestamptz,
  deleted_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (year, receive_no)
);

create table if not exists public.saraban_files (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.saraban_books(id),
  kind text not null check (kind in ('original', 'stamped', 'attachment')),
  version int not null,
  drive_file_id text not null unique,
  name text not null,
  size_bytes bigint not null,
  created_by uuid references public.staff(id),
  created_at timestamptz not null default now(),
  unique (book_id, kind, version)
);

create table if not exists public.saraban_actions (
  id bigserial primary key,
  book_id uuid not null references public.saraban_books(id),
  actor uuid references public.staff(id),
  action text not null
    check (action in ('register', 'propose', 'endorse', 'forward', 'close', 'read', 'renumber', 'delete', 'upload')),
  note text,
  file_id uuid references public.saraban_files(id),
  targets uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
-- ฐานข้อมูลที่สร้างตารางไว้ก่อนเพิ่ม 'upload'
alter table public.saraban_actions drop constraint if exists saraban_actions_action_check;
alter table public.saraban_actions add constraint saraban_actions_action_check
  check (action in ('register', 'propose', 'endorse', 'forward', 'close', 'read', 'renumber', 'delete', 'upload'));

create table if not exists public.saraban_recipients (
  book_id uuid not null references public.saraban_books(id),
  staff_id uuid not null references public.staff(id),
  assigned_by uuid references public.staff(id),
  assigned_at timestamptz not null default now(),
  read_at timestamptz,
  primary key (book_id, staff_id)
);

-- ข้อความสำเร็จรูปสำหรับบันทึกสั่งการ
create table if not exists public.saraban_presets (
  id serial primary key,
  role text not null check (role in ('clerk', 'director', 'head')),
  text text not null,
  sort int not null default 0
);

-- ตัวนับเลขทะเบียน (เข้าถึงผ่าน RPC เท่านั้น)
create table if not exists public.saraban_counters (
  year int not null,
  kind text not null,
  last_no int not null,
  primary key (year, kind)
);

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  staff_id uuid not null references public.staff(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

-- ---------- 3) ดัชนี ----------
create extension if not exists pg_trgm;
create index if not exists saraban_books_search_idx on public.saraban_books
  using gin ((coalesce(doc_no, '') || ' ' || subject || ' ' || from_org) gin_trgm_ops);
create index if not exists saraban_books_receive_no_idx on public.saraban_books (receive_no); -- ค้นด้วยเลขรับ
create index if not exists saraban_recipients_staff_idx on public.saraban_recipients (staff_id);
create index if not exists saraban_files_book_idx on public.saraban_files (book_id);
create index if not exists saraban_actions_book_idx on public.saraban_actions (book_id);

-- ---------- 4) ฟังก์ชันสิทธิ์ ----------
-- บทบาทสารบรรณของผู้ใช้ปัจจุบัน (null ถ้าไม่ใช่บุคลากรที่อนุมัติแล้ว)
create or replace function public.saraban_role() returns text
language sql stable security definer set search_path = public as $$
  select saraban_role from staff where user_id = auth.uid() and approved and active
$$;

-- เห็นหนังสือเล่มนี้ได้หรือไม่: ผอ./ธุรการเห็นทุกเล่ม หัวหน้าเห็นเล่มที่ไม่ลับ
-- คนอื่นเห็นเมื่อเป็นผู้ถือหนังสือ ผู้รับ หรือผู้ลงทะเบียน; หนังสือที่ลบแล้วไม่มีใครเห็น
create or replace function public.can_view_book(p_book uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from saraban_books b
    where b.id = p_book and b.deleted_at is null and my_staff_id() is not null and (
      saraban_role() in ('director', 'clerk')
      or (saraban_role() = 'head' and not b.secret)
      or b.created_by = my_staff_id()
      or b.current_holder = my_staff_id()
      or exists (select 1 from saraban_recipients r where r.book_id = b.id and r.staff_id = my_staff_id())
    )
  )
$$;

-- ---------- 5) RLS ----------
alter table public.saraban_books enable row level security;
alter table public.saraban_files enable row level security;
alter table public.saraban_actions enable row level security;
alter table public.saraban_recipients enable row level security;
alter table public.saraban_presets enable row level security;
alter table public.saraban_counters enable row level security;
alter table public.push_subscriptions enable row level security;

-- ไม่มี policy insert/update/delete บนสี่ตารางนี้: เขียนผ่าน RPC เท่านั้น
drop policy if exists saraban_books_read on public.saraban_books;
create policy saraban_books_read on public.saraban_books for select to authenticated
  using (public.can_view_book(id));
drop policy if exists saraban_files_read on public.saraban_files;
create policy saraban_files_read on public.saraban_files for select to authenticated
  using (public.can_view_book(book_id));
drop policy if exists saraban_actions_read on public.saraban_actions;
create policy saraban_actions_read on public.saraban_actions for select to authenticated
  using (public.can_view_book(book_id));
drop policy if exists saraban_recipients_read on public.saraban_recipients;
create policy saraban_recipients_read on public.saraban_recipients for select to authenticated
  using (public.can_view_book(book_id));

drop policy if exists saraban_presets_read on public.saraban_presets;
create policy saraban_presets_read on public.saraban_presets for select to authenticated
  using (public.is_staff());
drop policy if exists saraban_presets_write on public.saraban_presets;
create policy saraban_presets_write on public.saraban_presets for all to authenticated
  using (public.saraban_role() in ('director', 'clerk'))
  with check (public.saraban_role() in ('director', 'clerk'));

-- saraban_counters: ไม่มี policy (authenticated ถูก revoke ด้านล่าง)
drop policy if exists push_subscriptions_owner on public.push_subscriptions;
create policy push_subscriptions_owner on public.push_subscriptions for all to authenticated
  using (staff_id = public.my_staff_id())
  with check (staff_id = public.my_staff_id());

-- ---------- 6) trigger ประวัติการแก้ไข / อัปเดตเวลา ----------
do $$
declare t text;
begin
  foreach t in array array['saraban_books', 'saraban_files', 'saraban_recipients', 'saraban_presets'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_trigger()', t || '_audit', t);
  end loop;
  drop trigger if exists saraban_books_touch on public.saraban_books;
  create trigger saraban_books_touch before update on public.saraban_books
    for each row execute function public.touch_updated_at();
end $$;

-- ---------- 7) ที่เก็บรูปลายเซ็น (Supabase Storage) — path: <staff_id>/<ชื่อไฟล์> ----------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('signatures', 'signatures', false, 204800, array['image/png'])
    on conflict (id) do nothing;
    execute 'drop policy if exists signatures_select on storage.objects';
    execute $p$create policy signatures_select on storage.objects for select to authenticated
      using (bucket_id = 'signatures' and (storage.foldername(name))[1] = public.my_staff_id()::text)$p$;
    execute 'drop policy if exists signatures_insert on storage.objects';
    execute $p$create policy signatures_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'signatures' and (storage.foldername(name))[1] = public.my_staff_id()::text)$p$;
    execute 'drop policy if exists signatures_update on storage.objects';
    execute $p$create policy signatures_update on storage.objects for update to authenticated
      using (bucket_id = 'signatures' and (storage.foldername(name))[1] = public.my_staff_id()::text)
      with check (bucket_id = 'signatures' and (storage.foldername(name))[1] = public.my_staff_id()::text)$p$;
    execute 'drop policy if exists signatures_delete on storage.objects';
    execute $p$create policy signatures_delete on storage.objects for delete to authenticated
      using (bucket_id = 'signatures' and (storage.foldername(name))[1] = public.my_staff_id()::text)$p$;
  end if;
end $$;

-- ---------- 8) RPC ขั้นตอนงาน ----------
-- ทุกฟังก์ชันที่เขียนข้อมูลเป็น security definer ตรวจบทบาทด้วย saraban_role()/my_staff_id()
-- (ไม่เชื่อตัวตนจากพารามิเตอร์) และบันทึก saraban_actions ทุกครั้ง
-- สถานะ: registered (ลงรับ) -> proposed (เสนอ ผอ.) -> endorsed (ถึงหัวหน้ากลุ่มงาน) -> assigned (มอบผู้รับแล้ว) / closed
-- current_holder = ผู้ที่ต้องทำขั้นถัดไป; เป็น null เมื่อ assigned หรือ closed

-- ปี พ.ศ. ปัจจุบันของเลขทะเบียน
create or replace function public.saraban_year() returns int
language sql stable as $$ select extract(year from public.today_th())::int + 543 $$;

-- หนีอักขระพิเศษของ LIKE/ILIKE
create or replace function public.saraban_like_escape(p text) returns text
language sql immutable as $$ select replace(replace(replace(p, '\', '\\'), '%', '\%'), '_', '\_') $$;

-- ลงรับหนังสือ: {"id", "year", "receive_no"}
create or replace function public.saraban_register(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := my_staff_id();
  v_year int := saraban_year();
  v_no int := nullif(p ->> 'receive_no', '')::int;
  v_subject text := nullif(btrim(p ->> 'subject'), '');
  v_from text := nullif(btrim(p ->> 'from_org'), '');
  v_urgency smallint := coalesce(nullif(p ->> 'urgency', '')::smallint, 0);
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
      due_date, status, current_holder, created_by)
    values (v_year, v_no, nullif(btrim(p ->> 'doc_no'), ''), nullif(p ->> 'doc_date', '')::date, v_from,
      nullif(btrim(p ->> 'to_text'), ''), v_subject, v_urgency, coalesce((p ->> 'secret')::boolean, false),
      nullif(p ->> 'due_date', '')::date, 'registered', v_me, v_me)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'เลขรับ % มีแล้วในปี %', v_no, v_year;
  end;
  insert into saraban_actions (book_id, actor, action) values (v_id, v_me, 'register');
  return jsonb_build_object('id', v_id, 'year', v_year, 'receive_no', v_no);
end $$;

-- หนังสือปีนี้ที่เลขที่หนังสือตรงกัน (ไม่สนช่องว่าง/ตัวพิมพ์) — หน่วยงานเดียวกันขึ้นก่อน
create or replace function public.saraban_find_duplicates(p_doc_no text, p_from_org text)
returns table(id uuid, receive_no int, subject text, received_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(saraban_role(), '') not in ('director', 'clerk') then
    raise exception 'ไม่มีสิทธิ์';
  end if;
  return query
  select b.id, b.receive_no, b.subject, b.received_at
  from saraban_books b
  where b.year = saraban_year() and b.deleted_at is null and nullif(btrim(p_doc_no), '') is not null
    and lower(regexp_replace(b.doc_no, '\s', '', 'g')) = lower(regexp_replace(p_doc_no, '\s', '', 'g'))
  order by lower(regexp_replace(b.from_org, '\s', '', 'g')) = lower(regexp_replace(coalesce(p_from_org, ''), '\s', '', 'g')) desc,
    b.receive_no;
end $$;

-- รายชื่อหน่วยงานที่เคยส่งหนังสือ (ใช้บ่อยขึ้นก่อน) ไม่เกิน 10 รายการ
create or replace function public.saraban_org_suggestions(p_q text) returns setof text
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(saraban_role(), '') not in ('director', 'clerk') then
    raise exception 'ไม่มีสิทธิ์';
  end if;
  return query
  select b.from_org from saraban_books b
  where b.deleted_at is null and b.from_org ilike '%' || saraban_like_escape(coalesce(p_q, '')) || '%'
  group by b.from_org
  order by count(*) desc, b.from_org
  limit 10;
end $$;

-- อัปโหลดไฟล์ได้หรือไม่ (ตรวจก่อนออก URL อัปโหลด)
create or replace function public.saraban_can_upload(p_book uuid, p_kind text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when p_kind in ('original', 'attachment') then saraban_role() in ('director', 'clerk')
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

-- บันทึกไฟล์หลังอัปโหลดขึ้น Drive แล้ว (เรียกจากเซิร์ฟเวอร์เท่านั้น: service_role)
create or replace function public.saraban_add_file(p_book uuid, p_kind text, p_drive_file_id text, p_name text,
  p_size bigint, p_actor uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_version int;
begin
  perform 1 from saraban_books where id = p_book and deleted_at is null for update;
  if not found then raise exception 'ไม่พบหนังสือ'; end if;
  select coalesce(max(version), 0) + 1 into v_version from saraban_files where book_id = p_book and kind = p_kind;
  insert into saraban_files (book_id, kind, version, drive_file_id, name, size_bytes, created_by)
  values (p_book, p_kind, v_version, p_drive_file_id, p_name, p_size, p_actor)
  returning id into v_id;
  insert into saraban_actions (book_id, actor, action, note, file_id) values (p_book, p_actor, 'upload', p_kind, v_id);
  return v_id;
end $$;

-- เสนอ ผอ.
create or replace function public.saraban_propose(p_book uuid, p_note text, p_file uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := my_staff_id();
  v_book saraban_books;
  v_director uuid;
begin
  if coalesce(saraban_role(), '') not in ('director', 'clerk') then
    raise exception 'ไม่มีสิทธิ์เสนอหนังสือ';
  end if;
  select * into v_book from saraban_books where id = p_book and deleted_at is null for update;
  if not found then raise exception 'ไม่พบหนังสือ'; end if;
  if v_book.status <> 'registered' then
    raise exception 'สถานะหนังสือไม่ใช่ "ลงรับแล้ว" จึงเสนอไม่ได้';
  end if;
  if p_file is not null and not exists (select 1 from saraban_files where id = p_file and book_id = p_book) then
    raise exception 'ไฟล์ไม่ใช่ของหนังสือเล่มนี้';
  end if;
  select id into v_director from staff
  where saraban_role = 'director' and approved and active
  order by created_at, id limit 1;
  if v_director is null then
    raise exception 'ยังไม่ได้กำหนดผู้อำนวยการในระบบสารบรรณ';
  end if;
  update saraban_books set status = 'proposed', current_holder = v_director where id = p_book;
  insert into saraban_actions (book_id, actor, action, note, file_id, targets)
  values (p_book, v_me, 'propose', nullif(btrim(p_note), ''), p_file, array[v_director]);
end $$;

-- ผอ. เกษียน: 'head' ถึงหัวหน้ากลุ่มงาน 1 คน, 'teachers' มอบผู้รับโดยตรง, 'close' ปิดเรื่อง
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
  elsif p_route = 'close' then
    update saraban_books set status = 'closed', current_holder = null where id = p_book;
    insert into saraban_actions (book_id, actor, action, note, file_id)
    values (p_book, v_me, 'close', nullif(btrim(p_note), ''), p_file);
    return jsonb_build_object('line', false);
  else
    raise exception 'ไม่รู้จักการเกษียนแบบ %', p_route;
  end if;
end $$;

-- หัวหน้ากลุ่มงานมอบต่อให้บุคลากรในกลุ่มงานเดียวกัน (หัวหน้าเป็นผู้รับด้วย เพื่อยังเห็นหนังสือลับ)
create or replace function public.saraban_forward(p_book uuid, p_note text, p_targets uuid[], p_file uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := my_staff_id();
  v_book saraban_books;
  v_group text;
  v_targets uuid[] := coalesce((select array_agg(distinct t) from unnest(p_targets) t where t is not null), '{}');
begin
  if coalesce(saraban_role(), '') <> 'head' then
    raise exception 'ไม่มีสิทธิ์มอบต่อหนังสือ';
  end if;
  select * into v_book from saraban_books where id = p_book and deleted_at is null for update;
  if not found then raise exception 'ไม่พบหนังสือ'; end if;
  if v_book.current_holder is distinct from v_me then
    raise exception 'ไม่มีสิทธิ์: หนังสือเล่มนี้ไม่ได้อยู่ที่ท่าน';
  end if;
  if v_book.status <> 'endorsed' then
    raise exception 'สถานะหนังสือไม่อยู่ในขั้นรอมอบต่อ';
  end if;
  if p_file is not null and not exists (select 1 from saraban_files where id = p_file and book_id = p_book) then
    raise exception 'ไฟล์ไม่ใช่ของหนังสือเล่มนี้';
  end if;
  if cardinality(v_targets) = 0 then raise exception 'กรุณาเลือกผู้รับ'; end if;
  select work_group into v_group from staff where id = v_me;
  if exists (select 1 from unnest(v_targets) t where not exists (
    select 1 from staff s where s.id = t and s.approved and s.active and s.work_group = v_group
  )) then
    raise exception 'มอบต่อได้เฉพาะบุคลากรในกลุ่มงานของท่าน (มีผู้รับนอกกลุ่มงาน)';
  end if;

  insert into saraban_recipients (book_id, staff_id, assigned_by)
  select p_book, t, v_me from unnest(v_targets) t
  on conflict (book_id, staff_id) do nothing;
  insert into saraban_recipients (book_id, staff_id, assigned_by, read_at)
  values (p_book, v_me, v_me, now())
  on conflict (book_id, staff_id) do update set read_at = coalesce(saraban_recipients.read_at, now());
  update saraban_books set status = 'assigned', current_holder = null where id = p_book;
  insert into saraban_actions (book_id, actor, action, note, file_id, targets)
  values (p_book, v_me, 'forward', nullif(btrim(p_note), ''), p_file, v_targets);
end $$;

-- ผู้รับกดรับทราบ (บันทึกเวลาอ่านครั้งแรกเท่านั้น)
create or replace function public.saraban_mark_read(p_book uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := my_staff_id();
begin
  if v_me is null or not exists (
    select 1 from saraban_recipients r join saraban_books b on b.id = r.book_id
    where r.book_id = p_book and r.staff_id = v_me and b.deleted_at is null
  ) then
    raise exception 'ท่านไม่ได้รับมอบหมายหนังสือเล่มนี้';
  end if;
  update saraban_recipients set read_at = now()
  where book_id = p_book and staff_id = v_me and read_at is null;
  if found then
    insert into saraban_actions (book_id, actor, action) values (p_book, v_me, 'read');
  end if;
end $$;

-- ลบหนังสือ (soft delete) ต้องระบุเหตุผล
create or replace function public.saraban_delete(p_book uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := my_staff_id();
begin
  if coalesce(saraban_role(), '') not in ('director', 'clerk') then
    raise exception 'ไม่มีสิทธิ์ลบหนังสือ';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'กรุณาระบุเหตุผลที่ลบ';
  end if;
  update saraban_books set deleted_at = now(), deleted_reason = btrim(p_reason)
  where id = p_book and deleted_at is null;
  if not found then raise exception 'ไม่พบหนังสือ'; end if;
  insert into saraban_actions (book_id, actor, action, note) values (p_book, v_me, 'delete', btrim(p_reason));
end $$;

-- แก้เลขทะเบียนรับ (ไม่เลื่อนตัวนับ: การลงรับครั้งถัดไปจะข้ามเลขที่ถูกใช้แล้ว)
create or replace function public.saraban_renumber(p_book uuid, p_no int) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := my_staff_id();
  v_book saraban_books;
begin
  if coalesce(saraban_role(), '') not in ('director', 'clerk') then
    raise exception 'ไม่มีสิทธิ์แก้เลขรับ';
  end if;
  if p_no is null or p_no < 1 then raise exception 'เลขรับต้องมากกว่า 0'; end if;
  select * into v_book from saraban_books where id = p_book and deleted_at is null for update;
  if not found then raise exception 'ไม่พบหนังสือ'; end if;
  if v_book.receive_no = p_no then return; end if;
  -- ล็อกตัวนับของปีเพื่อเรียงลำดับกับการลงรับพร้อมกัน
  perform 1 from saraban_counters where year = v_book.year and kind = 'in' for update;
  if exists (select 1 from saraban_books where year = v_book.year and receive_no = p_no) then
    raise exception 'เลขรับ % มีแล้วในปี %', p_no, v_book.year;
  end if;
  begin
    update saraban_books set receive_no = p_no where id = p_book;
  exception when unique_violation then
    raise exception 'เลขรับ % มีแล้วในปี %', p_no, v_book.year;
  end;
  insert into saraban_actions (book_id, actor, action, note)
  values (p_book, v_me, 'renumber', format('เปลี่ยนเลขรับจาก %s เป็น %s', v_book.receive_no, p_no));
end $$;

-- รายการหนังสือ (security invoker: เห็นตาม RLS) เรียง: ด่วนก่อน กำหนดใกล้ก่อน (ไม่มีกำหนดท้าย) เลขรับล่าสุดก่อน
-- ตัวกรอง 'all' | 'todo' (ถือหนังสือหรือยังไม่อ่าน) | 'unread'
-- คำค้นใช้ expression เดียวกับ saraban_books_search_idx (และ receive_no_idx) เพื่อให้ใช้ดัชนีได้
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
  if v_filter not in ('all', 'todo', 'unread') then
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
      or (v_filter = 'todo' and (b.current_holder = v_me or (r.staff_id is not null and r.read_at is null))))
  order by b.urgency desc, b.due_date asc nulls last, b.year desc, b.receive_no desc
  limit 50 offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- รายละเอียดหนังสือ (security invoker: null ถ้ามองไม่เห็น)
create or replace function public.saraban_book(p_book uuid) returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'book', to_jsonb(b) || jsonb_build_object('holder_name',
      (select concat_ws(' ', s.prefix, s.first_name, nullif(s.last_name, '')) from staff s where s.id = b.current_holder)),
    'files', coalesce((
      select jsonb_agg(to_jsonb(f) order by f.kind, f.version) from saraban_files f where f.book_id = b.id
    ), '[]'::jsonb),
    'actions', coalesce((
      select jsonb_agg(to_jsonb(a) || jsonb_build_object('actor_name',
        case when s.id is not null then concat_ws(' ', s.prefix, s.first_name, nullif(s.last_name, '')) end) order by a.id)
      from saraban_actions a left join staff s on s.id = a.actor
      where a.book_id = b.id
    ), '[]'::jsonb),
    'recipients', coalesce((
      select jsonb_agg(jsonb_build_object(
        'staff_id', r.staff_id,
        'name', concat_ws(' ', s.prefix, s.first_name, nullif(s.last_name, '')),
        'read_at', r.read_at,
        'assigned_by', r.assigned_by,
        'assigned_at', r.assigned_at) order by s.first_name, s.last_name)
      from saraban_recipients r join staff s on s.id = r.staff_id
      where r.book_id = b.id
    ), '[]'::jsonb))
  from saraban_books b
  where b.id = p_book
$$;

-- รายชื่อบุคลากรสำหรับเลือกผู้รับ
create or replace function public.saraban_staff_options()
returns table(id uuid, name text, saraban_role text, work_group text)
language sql stable security definer set search_path = public as $$
  select s.id, concat_ws(' ', s.prefix, s.first_name, nullif(s.last_name, '')), s.saraban_role, s.work_group
  from staff s
  where s.approved and s.active and public.my_staff_id() is not null
  order by s.first_name, s.last_name
$$;

-- ผู้รับที่ยังไม่อ่านหนังสือที่ใกล้/เลยกำหนด (เรียกจากงานแจ้งเตือนฝั่งเซิร์ฟเวอร์เท่านั้น: service_role)
drop function if exists public.saraban_due_reminders();
create function public.saraban_due_reminders()
returns table(staff_id uuid, book_id uuid, subject text, due_date date, secret boolean)
language sql stable security definer set search_path = public as $$
  select r.staff_id, b.id, b.subject, b.due_date, b.secret
  from saraban_recipients r
  join saraban_books b on b.id = r.book_id
  join staff s on s.id = r.staff_id and s.active
  where r.read_at is null and b.deleted_at is null and b.status <> 'closed'
    and b.due_date is not null and b.due_date <= today_th() + 1
  order by b.due_date, b.id, r.staff_id
$$;

-- ---------- 9) สิทธิ์ตาราง ----------
grant select, insert, update, delete on public.saraban_books, public.saraban_files, public.saraban_actions,
  public.saraban_recipients, public.saraban_presets, public.saraban_counters, public.push_subscriptions
  to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
-- หนังสือ ไฟล์ ประวัติ และผู้รับ: อ่านผ่าน RLS เขียนผ่าน RPC (security definer) เท่านั้น
revoke insert, update, delete on public.saraban_books, public.saraban_files, public.saraban_actions,
  public.saraban_recipients from authenticated, anon;
revoke all on public.saraban_counters from authenticated, anon;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
-- เรียกได้เฉพาะเซิร์ฟเวอร์ (service_role): บันทึกไฟล์หลังอัปโหลดขึ้น Drive และรายการแจ้งเตือน
-- หมายเหตุ: migration ถัดไปที่ grant execute on all functions ต้อง revoke สองฟังก์ชันนี้ซ้ำ
revoke execute on function public.saraban_add_file(uuid, text, text, text, bigint, uuid) from public, anon, authenticated;
revoke execute on function public.saraban_due_reminders() from public, anon, authenticated;
grant execute on function public.saraban_add_file(uuid, text, text, text, bigint, uuid) to service_role;
grant execute on function public.saraban_due_reminders() to service_role;

-- ---------- 10) ข้อมูลของฉัน: เพิ่มบทบาทสารบรรณและกลุ่มงาน ----------
-- (เนื้อหาเดิมจาก 0002 เพิ่มคีย์ saraban_role, work_group — create or replace คงสิทธิ์ execute เดิมไว้)
create or replace function public.my_profile() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', s.id, 'prefix', s.prefix, 'first_name', s.first_name, 'last_name', s.last_name,
    'roles', s.roles, 'approved', s.approved, 'active', s.active,
    'font_scale', s.font_scale, 'tour_done', s.tour_done, 'email', s.email,
    'saraban_role', s.saraban_role, 'work_group', s.work_group,
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
