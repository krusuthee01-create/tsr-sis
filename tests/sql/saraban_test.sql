-- ทดสอบระบบสารบรรณอิเล็กทรอนิกส์: สิทธิ์การมองเห็นหนังสือและ RLS (ข้อมูลสมมติ)
\set ON_ERROR_STOP 1
-- ไฟล์ต้องรันซ้ำได้
\i supabase/migrations/0012_saraban.sql

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'director@example.com', '{"full_name":"ผอ. ใจดี"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'clerk@example.com', '{"full_name":"ธุรการ รับหนังสือ"}'),
  ('00000000-0000-0000-0000-0000000000a3', 'head@example.com', '{"full_name":"หัวหน้า วิชาการ"}'),
  ('00000000-0000-0000-0000-0000000000a4', 'head2@example.com', '{"full_name":"หัวหน้า งบประมาณ"}'),
  ('00000000-0000-0000-0000-0000000000a5', 'teacher1@example.com', '{"full_name":"ครู หนึ่ง"}'),
  ('00000000-0000-0000-0000-0000000000a6', 'teacher2@example.com', '{"full_name":"ครู สอง"}');
create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p::text, false); perform set_config('role', 'authenticated', false); end $$;
create function pg_temp.as_super() returns void language plpgsql as $$
begin perform set_config('role', 'postgres', false); end $$;
create function pg_temp.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin execute p_sql; raise exception 'คาดว่าจะ error แต่ไม่ error: %', p_sql;
exception when others then if sqlerrm not like p_like then raise exception 'error ไม่ตรง: % (ได้ %)', p_like, sqlerrm; end if; end $$;
create function pg_temp.uid(n int) returns uuid language sql as $$ select ('00000000-0000-0000-0000-0000000000a' || n)::uuid $$;

update public.staff set approved = true;
update public.staff set saraban_role = 'director' where email = 'director@example.com';
update public.staff set saraban_role = 'clerk' where email = 'clerk@example.com';
update public.staff set saraban_role = 'head', work_group = 'วิชาการ' where email = 'head@example.com';
update public.staff set saraban_role = 'head', work_group = 'งบประมาณ' where email = 'head2@example.com';
update public.staff set work_group = 'วิชาการ' where email = 'teacher1@example.com';

do $$ begin
  assert (select saraban_role from public.staff where email = 'teacher2@example.com') = 'teacher', 'ค่าเริ่มต้นเป็น teacher';
end $$;

-- หนังสือ A (ปกติ) และ B (ลับ) เพิ่มโดย superuser
insert into public.saraban_books (id, year, receive_no, from_org, subject, secret) values
  ('b0000000-0000-0000-0000-00000000000a', 2569, 1, 'สพป.', 'หนังสือปกติ', false),
  ('b0000000-0000-0000-0000-00000000000b', 2569, 2, 'สพป.', 'หนังสือลับ', true);
insert into public.saraban_files (id, book_id, kind, version, drive_file_id, name, size_bytes) values
  ('f0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000a', 'original', 1, 'drive-a', 'a.pdf', 100),
  ('f0000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-00000000000b', 'original', 1, 'drive-b', 'b.pdf', 100);
insert into public.saraban_recipients (book_id, staff_id)
select 'b0000000-0000-0000-0000-00000000000a', id from public.staff where email = 'teacher1@example.com';

-- สิทธิ์การมองเห็น
select pg_temp.as_user(pg_temp.uid(1));
do $$ begin assert (select count(*) from public.saraban_books) = 2, 'ผอ. เห็น 2 เล่ม'; end $$;
select pg_temp.as_user(pg_temp.uid(2));
do $$ begin assert (select count(*) from public.saraban_books) = 2, 'ธุรการเห็น 2 เล่ม'; end $$;
select pg_temp.as_user(pg_temp.uid(3));
do $$ begin
  assert (select count(*) from public.saraban_books) = 1, 'หัวหน้าเห็นเฉพาะหนังสือไม่ลับ';
  assert (select count(*) from public.saraban_books where secret) = 0;
  assert (select count(*) from public.saraban_files where book_id = 'b0000000-0000-0000-0000-00000000000b') = 0, 'หัวหน้าไม่เห็นไฟล์ของหนังสือลับ';
  assert (select count(*) from public.saraban_files) = 1;
end $$;
select pg_temp.as_user(pg_temp.uid(5));
do $$ begin assert (select count(*) from public.saraban_books) = 1, 'ครูที่เป็นผู้รับเห็น 1 เล่ม'; end $$;
select pg_temp.as_user(pg_temp.uid(6));
do $$ begin assert (select count(*) from public.saraban_books) = 0, 'ครูอื่นไม่เห็น'; end $$;

-- หัวหน้าถูกมอบหมายหนังสือลับ -> เห็นเพิ่ม
select pg_temp.as_super();
insert into public.saraban_recipients (book_id, staff_id)
select 'b0000000-0000-0000-0000-00000000000b', id from public.staff where email = 'head@example.com';
select pg_temp.as_user(pg_temp.uid(3));
do $$ begin assert (select count(*) from public.saraban_books) = 2, 'หัวหน้าเป็นผู้รับของ B แล้วเห็น 2'; end $$;

-- เขียนตรงไม่ได้ (ต้องผ่าน RPC)
select pg_temp.as_user(pg_temp.uid(2));
do $$
declare n int;
begin
  update public.saraban_books set subject = 'x';
  get diagnostics n = row_count;
  assert n = 0, 'ธุรการแก้ตรงต้องกระทบ 0 แถว';
end $$;
select pg_temp.expect_error($$insert into public.saraban_books (year, receive_no, from_org, subject) values (2569, 99, 'x', 'x')$$, '%row-level security%');
select pg_temp.expect_error($$select count(*) from public.saraban_counters$$, '%permission denied%');

-- ตั้งค่าข้อความสำเร็จรูป: ธุรการเขียนได้ ครูเขียนไม่ได้
insert into public.saraban_presets (role, text) values ('clerk', 'เพื่อโปรดพิจารณา');
select pg_temp.as_user(pg_temp.uid(5));
do $$ begin assert (select count(*) from public.saraban_presets) = 1, 'staff ทุกคนอ่าน preset ได้'; end $$;
select pg_temp.expect_error($$insert into public.saraban_presets (role, text) values ('clerk', 'x')$$, '%row-level security%');

-- หนังสือที่ถูกลบ (soft delete) ไม่ถูกมองเห็น
select pg_temp.as_super();
update public.saraban_books set deleted_at = now() where id = 'b0000000-0000-0000-0000-00000000000a';
select pg_temp.as_user(pg_temp.uid(1));
do $$ begin assert (select count(*) from public.saraban_books) = 1, 'หลังลบ A ผอ. เห็น 1'; end $$;
do $$ begin assert public.can_view_book('b0000000-0000-0000-0000-00000000000a') = false; end $$;

-- push_subscriptions: เจ้าของเท่านั้น
select pg_temp.as_super();
insert into public.push_subscriptions (endpoint, staff_id, p256dh, auth)
select 'https://push.example/1', id, 'k', 'a' from public.staff where email = 'teacher1@example.com';
select pg_temp.as_user(pg_temp.uid(6));
do $$ begin assert (select count(*) from public.push_subscriptions) = 0, 'ครูอื่นอ่าน subscription ไม่ได้'; end $$;
select pg_temp.as_user(pg_temp.uid(5));
do $$ begin assert (select count(*) from public.push_subscriptions) = 1; end $$;
