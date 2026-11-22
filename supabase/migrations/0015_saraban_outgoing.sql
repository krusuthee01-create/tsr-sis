-- =====================================================================
-- TSR-SIS: สารบรรณ — ทะเบียนหนังสือส่ง / คำสั่ง / ประกาศ
-- - หนังสือส่ง (letter) และหนังสือเวียน (circular) ใช้เลขชุดเดียวกัน: ศธ 04109.84/123, ศธ 04109.84/ว 123
-- - คำสั่ง (order) และประกาศ (announce) แยกชุด: 1/2569, 2/2569 …
-- - เลขเริ่ม 1 ใหม่ทุกปีปฏิทิน พ.ศ. ออกโดยฐานข้อมูล (ไม่ชนกันเมื่อขอพร้อมกัน)
-- - บุคลากรทุกคนขอเลขได้ · ยกเลิกเลขเฉพาะ ผอ./ธุรการ (เลขที่ยกเลิกยังอยู่ในทะเบียน)
-- - หนังสือลับเห็นเฉพาะ ผอ. ธุรการ และผู้ขอเลข
-- =====================================================================

-- เลขที่หนังสือของโรงเรียน (ส่วนหน้าเลขหนังสือส่ง) แก้ได้โดย ผอ./ธุรการ
alter table public.school_settings add column if not exists saraban_prefix text not null default 'ศธ 04109.84';

create table if not exists public.saraban_outgoing (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('letter', 'circular', 'order', 'announce')),
  series text not null check (series in ('out', 'order', 'announce')),  -- ชุดเลข (letter/circular ใช้ 'out')
  year int not null,
  seq int not null,
  doc_no text not null,                     -- เลขที่ตามรูปแบบ ณ เวลาออก
  doc_date date not null,
  to_text text,                             -- ถึง (หนังสือส่ง)
  subject text not null,
  secret boolean not null default false,
  note text,
  requested_by uuid not null references public.staff(id),
  deleted_at timestamptz,                   -- ยกเลิกเลข
  deleted_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (series, year, seq)
);
create index if not exists saraban_outgoing_list_idx on public.saraban_outgoing (series, year, seq desc);

create table if not exists public.saraban_out_files (
  id uuid primary key default gen_random_uuid(),
  out_id uuid not null references public.saraban_outgoing(id),
  version int not null,
  drive_file_id text not null unique,
  name text not null,
  size_bytes bigint not null,
  created_by uuid references public.staff(id),
  created_at timestamptz not null default now(),
  unique (out_id, version)
);
create index if not exists saraban_out_files_out_idx on public.saraban_out_files (out_id);

-- เห็นรายการนี้ได้หรือไม่: ผอ./ธุรการเห็นทุกรายการ (รวมที่ยกเลิก) · คนอื่นเห็นรายการที่ไม่ลับและไม่ถูกยกเลิก · ผู้ขอเห็นของตนเสมอ
create or replace function public.can_view_out(p_out uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from saraban_outgoing o
    where o.id = p_out and my_staff_id() is not null and (
      saraban_role() in ('director', 'clerk')
      or o.requested_by = my_staff_id()
      or (o.deleted_at is null and not o.secret)
    )
  )
$$;

alter table public.saraban_outgoing enable row level security;
alter table public.saraban_out_files enable row level security;
drop policy if exists saraban_outgoing_read on public.saraban_outgoing;
create policy saraban_outgoing_read on public.saraban_outgoing for select to authenticated using (public.can_view_out(id));
drop policy if exists saraban_out_files_read on public.saraban_out_files;
create policy saraban_out_files_read on public.saraban_out_files for select to authenticated using (public.can_view_out(out_id));

do $$
declare t text;
begin
  foreach t in array array['saraban_outgoing', 'saraban_out_files'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_trigger()', t || '_audit', t);
  end loop;
  drop trigger if exists saraban_outgoing_touch on public.saraban_outgoing;
  create trigger saraban_outgoing_touch before update on public.saraban_outgoing
    for each row execute function public.touch_updated_at();
end $$;

-- ออกเลข: {"id", "doc_no", "seq", "year"} — p: kind, doc_date, to_text, subject, secret, note
create or replace function public.saraban_out_issue(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := my_staff_id();
  v_kind text := coalesce(nullif(p ->> 'kind', ''), 'letter');
  v_series text;
  v_year int := saraban_year();
  v_seq int;
  v_prefix text;
  v_doc_no text;
  v_subject text := nullif(btrim(p ->> 'subject'), '');
  v_date date := coalesce(nullif(p ->> 'doc_date', '')::date, today_th());
  v_id uuid;
begin
  if v_me is null then raise exception 'ไม่มีสิทธิ์ขอเลขหนังสือ'; end if;
  if v_kind not in ('letter', 'circular', 'order', 'announce') then raise exception 'ชนิดหนังสือไม่ถูกต้อง'; end if;
  if v_subject is null then raise exception 'กรุณากรอกเรื่อง'; end if;
  v_series := case when v_kind in ('letter', 'circular') then 'out' else v_kind end;

  -- ล็อกแถวตัวนับของชุดเลข (ขอพร้อมกันได้เลขต่างกัน)
  insert into saraban_counters (year, kind, last_no) values (v_year, v_series, 1)
  on conflict (year, kind) do update set last_no = saraban_counters.last_no + 1
  returning last_no into v_seq;

  select coalesce(nullif(btrim(saraban_prefix), ''), 'ศธ 04109.84') into v_prefix from school_settings where id = 1;
  v_doc_no := case v_kind
    when 'letter' then format('%s/%s', v_prefix, v_seq)
    when 'circular' then format('%s/ว %s', v_prefix, v_seq)
    else format('%s/%s', v_seq, v_year) end;

  insert into saraban_outgoing (kind, series, year, seq, doc_no, doc_date, to_text, subject, secret, note, requested_by)
  values (v_kind, v_series, v_year, v_seq, v_doc_no, v_date, nullif(btrim(p ->> 'to_text'), ''), v_subject,
    coalesce((p ->> 'secret')::boolean, false), nullif(btrim(p ->> 'note'), ''), v_me)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'doc_no', v_doc_no, 'seq', v_seq, 'year', v_year);
end $$;

-- แก้รายละเอียด (ไม่เปลี่ยนเลข): ผู้ขอ หรือ ผอ./ธุรการ
create or replace function public.saraban_out_update(p_out uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := my_staff_id();
  v_row saraban_outgoing;
  v_subject text := nullif(btrim(p ->> 'subject'), '');
begin
  select * into v_row from saraban_outgoing where id = p_out and deleted_at is null for update;
  if not found then raise exception 'ไม่พบรายการ'; end if;
  if not (v_row.requested_by = v_me or coalesce(saraban_role(), '') in ('director', 'clerk')) then
    raise exception 'ไม่มีสิทธิ์แก้ไขรายการนี้';
  end if;
  if v_subject is null then raise exception 'กรุณากรอกเรื่อง'; end if;
  update saraban_outgoing set
    subject = v_subject,
    to_text = nullif(btrim(p ->> 'to_text'), ''),
    doc_date = coalesce(nullif(p ->> 'doc_date', '')::date, doc_date),
    secret = coalesce((p ->> 'secret')::boolean, secret),
    note = nullif(btrim(p ->> 'note'), '')
  where id = p_out;
end $$;

-- ยกเลิกเลข (ยังอยู่ในทะเบียนพร้อมเหตุผล): ผอ./ธุรการ
create or replace function public.saraban_out_cancel(p_out uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(saraban_role(), '') not in ('director', 'clerk') then raise exception 'ไม่มีสิทธิ์ยกเลิกเลขหนังสือ'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'กรุณาระบุเหตุผลที่ยกเลิก'; end if;
  update saraban_outgoing set deleted_at = now(), deleted_reason = btrim(p_reason) where id = p_out and deleted_at is null;
  if not found then raise exception 'ไม่พบรายการ'; end if;
end $$;

-- แนบสำเนาได้หรือไม่: ผู้ขอ หรือ ผอ./ธุรการ และยังไม่ถูกยกเลิก
create or replace function public.saraban_out_can_upload(p_out uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from saraban_outgoing o
    where o.id = p_out and o.deleted_at is null and my_staff_id() is not null
      and (o.requested_by = my_staff_id() or saraban_role() in ('director', 'clerk'))
  )
$$;

-- บันทึกสำเนาหลังอัปโหลดขึ้น Drive (เซิร์ฟเวอร์เท่านั้น: service_role)
create or replace function public.saraban_out_add_file(p_out uuid, p_drive_file_id text, p_name text, p_size bigint, p_actor uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_version int;
begin
  perform 1 from saraban_outgoing where id = p_out and deleted_at is null for update;
  if not found then raise exception 'ไม่พบรายการ'; end if;
  select coalesce(max(version), 0) + 1 into v_version from saraban_out_files where out_id = p_out;
  insert into saraban_out_files (out_id, version, drive_file_id, name, size_bytes, created_by)
  values (p_out, v_version, p_drive_file_id, p_name, p_size, p_actor)
  returning id into v_id;
  return v_id;
end $$;

-- ตั้งเลขที่หนังสือของโรงเรียน: ผอ./ธุรการ
create or replace function public.saraban_set_prefix(p_prefix text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(saraban_role(), '') not in ('director', 'clerk') then raise exception 'ไม่มีสิทธิ์แก้ไข'; end if;
  if nullif(btrim(p_prefix), '') is null or length(btrim(p_prefix)) > 40 then raise exception 'เลขที่หนังสือของโรงเรียนไม่ถูกต้อง'; end if;
  update school_settings set saraban_prefix = btrim(p_prefix) where id = 1;
end $$;

-- ---------- สิทธิ์ ----------
grant select on public.saraban_outgoing, public.saraban_out_files to authenticated;
grant select, insert, update, delete on public.saraban_outgoing, public.saraban_out_files to service_role;
revoke insert, update, delete on public.saraban_outgoing, public.saraban_out_files from authenticated, anon;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
-- เรียกได้เฉพาะเซิร์ฟเวอร์ (ทำซ้ำเพราะ grant บรรทัดบนครอบทุกฟังก์ชัน)
revoke execute on function public.saraban_add_file(uuid, text, text, text, bigint, uuid) from public, anon, authenticated;
revoke execute on function public.saraban_due_reminders() from public, anon, authenticated;
revoke execute on function public.saraban_out_add_file(uuid, text, text, bigint, uuid) from public, anon, authenticated;
grant execute on function public.saraban_add_file(uuid, text, text, text, bigint, uuid) to service_role;
grant execute on function public.saraban_due_reminders() to service_role;
grant execute on function public.saraban_out_add_file(uuid, text, text, bigint, uuid) to service_role;
