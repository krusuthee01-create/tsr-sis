-- ทดสอบ 0016: บันทึกข้อความภายใน (ข้อมูลสมมติ)
\set ON_ERROR_STOP 1
-- ไฟล์ต้องรันซ้ำได้
\i supabase/migrations/0016_saraban_memo.sql

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'director@example.com', '{"full_name":"ผอ. ใจดี"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'clerk@example.com', '{"full_name":"ธุรการ รับหนังสือ"}'),
  ('00000000-0000-0000-0000-0000000000a5', 'teacher1@example.com', '{"full_name":"ครู หนึ่ง"}'),
  ('00000000-0000-0000-0000-0000000000a6', 'teacher2@example.com', '{"full_name":"ครู สอง"}');
create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p::text, false); perform set_config('role', 'authenticated', false); end $$;
create function pg_temp.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin execute p_sql; raise exception 'คาดว่าจะ error แต่ไม่ error: %', p_sql;
exception when others then if sqlerrm not like p_like then raise exception 'error ไม่ตรง: % (ได้ %)', p_like, sqlerrm; end if; end $$;
update public.staff set approved = true;
update public.staff set saraban_role = 'director' where email = 'director@example.com';
update public.staff set saraban_role = 'clerk' where email = 'clerk@example.com';
create temp table t (k text primary key, v uuid);
grant all on t to authenticated;

-- ครูเขียนบันทึกข้อความ → เลขบันทึก ศธ 04109.84/บ 1 + หนังสือรับ อยู่ที่ธุรการ
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a5');
do $$ declare r jsonb; begin
  r := public.saraban_memo_create('{"subject":"ขออนุญาตพานักเรียนไปแข่งขัน","to_text":"ผู้อำนวยการโรงเรียน"}');
  assert r ->> 'doc_no' = 'ศธ 04109.84/บ 1', r::text;
  insert into t values ('b', (r ->> 'book_id')::uuid);
  r := public.saraban_memo_create('{"subject":"บันทึกที่สอง"}');
  assert r ->> 'doc_no' = 'ศธ 04109.84/บ 2', r::text;
end $$;
select pg_temp.expect_error($$select public.saraban_memo_create('{"subject":" "}')$$, '%กรุณากรอกเรื่อง%');
do $$ begin
  assert (select doc_type || '|' || status from public.saraban_books where id = (select v from t where k = 'b')) = 'internal|registered';
  assert (select current_holder from public.saraban_books where id = (select v from t where k = 'b'))
    = (select id from public.staff where email = 'clerk@example.com'), 'อยู่ที่ธุรการ';
  assert (select count(*) from public.saraban_outgoing where series = 'memo' and book_id = (select v from t where k = 'b')) = 1, 'อยู่ในทะเบียนบันทึกข้อความ';
  -- ผู้เขียนแนบต้นฉบับได้ แต่ประทับตรา/ลงนามแทนธุรการไม่ได้
  assert public.saraban_can_upload((select v from t where k = 'b'), 'original');
  assert not public.saraban_can_upload((select v from t where k = 'b'), 'stamped');
  assert (select count(*) from public.saraban_inbox(null, 'mine', 0)) = 2, 'บันทึกของฉัน';
end $$;

-- ครูคนอื่นไม่เห็น และแนบไฟล์ไม่ได้
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a6');
do $$ begin
  assert (select count(*) from public.saraban_books where id = (select v from t where k = 'b')) = 0;
  assert not public.saraban_can_upload((select v from t where k = 'b'), 'original');
end $$;

-- ธุรการเห็นในงานของฉัน แล้วเสนอ ผอ. ตามขั้นตอนเดิม · ผู้เขียนแนบต้นฉบับไม่ได้อีกหลังพ้นขั้นลงรับ
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
do $$ begin assert exists (select 1 from public.saraban_inbox(null, 'todo', 0) where id = (select v from t where k = 'b')), 'ธุรการเห็นในงานของฉัน'; end $$;
select public.saraban_propose((select v from t where k = 'b'), 'เรียน ผอ.', null);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a5');
do $$ begin
  assert not public.saraban_can_upload((select v from t where k = 'b'), 'original');
  assert (select status from public.saraban_books where id = (select v from t where k = 'b')) = 'proposed', 'ผู้เขียนเห็นสถานะ';
end $$;
