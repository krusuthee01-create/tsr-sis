-- =====================================================================
-- TSR-SIS เฟส 1 : โครงสร้างฐานข้อมูลหลัก
-- ทะเบียนนักเรียน, ทะเบียนครู, เช็กชื่อ/ดื่มนม/แปรงฟัน, ประวัติการแก้ไข, การตั้งค่า
-- รันบน Supabase (PostgreSQL 15+) ผ่าน SQL Editor หรือ `supabase db push`
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- การตั้งค่าโรงเรียน (มีแถวเดียว)
-- ---------------------------------------------------------------------
create table public.school_settings (
  id smallint primary key default 1 check (id = 1),
  school_name text not null default 'โรงเรียนอนุบาลเทพสุนทรินทร์',
  school_code text not null default '54010116',
  address text,
  director_name text,
  registrar_name text,
  current_year integer,
  edit_window_days smallint not null default 7 check (edit_window_days between 0 and 60),
  attendance_risk_percent numeric(5,2) not null default 80,
  updated_at timestamptz not null default now()
);
insert into public.school_settings (id) values (1);

-- ---------------------------------------------------------------------
-- ปีการศึกษา ภาคเรียน วันหยุด คาบเรียน
-- ---------------------------------------------------------------------
create table public.academic_years (
  year integer primary key check (year between 2500 and 2700),
  created_at timestamptz not null default now()
);

create table public.terms (
  id serial primary key,
  year integer not null references public.academic_years(year) on delete cascade,
  term smallint not null check (term in (1, 2)),
  start_date date not null,
  end_date date not null,
  check (end_date >= start_date),
  unique (year, term)
);

create table public.holidays (
  date date primary key,
  name text not null
);

create table public.periods (
  no smallint primary key check (no between 1 and 12),
  start_time time not null,
  end_time time not null,
  check (end_time > start_time)
);
insert into public.periods (no, start_time, end_time) values
  (1, '08:30', '09:30'), (2, '09:30', '10:30'), (3, '10:30', '11:30'),
  (4, '12:30', '13:30'), (5, '13:30', '14:30'), (6, '14:30', '15:30');

-- ---------------------------------------------------------------------
-- ระดับชั้น ห้องเรียน รายวิชา
-- ---------------------------------------------------------------------
create table public.grade_levels (
  code text primary key,              -- ตรงกับคอลัมน์ "ชั้น" ใน DMC เช่น อ.1, ป.6
  name text not null,
  sort smallint not null unique,
  is_kindergarten boolean not null,
  next_code text references public.grade_levels(code)
);
insert into public.grade_levels (code, name, sort, is_kindergarten, next_code) values
  ('ป.6', 'ประถมศึกษาปีที่ 6', 9, false, null);
insert into public.grade_levels (code, name, sort, is_kindergarten, next_code) values
  ('ป.5', 'ประถมศึกษาปีที่ 5', 8, false, 'ป.6');
insert into public.grade_levels (code, name, sort, is_kindergarten, next_code) values
  ('ป.4', 'ประถมศึกษาปีที่ 4', 7, false, 'ป.5');
insert into public.grade_levels (code, name, sort, is_kindergarten, next_code) values
  ('ป.3', 'ประถมศึกษาปีที่ 3', 6, false, 'ป.4');
insert into public.grade_levels (code, name, sort, is_kindergarten, next_code) values
  ('ป.2', 'ประถมศึกษาปีที่ 2', 5, false, 'ป.3');
insert into public.grade_levels (code, name, sort, is_kindergarten, next_code) values
  ('ป.1', 'ประถมศึกษาปีที่ 1', 4, false, 'ป.2');
insert into public.grade_levels (code, name, sort, is_kindergarten, next_code) values
  ('อ.3', 'อนุบาลปีที่ 3', 3, true, 'ป.1');
insert into public.grade_levels (code, name, sort, is_kindergarten, next_code) values
  ('อ.2', 'อนุบาลปีที่ 2', 2, true, 'อ.3');
insert into public.grade_levels (code, name, sort, is_kindergarten, next_code) values
  ('อ.1', 'อนุบาลปีที่ 1', 1, true, 'อ.2');

create table public.classrooms (
  id serial primary key,
  year integer not null references public.academic_years(year) on delete cascade,
  grade text not null references public.grade_levels(code),
  room smallint not null check (room between 1 and 20),
  unique (year, grade, room)
);

create table public.subjects (
  id serial primary key,
  code text not null unique,
  name text not null,
  grade text references public.grade_levels(code),
  hours_per_year numeric(6,1),
  learning_area text
);

-- ---------------------------------------------------------------------
-- ทะเบียนครูและบุคลากร
-- ---------------------------------------------------------------------
create table public.staff (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  prefix text,
  first_name text not null,
  last_name text not null default '',
  position text,               -- ตำแหน่ง เช่น ครู, ครูผู้ช่วย, ผู้อำนวยการ
  academic_rank text,          -- วิทยฐานะ
  learning_area text,          -- กลุ่มสาระ
  phone text,
  email text unique,           -- ใช้จับคู่กับบัญชี Google
  username text unique,        -- ใช้กับการล็อกอินด้วยชื่อผู้ใช้
  roles text[] not null default '{}'
    check (roles <@ array['admin','executive','health','guidance']::text[]),
  approved boolean not null default false,
  active boolean not null default true,
  font_scale numeric(3,2) not null default 1 check (font_scale between 0.8 and 1.5),
  tour_done boolean not null default false,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.homeroom_assignments (
  id serial primary key,
  classroom_id integer not null references public.classrooms(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  kind text not null default 'homeroom' check (kind in ('homeroom', 'assistant')),
  unique (classroom_id, staff_id)
);

create table public.teaching_assignments (
  id serial primary key,
  term_id integer not null references public.terms(id) on delete cascade,
  subject_id integer not null references public.subjects(id) on delete cascade,
  classroom_id integer not null references public.classrooms(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  unique (term_id, subject_id, classroom_id)
);

-- ---------------------------------------------------------------------
-- ทะเบียนนักเรียน
-- ---------------------------------------------------------------------
create table public.students (
  id uuid primary key default gen_random_uuid(),
  citizen_id text not null unique,          -- เลขประชาชน 13 หลัก หรือรหัส G
  student_code text,                        -- เลขประจำตัวนักเรียน
  prefix text,
  first_name text not null,
  last_name text not null,
  first_name_en text,
  last_name_en text,
  gender text check (gender in ('ช', 'ญ')),
  birth_date date,
  blood_group text,
  nationality text,
  religion text,
  father_name text,
  father_phone text,
  mother_name text,
  mother_phone text,
  guardian_name text,
  guardian_relation text,
  guardian_phone text,
  address_registered text,
  address_current text,
  weight_dmc numeric(5,1),
  height_dmc numeric(5,1),
  dmc_raw jsonb,                            -- ทุกคอลัมน์จาก DMC (ไม่แสดงต่อครูประจำวิชา)
  dmc_imported_at timestamptz,
  -- ข้อมูลที่ DMC ไม่มี ครูที่ปรึกษาแก้ได้
  nickname text,
  note text,
  status text not null default 'studying'
    check (status in ('studying','moved_out','dropped','graduated','suspended','long_absent','deceased')),
  status_date date,
  status_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index students_name_idx on public.students (first_name, last_name);
create index students_code_idx on public.students (student_code);

create table public.enrollments (
  student_id uuid not null references public.students(id) on delete cascade,
  year integer not null references public.academic_years(year) on delete cascade,
  classroom_id integer not null references public.classrooms(id) on delete cascade,
  number smallint,
  repeated boolean not null default false,
  primary key (student_id, year)
);
create index enrollments_classroom_idx on public.enrollments (classroom_id, number);

create table public.student_status_history (
  id bigserial primary key,
  student_id uuid not null references public.students(id) on delete cascade,
  from_status text,
  to_status text not null,
  effective_date date not null,
  reason text not null,
  changed_by uuid references public.staff(id),
  changed_at timestamptz not null default now()
);
create index student_status_history_student_idx on public.student_status_history (student_id);

-- ---------------------------------------------------------------------
-- เช็กชื่อ ดื่มนม แปรงฟัน
-- สถานะ: 0 มา, 1 สาย, 2 ลาป่วย, 3 ลากิจ, 4 ขาด
-- ---------------------------------------------------------------------
create table public.attendance_daily (
  student_id uuid not null references public.students(id) on delete cascade,
  date date not null,
  classroom_id integer not null references public.classrooms(id) on delete cascade,
  status smallint not null check (status between 0 and 4),
  recorded_by uuid references public.staff(id),
  recorded_at timestamptz not null default now(),
  primary key (student_id, date)
);
create index attendance_daily_class_date_idx on public.attendance_daily (classroom_id, date);

create table public.health_daily (
  student_id uuid not null references public.students(id) on delete cascade,
  date date not null,
  kind text not null check (kind in ('milk', 'brush')),
  classroom_id integer not null references public.classrooms(id) on delete cascade,
  done boolean not null,
  recorded_by uuid references public.staff(id),
  recorded_at timestamptz not null default now(),
  primary key (student_id, date, kind)
);
create index health_daily_class_date_idx on public.health_daily (classroom_id, date, kind);

create table public.attendance_subject (
  student_id uuid not null references public.students(id) on delete cascade,
  date date not null,
  period smallint not null references public.periods(no),
  subject_id integer not null references public.subjects(id) on delete restrict,
  classroom_id integer not null references public.classrooms(id) on delete cascade,
  status smallint not null check (status between 0 and 4),
  recorded_by uuid references public.staff(id),
  recorded_at timestamptz not null default now(),
  primary key (student_id, date, period)
);
create index attendance_subject_class_date_idx on public.attendance_subject (classroom_id, date);

-- ห้องไหนบันทึกอะไรไปแล้ว (ใช้แสดง "ห้องที่ยังไม่เช็กชื่อวันนี้" ได้ทันที)
create table public.record_sessions (
  classroom_id integer not null references public.classrooms(id) on delete cascade,
  date date not null,
  kind text not null check (kind in ('line', 'milk', 'brush')),
  saved_by uuid references public.staff(id),
  saved_at timestamptz not null default now(),
  primary key (classroom_id, date, kind)
);
create index record_sessions_date_idx on public.record_sessions (date);

-- ---------------------------------------------------------------------
-- ประวัติการแก้ไข
-- ---------------------------------------------------------------------
create table public.audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor uuid,
  actor_name text,
  table_name text not null,
  record_key text,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  note text
);
create index audit_log_at_idx on public.audit_log (at desc);
create index audit_log_table_idx on public.audit_log (table_name, record_key);
