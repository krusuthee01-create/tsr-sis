-- ทดสอบ 0015: ทะเบียนหนังสือส่ง/คำสั่ง/ประกาศ (ข้อมูลสมมติ)
\set ON_ERROR_STOP 1
-- ไฟล์ต้องรันซ้ำได้
\i supabase/migrations/0015_saraban_outgoing.sql

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'director@example.com', '{"full_name":"ผอ. ใจดี"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'clerk@example.com', '{"full_name":"ธุรการ รับหนังสือ"}'),
  ('00000000-0000-0000-0000-0000000000a5', 'teacher1@example.com', '{"full_name":"ครู หนึ่ง"}'),
  ('00000000-0000-0000-0000-0000000000a6', 'teacher2@example.com', '{"full_name":"ครู สอง"}');
create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p::text, false); perform set_config('role', 'authenticated', false); end $$;
create function pg_temp.as_super() returns void language plpgsql as $$
begin perform set_config('role', 'postgres', false); end $$;
create function pg_temp.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin execute p_sql; raise exception 'คาดว่าจะ error แต่ไม่ error: %', p_sql;
exception when others then if sqlerrm not like p_like then raise exception 'error ไม่ตรง: % (ได้ %)', p_like, sqlerrm; end if; end $$;
update public.staff set approved = true;
update public.staff set saraban_role = 'director' where email = 'director@example.com';
update public.staff set saraban_role = 'clerk' where email = 'clerk@example.com';
create temp table t (k text primary key, v uuid);
grant all on t to authenticated;

do $$ begin assert (select saraban_prefix from public.school_settings where id = 1) = 'ศธ 04109.84', 'ค่าเริ่มต้นเลขที่หนังสือ'; end $$;

-- ครูขอเลขได้: หนังสือส่งและหนังสือเวียนใช้ชุดเดียวกัน คำสั่ง/ประกาศแยกชุด
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a5');
do $$ declare r jsonb; begin
  r := public.saraban_out_issue('{"kind":"letter","subject":"ขอความอนุเคราะห์","to_text":"ผอ.สพป.แพร่ เขต 1"}');
  assert r ->> 'doc_no' = 'ศธ 04109.84/1', r::text;
  insert into t values ('letter', (r ->> 'id')::uuid);
  r := public.saraban_out_issue('{"kind":"circular","subject":"แจ้งผู้ปกครอง"}');
  assert r ->> 'doc_no' = 'ศธ 04109.84/ว 2', r::text;
  r := public.saraban_out_issue('{"kind":"order","subject":"แต่งตั้งคณะกรรมการ"}');
  assert r ->> 'doc_no' = '1/' || public.saraban_year(), r::text;
  r := public.saraban_out_issue('{"kind":"announce","subject":"รับสมัครนักเรียน"}');
  assert r ->> 'doc_no' = '1/' || public.saraban_year(), r::text;
  r := public.saraban_out_issue('{"kind":"letter","subject":"ลับ","secret":true}');
  insert into t values ('secret', (r ->> 'id')::uuid);
end $$;
select pg_temp.expect_error($$select public.saraban_out_issue('{"kind":"letter","subject":"  "}')$$, '%กรุณากรอกเรื่อง%');
select pg_temp.expect_error($$select public.saraban_out_issue('{"kind":"bogus","subject":"x"}')$$, '%ชนิดหนังสือ%');
-- ขอเลขต่อเนื่องไม่ซ้ำ
do $$ begin
  for i in 1..20 loop perform public.saraban_out_issue('{"kind":"letter","subject":"วน"}'); end loop;
  assert (select count(distinct seq) from public.saraban_outgoing where series = 'out') = 23;
end $$;

-- ครูสองเห็นรายการไม่ลับ แต่ไม่เห็นหนังสือลับของครูหนึ่ง และแก้/ยกเลิกไม่ได้
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a6');
do $$ begin
  assert (select count(*) from public.saraban_outgoing where id = (select v from t where k = 'letter')) = 1;
  assert (select count(*) from public.saraban_outgoing where secret) = 0, 'หนังสือลับไม่รั่ว';
end $$;
select pg_temp.expect_error($$select public.saraban_out_update((select v from t where k = 'letter'), '{"subject":"แก้"}')$$, '%ไม่มีสิทธิ์%');
select pg_temp.expect_error($$select public.saraban_out_cancel((select v from t where k = 'letter'), 'x')$$, '%ไม่มีสิทธิ์%');
select pg_temp.expect_error($$insert into public.saraban_outgoing (kind, series, year, seq, doc_no, doc_date, subject, requested_by) values ('letter','out',1,1,'x',now(),'x',public.my_staff_id())$$, '%permission denied%');
do $$ begin assert not public.saraban_out_can_upload((select v from t where k = 'letter')); end $$;

-- ผู้ขอแก้ได้และแนบสำเนาได้
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a5');
select public.saraban_out_update((select v from t where k = 'letter'), '{"subject":"ขอความอนุเคราะห์ (แก้)","to_text":"ผอ.สพป.แพร่ เขต 1"}');
do $$ begin
  assert (select subject from public.saraban_outgoing where id = (select v from t where k = 'letter')) = 'ขอความอนุเคราะห์ (แก้)';
  assert public.saraban_out_can_upload((select v from t where k = 'letter'));
  assert not has_function_privilege('authenticated', 'public.saraban_out_add_file(uuid, text, text, bigint, uuid)', 'execute');
  assert not has_function_privilege('authenticated', 'public.saraban_add_file(uuid, text, text, text, bigint, uuid)', 'execute');
end $$;

-- ธุรการยกเลิกเลข: ยังเห็นในทะเบียน (ธุรการ) แต่ครูอื่นไม่เห็น ไฟล์แนบเพิ่มไม่ได้
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select pg_temp.expect_error($$select public.saraban_out_cancel((select v from t where k = 'letter'), ' ')$$, '%เหตุผล%');
select public.saraban_out_cancel((select v from t where k = 'letter'), 'ออกเลขซ้ำ');
do $$ begin
  assert (select deleted_reason from public.saraban_outgoing where id = (select v from t where k = 'letter')) = 'ออกเลขซ้ำ';
  assert not public.saraban_out_can_upload((select v from t where k = 'letter'));
  assert (select count(*) from public.saraban_outgoing where secret) = 1, 'ธุรการเห็นหนังสือลับ';
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a6');
do $$ begin assert (select count(*) from public.saraban_outgoing where id = (select v from t where k = 'letter')) = 0, 'เลขที่ยกเลิกไม่แสดงต่อครูอื่น'; end $$;

-- ตั้งเลขที่หนังสือ: เฉพาะ ผอ./ธุรการ
select pg_temp.expect_error($$select public.saraban_set_prefix('ศธ 1')$$, '%ไม่มีสิทธิ์%');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select public.saraban_set_prefix('ศธ 04109.99');
do $$ declare r jsonb; begin
  r := public.saraban_out_issue('{"kind":"letter","subject":"ทดสอบเลขใหม่"}');
  assert r ->> 'doc_no' like 'ศธ 04109.99/%', r::text;
end $$;
