-- ทดสอบ 0014: ชนิดหนังสือ อ้างถึง รายละเอียด และ ผอ. ส่งคืนธุรการ (ข้อมูลสมมติ)
\set ON_ERROR_STOP 1
-- ไฟล์ต้องรันซ้ำได้
\i supabase/migrations/0014_saraban_school_practice.sql

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'director@example.com', '{"full_name":"ผอ. ใจดี"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'clerk@example.com', '{"full_name":"ธุรการ รับหนังสือ"}'),
  ('00000000-0000-0000-0000-0000000000a5', 'teacher1@example.com', '{"full_name":"ครู หนึ่ง"}');
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

-- ลงรับพร้อมชนิดหนังสือ อ้างถึง รายละเอียด
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
insert into t select 'b', (public.saraban_register('{"from_org":"สพป.แพร่ เขต 1","subject":"ทดสอบ","doc_type":"internal","ref_text":"หนังสือที่ ศธ 04109/ว1","detail":"สาระสำคัญ"}') ->> 'id')::uuid;
do $$ begin
  assert (select doc_type from public.saraban_books where id = (select v from t where k = 'b')) = 'internal';
  assert (select ref_text from public.saraban_books where id = (select v from t where k = 'b')) = 'หนังสือที่ ศธ 04109/ว1';
  assert (select detail from public.saraban_books where id = (select v from t where k = 'b')) = 'สาระสำคัญ';
end $$;
-- ไม่ระบุ = หนังสือภายนอก, ชนิดแปลก = error
insert into t select 'b2', (public.saraban_register('{"from_org":"สพป.","subject":"ทดสอบ 2"}') ->> 'id')::uuid;
do $$ begin assert (select doc_type from public.saraban_books where id = (select v from t where k = 'b2')) = 'external'; end $$;
select pg_temp.expect_error($$select public.saraban_register('{"from_org":"x","subject":"y","doc_type":"bogus"}')$$, '%ชนิดหนังสือไม่ถูกต้อง%');

-- เสนอ ผอ. → ผอ. ส่งคืนธุรการ → กลับขั้นลงรับ ผู้ถือ = ธุรการ → เสนอใหม่ได้
select public.saraban_propose((select v from t where k = 'b'), 'เรียน ผอ.', null);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_error($$select public.saraban_endorse((select v from t where k = 'b'), 'return', '  ', '{}', null)$$, '%เหตุผล%');
do $$ declare r jsonb; begin
  r := public.saraban_endorse((select v from t where k = 'b'), 'return', 'ขอเอกสารแนบเพิ่ม', '{}', null);
  assert r ->> 'line' = 'false', 'ส่งคืนไม่แจ้ง LINE';
  assert (select status from public.saraban_books where id = (select v from t where k = 'b')) = 'registered';
  assert (select current_holder from public.saraban_books where id = (select v from t where k = 'b'))
    = (select id from public.staff where email = 'clerk@example.com'), 'คืนให้ผู้เสนอ';
  assert exists (select 1 from public.saraban_actions where book_id = (select v from t where k = 'b') and action = 'return' and note = 'ขอเอกสารแนบเพิ่ม');
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select public.saraban_propose((select v from t where k = 'b'), 'เสนอใหม่', null);
do $$ begin assert (select status from public.saraban_books where id = (select v from t where k = 'b')) = 'proposed'; end $$;

-- ครูส่งคืนไม่ได้
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a5');
select pg_temp.expect_error($$select public.saraban_endorse((select v from t where k = 'b'), 'return', 'x', '{}', null)$$, '%ไม่มีสิทธิ์%');
