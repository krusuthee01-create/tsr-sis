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
    check (action in ('register', 'propose', 'endorse', 'forward', 'close', 'read', 'renumber', 'delete')),
  note text,
  file_id uuid references public.saraban_files(id),
  targets uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

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
-- คนอื่นเห็นเมื่อเป็นผู้รับหรือผู้ลงทะเบียน; หนังสือที่ลบแล้วไม่มีใครเห็น
create or replace function public.can_view_book(p_book uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from saraban_books b
    where b.id = p_book and b.deleted_at is null and my_staff_id() is not null and (
      saraban_role() in ('director', 'clerk')
      or (saraban_role() = 'head' and not b.secret)
      or b.created_by = my_staff_id()
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

-- ---------- 8) สิทธิ์ตาราง ----------
grant select, insert, update, delete on public.saraban_books, public.saraban_files, public.saraban_actions,
  public.saraban_recipients, public.saraban_presets, public.saraban_counters, public.push_subscriptions
  to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
revoke all on public.saraban_counters from authenticated, anon;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
