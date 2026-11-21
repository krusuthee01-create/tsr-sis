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
  ('b0000000-0000-0000-0000-00000000000a', 2500, 1, 'สพป.', 'หนังสือปกติ', false),
  ('b0000000-0000-0000-0000-00000000000b', 2500, 2, 'สพป.', 'หนังสือลับ', true);
insert into public.saraban_files (id, book_id, kind, version, drive_file_id, name, size_bytes) values
  ('f0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000a', 'original', 1, 'drive-a', 'a.pdf', 100),
  ('f0000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-00000000000b', 'original', 1, 'drive-b', 'b.pdf', 100);
insert into public.saraban_recipients (book_id, staff_id)
select 'b0000000-0000-0000-0000-00000000000a', id from public.staff where email = 'teacher1@example.com';
-- หนังสือลับมีผู้รับ (ผอ.) และประวัติอยู่แล้ว เพื่อทดสอบว่าหัวหน้าที่ไม่ได้รับมอบไม่เห็น
insert into public.saraban_recipients (book_id, staff_id)
select 'b0000000-0000-0000-0000-00000000000b', id from public.staff where email = 'director@example.com';
insert into public.saraban_actions (book_id, action) values ('b0000000-0000-0000-0000-00000000000b', 'register');

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
  assert (select count(*) from public.saraban_actions where book_id = 'b0000000-0000-0000-0000-00000000000b') = 0, 'หัวหน้าไม่เห็นประวัติของหนังสือลับ';
  assert (select count(*) from public.saraban_recipients where book_id = 'b0000000-0000-0000-0000-00000000000b') = 0, 'หัวหน้าไม่เห็นผู้รับของหนังสือลับ';
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
do $$ begin
  assert (select count(*) from public.saraban_books) = 2, 'หัวหน้าเป็นผู้รับของ B แล้วเห็น 2';
  assert (select count(*) from public.saraban_actions where book_id = 'b0000000-0000-0000-0000-00000000000b') = 1, 'ได้รับมอบแล้วเห็นประวัติ';
  assert (select count(*) from public.saraban_recipients where book_id = 'b0000000-0000-0000-0000-00000000000b') = 2, 'ได้รับมอบแล้วเห็นผู้รับ';
end $$;

-- เขียนตรงไม่ได้ (ต้องผ่าน RPC)
select pg_temp.as_user(pg_temp.uid(2));
select pg_temp.expect_error($$update public.saraban_books set subject = 'x'$$, '%permission denied%');
select pg_temp.expect_error($$insert into public.saraban_books (year, receive_no, from_org, subject) values (2500, 99, 'x', 'x')$$, '%permission denied%');
select pg_temp.expect_error($$delete from public.saraban_recipients$$, '%permission denied%');
select pg_temp.expect_error($$insert into public.saraban_actions (book_id, action) values ('b0000000-0000-0000-0000-00000000000a', 'read')$$, '%permission denied%');
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

-- =====================================================================
-- RPC ขั้นตอนงาน: ลงรับ เสนอ เกษียน มอบต่อ รับทราบ ลบ แก้เลข ค้นหา
-- =====================================================================
create function pg_temp.sid(n int) returns uuid language sql as $$ select id from public.staff where user_id = pg_temp.uid(n) $$;
create function pg_temp.put(k text, v text) returns void language plpgsql as $$ begin perform set_config('t.' || k, v, false); end $$;
create function pg_temp.get(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
create function pg_temp.yr() returns int language sql as $$ select extract(year from public.today_th())::int + 543 $$;
create function pg_temp.reg(p_subject text, p_extra jsonb default '{}') returns jsonb language sql as
$$ select public.saraban_register(jsonb_build_object('doc_no', 'ศธ 0001/1', 'from_org', 'สพป. เขต 1', 'subject', p_subject) || p_extra) $$;

-- เลขทะเบียนรับ
select pg_temp.as_user(pg_temp.uid(2));
do $$
declare r jsonb;
begin
  r := pg_temp.reg('ทดสอบ หนึ่ง');
  assert (r->>'receive_no')::int = 1, 'เล่มแรกได้เลข 1';
  assert (r->>'year')::int = pg_temp.yr(), 'ปี พ.ศ. ปัจจุบัน';
  perform pg_temp.put('b1', r->>'id');
  r := pg_temp.reg('ทดสอบ สอง');
  assert (r->>'receive_no')::int = 2, 'เล่มสองได้เลข 2';
  perform pg_temp.put('b2', r->>'id');
  r := pg_temp.reg('ทดสอบ กำหนดเลขเอง', '{"receive_no": 10}');
  assert (r->>'receive_no')::int = 10, 'กำหนดเลข 10 เอง';
  r := pg_temp.reg('ทดสอบ ต่อจากเลขที่กำหนด');
  assert (r->>'receive_no')::int = 11, 'ต่อจาก 10 เป็น 11';
  assert (select status from public.saraban_books where id = pg_temp.get('b1')) = 'registered';
  assert (select current_holder from public.saraban_books where id = pg_temp.get('b1')) = pg_temp.sid(2), 'ผู้ลงรับถือหนังสือ';
  assert (select count(*) from public.saraban_actions where book_id = pg_temp.get('b1') and action = 'register') = 1;
end $$;
select pg_temp.expect_error($$select public.saraban_renumber(pg_temp.get('b2'), 10)$$, '%เลขรับ 10 มีแล้ว%');
select pg_temp.expect_error($$select pg_temp.reg('ซ้ำ', '{"receive_no": 10}')$$, '%เลขรับ 10 มีแล้ว%');
select public.saraban_renumber(pg_temp.get('b2'), 5);
do $$ begin
  assert (select receive_no from public.saraban_books where id = pg_temp.get('b2')) = 5, 'แก้เลขเป็น 5';
  assert (select count(*) from public.saraban_actions where book_id = pg_temp.get('b2') and action = 'renumber') = 1;
end $$;

-- ตัวนับของปีก่อนไม่กระทบปีนี้
select pg_temp.as_super();
insert into public.saraban_counters values (pg_temp.yr() - 1, 'in', 1500);
select pg_temp.as_user(pg_temp.uid(2));
do $$ begin assert (pg_temp.reg('ทดสอบ ข้ามปี')->>'receive_no')::int = 12, 'ต่อจากเลขของปีนี้'; end $$;

select pg_temp.as_user(pg_temp.uid(5));
select pg_temp.expect_error($$select pg_temp.reg('ครูลงรับ')$$, '%ไม่มีสิทธิ์%');
select pg_temp.expect_error($$select public.saraban_renumber(pg_temp.get('b1'), 99)$$, '%ไม่มีสิทธิ์%');
select pg_temp.expect_error($$select public.saraban_propose(pg_temp.get('b1'), null, null)$$, '%ไม่มีสิทธิ์%');
select pg_temp.expect_error($$select * from public.saraban_find_duplicates('ศธ 0001/1', null)$$, '%ไม่มีสิทธิ์%');

-- หาหนังสือซ้ำ (ไม่สนช่องว่าง/ตัวพิมพ์) และรายชื่อหน่วยงาน
select pg_temp.as_user(pg_temp.uid(2));
do $$ begin
  assert (select count(*) from public.saraban_find_duplicates(' ศธ0001/1 ', 'สพป. เขต 1')) = 5, 'พบ 5 เล่มที่เลขที่หนังสือตรงกัน';
  assert (select count(*) from public.saraban_find_duplicates('ศธ 9999/9', null)) = 0;
  assert (select array_agg(x) from public.saraban_org_suggestions('เขต') x) = array['สพป. เขต 1'], 'หน่วยงานไม่ซ้ำ';
end $$;

-- ขั้นตอนเต็ม (หนังสือลับ): ลงรับ -> เสนอ -> เกษียนถึงหัวหน้า -> มอบต่อครู -> รับทราบ
do $$
declare r jsonb;
begin
  r := pg_temp.reg('เรื่องลับ', '{"secret": true}');
  perform pg_temp.put('flow', r->>'id');
  assert public.saraban_can_upload(pg_temp.get('flow'), 'stamped'), 'ธุรการประทับตรารับได้';
  assert public.saraban_can_upload(pg_temp.get('flow'), 'original');
  perform public.saraban_propose(pg_temp.get('flow'), 'เพื่อโปรดพิจารณา', null);
  assert (select status from public.saraban_books where id = pg_temp.get('flow')) = 'proposed';
  assert (select current_holder from public.saraban_books where id = pg_temp.get('flow')) = pg_temp.sid(1), 'ส่งถึง ผอ.';
  assert not public.saraban_can_upload(pg_temp.get('flow'), 'stamped'), 'ธุรการแก้ตราหลังเสนอไม่ได้';
end $$;
select pg_temp.expect_error($$select public.saraban_propose(pg_temp.get('flow'), null, null)$$, '%สถานะ%');
select pg_temp.as_user(pg_temp.uid(5));
do $$ begin assert not public.saraban_can_upload(pg_temp.get('flow'), 'original'), 'ครูอัปโหลดไม่ได้'; end $$;
select pg_temp.as_user(pg_temp.uid(3));
select pg_temp.expect_error($$select public.saraban_endorse(pg_temp.get('flow'), 'head', null, array[pg_temp.sid(3)], null)$$, '%ไม่มีสิทธิ์%');
select pg_temp.as_user(pg_temp.uid(1));
select pg_temp.expect_error($$select public.saraban_endorse(pg_temp.get('flow'), 'head', null, array[pg_temp.sid(5)], null)$$, '%หัวหน้า%');
do $$
declare r jsonb;
begin
  assert public.saraban_can_upload(pg_temp.get('flow'), 'stamped'), 'ผอ. เกษียนได้';
  r := public.saraban_endorse(pg_temp.get('flow'), 'head', 'มอบงานวิชาการ', array[pg_temp.sid(3)], null);
  assert (r->>'line')::boolean, 'ส่ง LINE';
  assert (select status from public.saraban_books where id = pg_temp.get('flow')) = 'endorsed';
  assert (select current_holder from public.saraban_books where id = pg_temp.get('flow')) = pg_temp.sid(3);
end $$;
select pg_temp.as_user(pg_temp.uid(4));
do $$ begin
  assert (select count(*) from public.saraban_books where id = pg_temp.get('flow')) = 0, 'หัวหน้าอื่นไม่เห็นหนังสือลับ';
  assert not public.saraban_can_upload(pg_temp.get('flow'), 'stamped');
end $$;
select pg_temp.expect_error($$select public.saraban_forward(pg_temp.get('flow'), null, array[pg_temp.sid(5)], null)$$, '%ไม่มีสิทธิ์%');
select pg_temp.as_user(pg_temp.uid(3));
do $$ begin
  assert (select count(*) from public.saraban_books where id = pg_temp.get('flow')) = 1, 'หัวหน้าที่ถือหนังสือลับเห็นหนังสือ';
  assert public.saraban_can_upload(pg_temp.get('flow'), 'stamped'), 'หัวหน้าที่ถือหนังสือเกษียนได้';
  assert not public.saraban_can_upload(pg_temp.get('flow'), 'original');
  assert (select count(*) from public.saraban_inbox(null, 'todo', 0) where id = pg_temp.get('flow')) = 1, 'อยู่ในงานของหัวหน้า';
end $$;
select pg_temp.expect_error($$select public.saraban_forward(pg_temp.get('flow'), null, array[pg_temp.sid(6)], null)$$, '%นอกกลุ่มงาน%');
select pg_temp.expect_error($$select public.saraban_forward(pg_temp.get('flow'), null, '{}', null)$$, '%เลือก%');
select public.saraban_forward(pg_temp.get('flow'), 'ดำเนินการ', array[pg_temp.sid(5)], null);
do $$ begin
  assert (select status from public.saraban_books where id = pg_temp.get('flow')) = 'assigned';
  assert (select count(*) from public.saraban_books where id = pg_temp.get('flow')) = 1, 'หัวหน้ายังเห็นหนังสือลับหลังมอบต่อ';
  assert not public.saraban_can_upload(pg_temp.get('flow'), 'stamped'), 'มอบแล้วแก้ตราไม่ได้';
end $$;
select pg_temp.as_user(pg_temp.uid(5));
do $$ begin
  assert (select count(*) from public.saraban_inbox(null, 'unread', 0)) = 1, 'ครูมีหนังสือยังไม่อ่าน 1 เล่ม';
  assert (select count(*) from public.saraban_inbox(null, 'todo', 0)) = 1;
  assert (select bool_and(unread) from public.saraban_inbox(null, 'all', 0));
end $$;
select public.saraban_mark_read(pg_temp.get('flow'));
select pg_temp.put('read_at', (select read_at::text from public.saraban_recipients where book_id = pg_temp.get('flow') and staff_id = pg_temp.sid(5)));
select public.saraban_mark_read(pg_temp.get('flow'));
do $$
declare b jsonb := public.saraban_book(pg_temp.get('flow'));
begin
  assert (select read_at from public.saraban_recipients where book_id = pg_temp.get('flow') and staff_id = pg_temp.sid(5)) is not null, 'บันทึกเวลาอ่าน';
  assert (select read_at::text from public.saraban_recipients where book_id = pg_temp.get('flow') and staff_id = pg_temp.sid(5)) = current_setting('t.read_at'), 'อ่านซ้ำไม่เปลี่ยนเวลา';
  assert (select count(*) from public.saraban_inbox(null, 'unread', 0)) = 0;
  assert (select count(*) from public.saraban_inbox(null, 'all', 0)) = 1, 'ครูเห็นเฉพาะเล่มที่ได้รับมอบ';
  assert (select id from public.saraban_inbox(null, 'all', 0)) = pg_temp.get('flow');
  assert b->'book'->>'subject' = 'เรื่องลับ';
  assert jsonb_array_length(b->'actions') = 5, 'saraban_book แสดงประวัติ 5 รายการ';
  assert b->'actions'->0->>'actor_name' is not null, 'มีชื่อผู้ทำ';
  assert jsonb_array_length(b->'recipients') = 2, 'ผู้รับ: ครูและหัวหน้า';
  assert (select count(*) from jsonb_array_elements(b->'recipients') e where e->>'name' = 'ครู หนึ่ง' and e->>'read_at' is not null) = 1;
end $$;
select pg_temp.as_super();
do $$ begin
  assert (select array_agg(action order by id) from public.saraban_actions where book_id = pg_temp.get('flow'))
    = array['register', 'propose', 'endorse', 'forward', 'read'], 'ประวัติครบ 5 ขั้น';
end $$;
select pg_temp.as_user(pg_temp.uid(6));
select pg_temp.expect_error($$select public.saraban_mark_read(pg_temp.get('flow'))$$, '%ไม่ได้รับมอบหมาย%');
do $$ begin assert public.saraban_book(pg_temp.get('flow')) is null, 'คนที่ไม่เกี่ยวข้องอ่านรายละเอียดไม่ได้'; end $$;

-- เกษียนถึงครูโดยตรง และปิดเรื่อง
select pg_temp.as_user(pg_temp.uid(2));
do $$ begin
  perform pg_temp.put('tch', pg_temp.reg('ประชุมครู')->>'id');
  perform public.saraban_propose(pg_temp.get('tch'), null, null);
  perform pg_temp.put('cls', pg_temp.reg('แจ้งเพื่อทราบ')->>'id');
  perform public.saraban_propose(pg_temp.get('cls'), null, null);
end $$;
select pg_temp.as_user(pg_temp.uid(1));
do $$
declare r jsonb;
begin
  r := public.saraban_endorse(pg_temp.get('tch'), 'teachers', 'ทราบ', array[pg_temp.sid(6)], null);
  assert (r->>'line')::boolean;
  assert (select status from public.saraban_books where id = pg_temp.get('tch')) = 'assigned';
  assert (select count(*) from public.saraban_recipients where book_id = pg_temp.get('tch') and staff_id = pg_temp.sid(6)) = 1;
  r := public.saraban_endorse(pg_temp.get('cls'), 'close', 'ทราบ', '{}', null);
  assert not (r->>'line')::boolean, 'ปิดเรื่องไม่ส่ง LINE';
  assert (select status from public.saraban_books where id = pg_temp.get('cls')) = 'closed';
end $$;
select pg_temp.expect_error($$select public.saraban_endorse(pg_temp.get('cls'), 'close', null, '{}', null)$$, '%สถานะ%');
select pg_temp.expect_error($$select public.saraban_endorse(pg_temp.get('b1'), 'close', null, '{}', null)$$, '%สถานะ%');
select pg_temp.expect_error($$select public.saraban_endorse(pg_temp.get('tch'), 'nope', null, '{}', null)$$, '%สถานะ%');
-- ผอ. ลงรับเองแล้วเกษียนได้ทันที
do $$
declare v uuid;
begin
  v := (pg_temp.reg('ผอ. ลงรับเอง')->>'id')::uuid;
  perform public.saraban_endorse(v, 'close', null, '{}', null);
  assert (select status from public.saraban_books where id = v) = 'closed';
end $$;

-- ไฟล์: เพิ่มได้เฉพาะ service_role
select pg_temp.as_user(pg_temp.uid(2));
select pg_temp.expect_error($$select public.saraban_add_file(pg_temp.get('b1'), 'original', 'drive-x', 'x.pdf', 1, pg_temp.sid(2))$$, '%permission denied%');
select pg_temp.expect_error($$select * from public.saraban_due_reminders()$$, '%permission denied%');
select set_config('role', 'service_role', false);
do $$
declare f1 uuid; f2 uuid;
begin
  f1 := public.saraban_add_file(pg_temp.get('b1'), 'original', 'drive-r1', 'r1.pdf', 10, pg_temp.sid(2));
  f2 := public.saraban_add_file(pg_temp.get('b1'), 'original', 'drive-r2', 'r1-2.pdf', 10, pg_temp.sid(2));
  assert (select version from public.saraban_files where id = f2) = 2, 'version เพิ่มทีละ 1';
  perform pg_temp.put('f1', f1::text);
  assert (select count(*) from public.saraban_actions
          where book_id = pg_temp.get('b1') and action = 'upload' and actor = pg_temp.sid(2) and note = 'original') = 2,
    'บันทึกการอัปโหลดในประวัติ';
  assert (select file_id from public.saraban_actions where book_id = pg_temp.get('b1') and action = 'upload' order by id desc limit 1) = f2;
end $$;
-- กันการ grant ซ้ำโดยไม่ตั้งใจ: authenticated ต้องเรียกสองฟังก์ชันนี้ไม่ได้
select pg_temp.as_super();
do $$ begin
  assert not has_function_privilege('authenticated', 'public.saraban_add_file(uuid, text, text, text, bigint, uuid)', 'execute'), 'authenticated เรียก add_file ไม่ได้';
  assert not has_function_privilege('authenticated', 'public.saraban_due_reminders()', 'execute'), 'authenticated เรียก due_reminders ไม่ได้';
  assert not has_function_privilege('anon', 'public.saraban_add_file(uuid, text, text, text, bigint, uuid)', 'execute');
  assert has_function_privilege('service_role', 'public.saraban_add_file(uuid, text, text, text, bigint, uuid)', 'execute');
  assert has_function_privilege('service_role', 'public.saraban_due_reminders()', 'execute');
end $$;
select pg_temp.as_user(pg_temp.uid(2));
select public.saraban_propose(pg_temp.get('b1'), 'แนบตรารับ', pg_temp.get('f1'));
select pg_temp.expect_error($$select public.saraban_propose(pg_temp.get('b2'), null, pg_temp.get('f1'))$$, '%ไฟล์%');

-- แจ้งเตือนครบกำหนด (ครูสองยังไม่อ่าน)
select pg_temp.as_super();
update public.saraban_books set due_date = public.today_th() where id = pg_temp.get('tch');
select set_config('role', 'service_role', false);
do $$ begin
  assert (select count(*) from public.saraban_due_reminders() where book_id = pg_temp.get('tch') and staff_id = pg_temp.sid(6)) = 1, 'เตือนครูที่ยังไม่อ่าน';
end $$;
-- ผู้ถือหนังสือขั้นถัดไป (b1 เสนอ ผอ. แล้ว) ได้รับการเตือนด้วย ไม่ซ้ำแม้เป็นผู้รับที่ยังไม่อ่าน
select pg_temp.as_super();
update public.saraban_books set due_date = public.today_th() + 1 where id = pg_temp.get('b1');
do $$ begin assert not exists (select 1 from public.saraban_recipients where book_id = pg_temp.get('b1') and staff_id = pg_temp.sid(1)); end $$;
insert into public.saraban_recipients (book_id, staff_id) values (pg_temp.get('b1'), pg_temp.sid(1));
select set_config('role', 'service_role', false);
do $$ begin
  assert (select count(*) from public.saraban_due_reminders() where book_id = pg_temp.get('b1') and staff_id = pg_temp.sid(1)) = 1, 'เตือน ผอ. ที่ถือหนังสือ (แถวเดียว)';
  assert (select bool_and(secret is not null) from public.saraban_due_reminders()), 'มีคอลัมน์ secret';
end $$;
select pg_temp.as_super();
delete from public.saraban_recipients where book_id = pg_temp.get('b1') and staff_id = pg_temp.sid(1);
update public.saraban_books set due_date = public.today_th() + 2 where id = pg_temp.get('b1');
select set_config('role', 'service_role', false);
do $$ begin
  assert (select count(*) from public.saraban_due_reminders() where book_id = pg_temp.get('b1')) = 0, 'ยังไม่ใกล้กำหนดไม่เตือน';
end $$;
select pg_temp.as_super();
update public.saraban_books set due_date = null where id = pg_temp.get('b1');

-- ค้นหาและเรียงลำดับ
select pg_temp.as_user(pg_temp.uid(2));
do $$ begin perform pg_temp.reg('ทดสอบ ด่วนที่สุด', '{"urgency": 3}'); end $$;
do $$ begin
  assert (select count(*) from public.saraban_inbox('ทดสอบ', 'all', 0)) > 0;
  assert (select bool_and(subject like '%ทดสอบ%') from public.saraban_inbox('ทดสอบ', 'all', 0)), 'คืนเฉพาะเล่มที่มีคำค้น';
  assert (select count(*) from public.saraban_inbox('ทดสอบ', 'all', 0))
    = (select count(*) from public.saraban_books where subject like '%ทดสอบ%' and deleted_at is null);
  assert (select max(total) from public.saraban_inbox('ทดสอบ', 'all', 0)) = (select count(*) from public.saraban_inbox('ทดสอบ', 'all', 0)), 'total = จำนวนทั้งหมด';
  assert (select urgency from public.saraban_inbox('ทดสอบ', 'all', 0) limit 1) = 3, 'ด่วนที่สุดขึ้นก่อน';
  assert (select urgency from public.saraban_inbox(null, 'all', 0) limit 1) = 3;
  assert (select count(*) from public.saraban_inbox('11', 'all', 0) where receive_no = 11) = 1, 'ค้นด้วยเลขรับ';
  assert (select count(*) from public.saraban_inbox('สพป. เขต', 'all', 0)) > 1, 'ค้นด้วยหน่วยงาน';
  assert (select count(*) from public.saraban_inbox('100%', 'all', 0)) = 0, 'อักขระพิเศษไม่เป็น wildcard';
  assert (select count(*) from public.saraban_staff_options()) = 6;
end $$;
select pg_temp.expect_error($$select * from public.saraban_inbox(null, 'nope', 0)$$, '%ตัวกรอง%');
-- ความเร่งด่วนเท่ากัน: กำหนดเสร็จใกล้ขึ้นก่อน ไม่มีกำหนดอยู่ท้าย
do $$ begin
  -- ลงรับสลับลำดับ เพื่อไม่ให้ผ่านเพราะเรียงตามเลขรับโดยบังเอิญ
  perform pg_temp.reg('เรียงกำหนด หนึ่งวัน', jsonb_build_object('urgency', 2, 'due_date', public.today_th() + 1));
  perform pg_temp.reg('เรียงกำหนด ไม่มีกำหนด', '{"urgency": 2}');
  perform pg_temp.reg('เรียงกำหนด ห้าวัน', jsonb_build_object('urgency', 2, 'due_date', public.today_th() + 5));
  assert (select array_agg(subject) from public.saraban_inbox('เรียงกำหนด', 'all', 0))
    = array['เรียงกำหนด หนึ่งวัน', 'เรียงกำหนด ห้าวัน', 'เรียงกำหนด ไม่มีกำหนด'], 'เรียงตามกำหนดเสร็จ ไม่มีกำหนดอยู่ท้าย';
end $$;

-- ลบหนังสือ
select pg_temp.as_user(pg_temp.uid(5));
select pg_temp.expect_error($$select public.saraban_delete(pg_temp.get('b2'), 'ซ้ำ')$$, '%ไม่มีสิทธิ์%');
select pg_temp.as_user(pg_temp.uid(2));
select pg_temp.expect_error($$select public.saraban_delete(pg_temp.get('b2'), '  ')$$, '%เหตุผล%');
select public.saraban_delete(pg_temp.get('b2'), 'ลงรับซ้ำ');
do $$ begin
  assert (select count(*) from public.saraban_books where id = pg_temp.get('b2')) = 0, 'ลบแล้วไม่เห็น';
  assert not public.saraban_can_upload(pg_temp.get('b2'), 'original'), 'ลบแล้วอัปโหลดไม่ได้';
end $$;
select pg_temp.expect_error($$select public.saraban_delete(pg_temp.get('b2'), 'อีกครั้ง')$$, '%ไม่พบ%');
select pg_temp.as_super();
do $$ begin
  assert (select deleted_reason from public.saraban_books where id = pg_temp.get('b2')) = 'ลงรับซ้ำ';
  assert (select count(*) from public.saraban_actions where book_id = pg_temp.get('b2') and action = 'delete') = 1;
end $$;

-- ลงรับต่อเนื่อง 20 ครั้ง ได้เลขไม่ซ้ำ
select pg_temp.as_user(pg_temp.uid(2));
do $$
declare nos int[] := '{}';
begin
  for i in 1..20 loop
    nos := nos || (pg_temp.reg('รอบ ' || i)->>'receive_no')::int;
  end loop;
  assert (select count(distinct n) from unnest(nos) n) = 20, 'เลขไม่ซ้ำ 20 เลข';
end $$;

-- my_profile() มีบทบาทสารบรรณและกลุ่มงาน
select pg_temp.as_user(pg_temp.uid(3));
do $$ begin
  assert public.my_profile() ->> 'saraban_role' = 'head', 'my_profile มี saraban_role';
  assert public.my_profile() ->> 'work_group' = 'วิชาการ', 'my_profile มี work_group';
end $$;
select pg_temp.as_user(pg_temp.uid(6));
do $$ begin
  assert public.my_profile() ->> 'saraban_role' = 'teacher';
  assert public.my_profile() -> 'work_group' = 'null'::jsonb;
end $$;

-- saraban_set_role: สิทธิ์ ตรวจค่า และต้องมีผู้อำนวยการอย่างน้อย 1 คน
select pg_temp.as_user(pg_temp.uid(5));
select pg_temp.expect_error($q$select public.saraban_set_role(pg_temp.uid(6)::text::uuid, 'clerk', null)$q$, 'เฉพาะผู้ดูแลระบบ%');
select pg_temp.as_super();
select pg_temp.as_user(pg_temp.uid(1));
select pg_temp.expect_error($q$select public.saraban_set_role((select id from public.staff where email = 'teacher2@example.com'), 'boss', null)$q$, 'บทบาทไม่ถูกต้อง');
select pg_temp.expect_error($q$select public.saraban_set_role((select id from public.staff where email = 'teacher2@example.com'), 'head', '  ')$q$, 'หัวหน้ากลุ่มงานต้องระบุ%');
select pg_temp.expect_error($q$select public.saraban_set_role((select id from public.staff where email = 'director@example.com'), 'teacher', null)$q$, 'ต้องมีผู้อำนวยการ%');
select pg_temp.expect_error($q$select public.saraban_set_role('00000000-0000-0000-0000-000000000000', 'clerk', null)$q$, 'ไม่พบครู%');
select public.saraban_set_role((select id from public.staff where email = 'teacher2@example.com'), 'head', ' บุคคล ');
select pg_temp.as_super();
do $$ begin
  assert (select saraban_role || '|' || work_group from public.staff where email = 'teacher2@example.com') = 'head|บุคคล';
  assert exists (select 1 from public.audit_log where table_name = 'staff' and actor = pg_temp.uid(1)
    and record_key = (select id::text from public.staff where email = 'teacher2@example.com')
    and new_data ->> 'saraban_role' = 'head' and old_data ->> 'saraban_role' = 'teacher'), 'บันทึกประวัติพร้อมผู้ทำจริง';
end $$;
select pg_temp.as_user(pg_temp.uid(6));
select pg_temp.expect_error($q$select public.saraban_set_role(pg_temp.uid(5)::text::uuid, 'clerk', null)$q$, 'เฉพาะผู้ดูแลระบบ%');
select pg_temp.as_super();

-- ประวัติการแก้ไขของตาราง saraban_*: ผู้บริหาร SIS ที่ไม่ใช่ ผอ./ธุรการสารบรรณ ต้องไม่เห็น (กันเรื่องหนังสือลับรั่ว)
select pg_temp.as_super();
update public.staff set roles = array['executive'] where email = 'teacher2@example.com';
update public.staff set saraban_role = 'teacher' where email = 'teacher2@example.com';
update public.staff set roles = array['admin'] where email in ('director@example.com', 'clerk@example.com');
do $$ begin
  assert (select count(*) from public.audit_log where table_name like 'saraban\_%') > 0, 'มีประวัติของตารางสารบรรณ';
  assert (select count(*) from public.audit_log where table_name not like 'saraban\_%') > 0, 'มีประวัติของตารางอื่น';
end $$;
select pg_temp.as_user(pg_temp.uid(6));
do $$ begin
  assert (select count(*) from public.audit_log where table_name like 'saraban\_%') = 0, 'ผู้บริหาร SIS (ครูในสารบรรณ) ไม่เห็นประวัติสารบรรณ';
  assert (select count(*) from public.audit_log where table_name not like 'saraban\_%') > 0, 'แต่ยังเห็นประวัติตารางอื่นตามเดิม';
end $$;
select pg_temp.as_user(pg_temp.uid(1));
do $$ begin assert (select count(*) from public.audit_log where table_name like 'saraban\_%') > 0, 'ผอ. สารบรรณ + admin เห็น'; end $$;
select pg_temp.as_user(pg_temp.uid(2));
do $$ begin assert (select count(*) from public.audit_log where table_name like 'saraban\_%') > 0, 'ธุรการ + admin เห็น'; end $$;
select pg_temp.as_user(pg_temp.uid(3));
do $$ begin assert (select count(*) from public.audit_log) = 0, 'ไม่มีบทบาท admin/executive ไม่เห็นเลย'; end $$;
select pg_temp.as_super();
