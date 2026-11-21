-- ทดสอบตารางการเชื่อมต่อ Google Drive ของสารบรรณ (ข้อมูลสมมติ)
\set ON_ERROR_STOP 1
-- ไฟล์ต้องรันซ้ำได้
\i supabase/migrations/0013_saraban_drive_oauth.sql

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@example.com', '{"full_name":"ผู้ดูแล ทดสอบ"}');
update public.staff set approved = true, roles = '{admin}', saraban_role = 'director';
insert into public.saraban_drive_config (refresh_token, folder_id, account_email) values ('rt-secret', 'folder-x', 'a@example.com');

create function pg_temp.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin execute p_sql; raise exception 'คาดว่าจะ error แต่ไม่ error: %', p_sql;
exception when others then if sqlerrm not like p_like then raise exception 'error ไม่ตรง: % (ได้ %)', p_like, sqlerrm; end if; end $$;

do $$ begin
  assert not has_table_privilege('authenticated', 'public.saraban_drive_config', 'select'), 'authenticated ต้องอ่านตารางนี้ไม่ได้';
  assert not has_table_privilege('anon', 'public.saraban_drive_config', 'select'), 'anon ต้องอ่านตารางนี้ไม่ได้';
  assert has_table_privilege('service_role', 'public.saraban_drive_config', 'select'), 'service_role ต้องอ่านได้';
  assert not exists (select 1 from pg_trigger where tgrelid = 'public.saraban_drive_config'::regclass and not tgisinternal),
    'ห้ามมี trigger (refresh token จะไปอยู่ใน audit_log)';
end $$;

-- แม้ภายหลังเผลอ grant ให้ authenticated (เช่น grant on all tables) RLS ที่ไม่มี policy ยังกันไว้
grant select on public.saraban_drive_config to authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
set role authenticated;
do $$ begin assert (select count(*) from public.saraban_drive_config) = 0, 'ผู้ดูแลระบบก็ต้องอ่าน refresh token ไม่ได้'; end $$;
reset role;

-- มีได้แถวเดียว
select pg_temp.expect_error($$insert into public.saraban_drive_config (id, refresh_token, folder_id) values (2, 'x', 'y')$$, '%check%');
