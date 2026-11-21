# e-Saraban เฟส 1 (ทะเบียนรับ เกษียน มอบหมาย ติดตามการอ่าน) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เพิ่มโมดูลสารบรรณที่ `/sis/saraban` ให้ธุรการลงรับหนังสือพร้อม PDF, ผอ. เกษียนบนมือถือ, หัวหน้ามอบต่อ, ครูรับทราบ — เร็ว ปลอดภัย ฟรี

**Architecture:** ข้อมูลและสิทธิ์อยู่ใน Supabase (ตาราง `saraban_*` + RLS + RPC `security definer` ที่ตรวจบทบาทจาก `auth.uid()`). PDF อยู่ใน Google Shared Drive: เซิร์ฟเวอร์เปิด resumable session ให้เบราว์เซอร์อัปโหลดตรง แล้วยืนยันไฟล์ก่อนบันทึก; การเปิดดูผ่าน route ที่ตรวจสิทธิ์และ cache แบบ immutable. ตรา/คำเกษียนวาดบน canvas ×3 แล้วฝังด้วย pdf-lib ในเบราว์เซอร์.

**Tech Stack:** Next.js 15 App Router, React 19, Supabase (PostgreSQL 16, RLS, Storage), Google Drive API v3 (REST + service account JWT ด้วย `node:crypto`), pdf-lib, qrcode, web-push, LINE Messaging API, Playwright

**Spec:** `docs/superpowers/specs/2026-11-21-esaraban-design.md`

## Global Constraints

- ทุกหน้าอยู่ใต้ basePath `/sis`; ลิงก์ที่ไม่ใช่ `next/link`/`redirect` ใช้ `withBase()` จาก `src/lib/base-path.ts`
- ค่าใช้จ่าย 0 บาท: ห้ามเพิ่มบริการที่มีค่าใช้จ่าย; dependency ใหม่ที่อนุญาต: `pdf-lib@1.17.1`, `qrcode@1.5.4`, `web-push@3.6.7`, `@types/qrcode`, `@types/web-push`
- ห้ามส่ง secret ไป client: `GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY`, `SARABAN_DRIVE_FOLDER_ID`, `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_GROUP_ID`, `VAPID_PRIVATE_KEY`, `CRON_SECRET` อ่านจาก `process.env` ฝั่งเซิร์ฟเวอร์เท่านั้น
- บทบาทสารบรรณ: `'director' | 'clerk' | 'head' | 'teacher'` ค่าเริ่มต้น `'teacher'`
- ชั้นความเร็ว `urgency smallint`: 0 ปกติ, 1 ด่วน, 2 ด่วนมาก, 3 ด่วนที่สุด
- เลขรับ: ต่อปีปฏิทิน พ.ศ. ตามวันที่ `Asia/Bangkok` (`extract(year from today_th()) + 543`)
- รายการหนังสือ: หน้าละ 50 เรียง `urgency desc, due_date asc nulls last, receive_no desc`
- canvas ตรา/คำเกษียน scale = 3
- LINE: 1 ข้อความต่อเล่ม ส่งเมื่อ ผอ. สั่งการเท่านั้น; หนังสือลับแสดง "หนังสือลับ" แทนชื่อเรื่อง
- Cache ไฟล์: `Cache-Control: private, max-age=31536000, immutable`
- ลบ = soft delete (`deleted_at`) เท่านั้น
- ข้อความ UI เป็นภาษาไทย ตามสไตล์หน้าที่มีอยู่ (`PageHeader`, `Card`, `toast`)
- ห้ามใช้ข้อมูลจริงในเทสต์

## Review Focus

1. **หนังสือลับ + หัวหน้ากลุ่มงาน** — หัวหน้าที่ไม่ได้รับมอบหมายต้องไม่เห็นหนังสือลับทั้งในรายการ, `/book/:id`, `/api/file/:id`, ข้อความ LINE (ทดสอบใน Task 1, 3, 4)
2. **ลงรับพร้อมกันสองเครื่อง** — สองคำสั่งพร้อมกันต้องได้เลขต่างกัน; แก้เลขเป็นเลขที่มีแล้วต้อง error ภาษาไทย (Task 2)
3. **ข้ามปี** — หนังสือแรกของปีใหม่ได้เลข 1 แม้ปีก่อนถึง 1,500 (Task 2)
4. **finalize ไฟล์ปลอม** — ส่ง `driveFileId` ของไฟล์อื่นในโฟลเดอร์ หรือของเล่มอื่น ต้องถูกปฏิเสธ (Task 3)
5. **เกษียนซ้ำ/ผิดขั้น** — ผอ. กดเกษียนเล่มที่ปิดแล้ว, หัวหน้ามอบครูนอกกลุ่ม, ครูกดอ่านเล่มที่ไม่ได้รับมอบ ต้อง error (Task 2)

---

## File Structure

| ไฟล์ | หน้าที่ |
|---|---|
| `supabase/migrations/0012_saraban.sql` | ตาราง ฟังก์ชันสิทธิ์ RLS RPC bucket `signatures` push subscriptions |
| `tests/sql/saraban_test.sql` | ทดสอบสิทธิ์และขั้นตอนงาน |
| `src/lib/saraban/types.ts` | ชนิดข้อมูล, ป้ายภาษาไทยของบทบาท/สถานะ/ชั้นความเร็ว |
| `src/lib/saraban/drive.ts` | Google Drive: token, เปิด upload session, อ่าน metadata, stream ไฟล์ (+ โหมดจำลองด้วยไฟล์ในเครื่อง) |
| `src/lib/saraban/line.ts` | สร้างข้อความ + ส่งเข้ากลุ่ม |
| `src/lib/saraban/push.ts` | Web Push ส่งถึง staff |
| `src/lib/saraban/stamp.ts` | ตำแหน่ง/ข้อความตรา (pure) + ฝัง PNG ลง PDF |
| `src/lib/saraban/stamp-canvas.ts` | วาดตรา/คำเกษียน/ลายเซ็น/QR บน canvas (เบราว์เซอร์) |
| `src/app/(app)/saraban/actions.ts` | Server actions ทั้งหมดของโมดูล |
| `src/app/(app)/saraban/api/upload-session/route.ts` | เปิด resumable session |
| `src/app/(app)/saraban/api/file/[id]/route.ts` | ส่งไฟล์ PDF ตามสิทธิ์ |
| `src/app/(app)/saraban/api/fake-drive/[id]/route.ts` | ปลายทางอัปโหลดในโหมดจำลอง (ปิดเมื่อไม่ได้ตั้ง `SARABAN_DRIVE_FAKE_DIR`) |
| `src/app/(app)/saraban/api/cron/reminders/route.ts` | เตือนครบกำหนดรายวัน |
| `src/app/(app)/saraban/page.tsx`, `inbox.tsx` | รายการ + ค้นหา + ตัวกรอง |
| `src/app/(app)/saraban/new/page.tsx`, `register-form.tsx` | ลงรับ |
| `src/app/(app)/saraban/book/[id]/page.tsx`, `book-view.tsx`, `endorse-panel.tsx` | ดูหนังสือ ไทม์ไลน์ เกษียน มอบหมาย รับทราบ |
| `src/app/(app)/saraban/settings/page.tsx`, `settings-forms.tsx` | คำสั่งสำเร็จรูป, ลายเซ็นของฉัน, เปิดแจ้งเตือน |
| `tests/saraban.test.ts` | unit test ของ `src/lib/saraban/*` |
| `tests/e2e/saraban.cjs` | e2e + วัดเวลา |
| แก้: `src/components/nav-items.ts`, `src/app/(app)/staff/[id]/page.tsx` + `staff/actions.ts`, `public/sw.js`, `vercel.json`, `scripts/backup-storage.mjs`, `src/lib/help.ts`, `docs/SETUP.md`, `docs/RECOVERY.md`, `README.md`, `package.json` |

---

### Task 1: Schema, สิทธิ์การมองเห็น, RLS

**Files:**
- Create: `supabase/migrations/0012_saraban.sql`
- Test: `tests/sql/saraban_test.sql`

**Interfaces:**
- Produces (SQL):
  - `staff.saraban_role text not null default 'teacher' check (saraban_role in ('director','clerk','head','teacher'))`, `staff.work_group text`
  - `saraban_books(id uuid pk default gen_random_uuid(), year int not null, receive_no int not null, doc_no text, doc_date date, from_org text not null, to_text text, subject text not null, urgency smallint not null default 0 check (urgency between 0 and 3), secret boolean not null default false, due_date date, status text not null default 'registered' check (status in ('registered','proposed','endorsed','assigned','closed')), current_holder uuid references staff, received_at timestamptz not null default now(), created_by uuid references staff, deleted_at timestamptz, deleted_reason text, created_at, updated_at, unique(year, receive_no))`
  - `saraban_files(id uuid pk, book_id uuid not null references saraban_books, kind text check (kind in ('original','stamped','attachment')), version int not null, drive_file_id text not null unique, name text not null, size_bytes bigint not null, created_by uuid references staff, created_at, unique(book_id, kind, version))`
  - `saraban_actions(id bigserial pk, book_id uuid not null, actor uuid references staff, action text check (action in ('register','propose','endorse','forward','close','read','renumber','delete')), note text, file_id uuid references saraban_files, targets uuid[] not null default '{}', created_at)`
  - `saraban_recipients(book_id uuid, staff_id uuid, assigned_by uuid, assigned_at timestamptz default now(), read_at timestamptz, primary key(book_id, staff_id))`
  - `saraban_presets(id serial pk, role text check (role in ('clerk','director','head')), text text not null, sort int not null default 0)`
  - `saraban_counters(year int, kind text, last_no int not null, primary key(year, kind))`
  - `push_subscriptions(endpoint text pk, staff_id uuid not null references staff on delete cascade, p256dh text not null, auth text not null, created_at)`
  - `public.saraban_role() returns text` (บทบาทของผู้ใช้ปัจจุบัน หรือ null ถ้าไม่ใช่ staff ที่อนุมัติ)
  - `public.can_view_book(p_book uuid) returns boolean`
  - index: `create extension if not exists pg_trgm`; `saraban_books_search_idx` gin บน `(coalesce(doc_no,'') || ' ' || subject || ' ' || from_org) gin_trgm_ops`; `saraban_recipients(staff_id)`; `saraban_files(book_id)`
  - bucket `signatures` (private, 200KB, `image/png`) policy: select/insert/update/delete เมื่อ `(storage.foldername(name))[1] = my_staff_id()::text` — ใช้รูปแบบเงื่อนไข `if exists (pg_namespace 'storage')` แบบ `0006_care.sql:396`
  - `audit_trigger()` บน `saraban_books`, `saraban_files`, `saraban_recipients`, `saraban_presets`; `touch_updated_at()` บน `saraban_books`
  - grants ตาม `0003_grants.sql`; ตาราง `saraban_counters` ไม่ให้ authenticated เข้าถึงตรง (revoke)
- กติกา `can_view_book`: แถวต้อง `deleted_at is null` และ
  `saraban_role() in ('director','clerk')` หรือ
  (`saraban_role() = 'head'` และ `not secret`) หรือ
  มีแถวใน `saraban_recipients` ของ `my_staff_id()` หรือ `created_by = my_staff_id()`
- RLS: `saraban_books`/`saraban_files`/`saraban_actions`/`saraban_recipients` select ด้วย `can_view_book(book_id)`; ไม่มี policy insert/update/delete (เขียนผ่าน RPC เท่านั้น); `saraban_presets` select ทุก staff, เขียนเฉพาะ `saraban_role() in ('director','clerk')`; `push_subscriptions` เจ้าของเท่านั้น

- [ ] **Step 1: เขียนเทสต์** `tests/sql/saraban_test.sql` ตามรูปแบบ `tests/sql/phase2_care_test.sql` (helper `pg_temp.as_user`, `pg_temp.expect_error`) ผู้ใช้จำลอง 6 คน: director, clerk, head (work_group 'วิชาการ'), head2 (work_group 'งบประมาณ'), teacher1 (วิชาการ), teacher2. ใส่หนังสือด้วย superuser 2 เล่ม (ปกติ A, ลับ B) และ recipient teacher1 → A. Assert:
  - director และ clerk เห็น 2 เล่ม; head เห็น 1 (A); teacher1 เห็น 1 (A); teacher2 เห็น 0
  - head มองไม่เห็นแถวใน `saraban_files` ของ B
  - เพิ่ม head เป็น recipient ของ B → head เห็น 2
  - `update saraban_books set subject='x'` โดย clerk กระทบ 0 แถว; `insert into saraban_books` โดย clerk error `%row-level security%`
  - `update saraban_books set deleted_at=now()` เล่ม A (superuser) → director เห็น 1
  - teacher2 อ่าน `push_subscriptions` ของ teacher1 ได้ 0 แถว
  - ไฟล์ต้องรันซ้ำได้: บรรทัดแรกหลัง `\set` ให้ `\i supabase/migrations/0012_saraban.sql`
- [ ] **Step 2: รันให้ fail** — `tests/sql/run.sh -h localhost -U postgres` → FAIL `relation "saraban_books" does not exist`
- [ ] **Step 3: เขียน `0012_saraban.sql`** ตาม Interfaces ทั้งหมด (idempotent: `if not exists`, `create or replace`, `drop policy if exists`)
- [ ] **Step 4: รันให้ผ่าน** — `tests/sql/run.sh -h localhost -U postgres` → `ผ่าน: tests/sql/saraban_test.sql` และไฟล์เก่าทั้งหมดผ่าน
- [ ] **Step 5: Commit** — `git add supabase/migrations/0012_saraban.sql tests/sql/saraban_test.sql && git commit -m "สารบรรณ: ตาราง สิทธิ์การมองเห็น และหนังสือลับ"`

---

### Task 2: RPC ขั้นตอนงาน (ลงรับ เสนอ เกษียน มอบต่อ รับทราบ ลบ แก้เลข ค้นหา)

**Files:**
- Modify: `supabase/migrations/0012_saraban.sql` (ต่อท้าย)
- Test: `tests/sql/saraban_test.sql` (ต่อท้าย)

**Interfaces:**
- Consumes: Task 1
- Produces (ทุกตัว `security definer set search_path = public`, raise ข้อความไทย, บันทึก `saraban_actions` ทุกครั้ง):
  - `saraban_register(p jsonb) returns jsonb` → `{"id": uuid, "year": int, "receive_no": int}`; keys: `doc_no, doc_date, from_org, to_text, subject, urgency, secret, due_date, receive_no?`; เฉพาะ director/clerk; เลขจาก `insert into saraban_counters ... on conflict (year, kind) do update set last_no = saraban_counters.last_no + 1 returning last_no` (kind `'in'`); ถ้าส่ง `receive_no` มา ใช้เลขนั้นและ `last_no = greatest(last_no, receive_no)`; status `'registered'`, holder = ผู้ลงรับ
  - `saraban_find_duplicates(p_doc_no text, p_from_org text) returns table(id uuid, receive_no int, subject text, received_at timestamptz)` — ปีปัจจุบัน, `doc_no` ตรงกันหลังตัดช่องว่าง/ตัวพิมพ์
  - `saraban_org_suggestions(p_q text) returns setof text` — `from_org` ที่ไม่ซ้ำ ≤ 10 รายการ, ilike
  - `saraban_can_upload(p_book uuid, p_kind text) returns boolean` — `original`/`attachment`: director/clerk; `stamped`: ผู้ที่ทำขั้นถัดไปได้ (clerk ตอน registered, director ตอน proposed, head ที่เป็น holder ตอน endorsed, clerk/director ตอน registered สำหรับตรารับ)
  - `saraban_add_file(p_book uuid, p_kind text, p_drive_file_id text, p_name text, p_size bigint, p_actor uuid) returns uuid` — version = max+1; **grant execute เฉพาะ `service_role`** (revoke จาก public/authenticated)
  - `saraban_propose(p_book uuid, p_note text, p_file uuid) returns void` — clerk/director, status ต้อง `registered` → `proposed`, holder = staff ที่ `saraban_role='director'` คนแรกที่ active
  - `saraban_endorse(p_book uuid, p_route text, p_note text, p_targets uuid[], p_file uuid) returns jsonb` — director, status ต้อง `proposed` (หรือ `registered` ถ้า ผอ. ลงรับเอง); `p_route`: `'head'` → status `endorsed`, holder = targets[1] ต้องมีบทบาท head; `'teachers'` → status `assigned`, เพิ่ม recipients; `'close'` → status `closed`; คืน `{"line": true}` เมื่อควรส่ง LINE (ทุก route ยกเว้น error)
  - `saraban_forward(p_book uuid, p_note text, p_targets uuid[], p_file uuid) returns void` — head ที่เป็น holder, status `endorsed`, targets ทุกคนต้อง `work_group` = ของ head → status `assigned`, เพิ่ม recipients (รวม head ด้วยเพื่อให้เห็นหนังสือลับต่อ)
  - `saraban_mark_read(p_book uuid) returns void` — ต้องเป็น recipient; ตั้ง `read_at` ครั้งแรกเท่านั้น
  - `saraban_delete(p_book uuid, p_reason text) returns void` — director/clerk, reason ห้ามว่าง
  - `saraban_renumber(p_book uuid, p_no int) returns void` — clerk/director; ซ้ำ → `'เลขรับ % มีแล้วในปี %'`
  - `saraban_inbox(p_q text default null, p_filter text default 'all', p_offset int default 0) returns table(id, year, receive_no, doc_no, subject, from_org, urgency, secret, due_date, status, received_at, holder_name text, unread boolean, total bigint)` — **security invoker** (อาศัย RLS); `p_filter`: `'all'`, `'todo'` (holder = ฉัน หรือ recipient ที่ยังไม่อ่าน), `'unread'`; `p_q` ค้นด้วย ilike บน expression ของ index + ตรงกับ `receive_no::text`; limit 50; `total` = `count(*) over()`
  - `saraban_book(p_book uuid) returns jsonb` — security invoker: `{book, files[], actions[] (พร้อม actor_name), recipients[] (พร้อม name, read_at)}`
  - `saraban_staff_options() returns table(id uuid, name text, saraban_role text, work_group text)` — staff ที่ approved และ active
  - `saraban_due_reminders() returns table(staff_id uuid, book_id uuid, subject text, due_date date)` — recipients ที่ยังไม่อ่าน และ `due_date <= today_th() + 1`; grant เฉพาะ service_role

- [ ] **Step 1: เขียนเทสต์ต่อท้าย** `saraban_test.sql`:
  - clerk `saraban_register` สองครั้ง → receive_no 1, 2; ส่ง `receive_no: 10` → 10; ครั้งถัดไป → 11
  - `saraban_renumber(<เล่ม 2>, 10)` error `%เลขรับ 10 มีแล้ว%`
  - ข้ามปี: superuser `insert into saraban_counters values (<ปีนี้-1>, 'in', 1500)` แล้ว register → ได้เลขต่อจากปีนี้ ไม่ใช่ 1501
  - teacher1 `saraban_register` error `%ไม่มีสิทธิ์%`
  - flow: register → propose → director endorse `'head'` targets {head} → head forward {teacher1} → teacher1 mark_read → `read_at is not null`; actions ครบ 5 แถว
  - head forward {teacher2 ที่อยู่นอกกลุ่ม} error `%นอกกลุ่มงาน%`
  - endorse เล่มที่ `closed` error `%สถานะ%`
  - teacher2 mark_read เล่มที่ไม่ได้รับมอบ error `%ไม่ได้รับมอบหมาย%`
  - clerk เรียก `saraban_add_file` ตรง error `%permission denied%`
  - `saraban_inbox(null,'all',0)` โดย teacher1 ได้เฉพาะเล่มที่ได้รับมอบ; `saraban_inbox('ทดสอบ', ...)` คืนเฉพาะเล่มที่ subject มีคำนั้น; เรียงเล่ม urgency 3 ก่อน
  - เลขพร้อมกัน: ทดสอบความถูกต้องของ on-conflict โดย register 20 ครั้งใน loop แล้ว assert `count(distinct receive_no) = 20`
- [ ] **Step 2: รันให้ fail** — `tests/sql/run.sh -h localhost -U postgres` → FAIL `function saraban_register(jsonb) does not exist`
- [ ] **Step 3: เขียน RPC ทั้งหมด** ต่อท้าย `0012_saraban.sql`
- [ ] **Step 4: รันให้ผ่าน** — คำสั่งเดิม → ผ่านทุกไฟล์
- [ ] **Step 5: Commit** — `git commit -am "สารบรรณ: ลงรับ เกษียน มอบต่อ รับทราบ ค้นหา (RPC)"`

---

### Task 3: Google Drive — อัปโหลดตรง ยืนยันไฟล์ ส่งไฟล์ตามสิทธิ์

**Files:**
- Create: `src/lib/saraban/types.ts`, `src/lib/saraban/drive.ts`, `src/app/(app)/saraban/api/upload-session/route.ts`, `src/app/(app)/saraban/api/file/[id]/route.ts`, `src/app/(app)/saraban/api/fake-drive/[id]/route.ts`, `src/app/(app)/saraban/actions.ts`
- Test: `tests/saraban.test.ts`

**Interfaces:**
- Consumes: Task 2 (`saraban_can_upload`, `saraban_add_file`, RLS ของ `saraban_files`)
- Produces:
  - `types.ts`: `SarabanRole`, `Urgency = 0|1|2|3`, `URGENCY_LABEL: Record<Urgency,string>` (`ปกติ`,`ด่วน`,`ด่วนมาก`,`ด่วนที่สุด`), `STATUS_LABEL` (`ลงรับแล้ว`,`เสนอ ผอ.`,`มอบหัวหน้า`,`มอบหมายแล้ว`,`ปิดเรื่อง`), `ROLE_LABEL`
  - `drive.ts`:
    - `buildServiceJwt(email: string, privateKeyPem: string, nowSec: number): string` — RS256 ด้วย `node:crypto` `createSign`, scope `https://www.googleapis.com/auth/drive`, aud `https://oauth2.googleapis.com/token`, exp = now+3600
    - `getAccessToken(): Promise<string>` — cache ในหน่วยความจำจนเหลือ < 60 วินาที
    - `createUploadSession(opts: {name: string; size: number; mime: "application/pdf"; origin: string; appProperties: {bookId: string; kind: string; uploader: string}}): Promise<string>` — POST `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true` body `{name, parents:[SARABAN_DRIVE_FOLDER_ID], appProperties}` header `Origin: opts.origin` (ทำให้เบราว์เซอร์ PUT ข้ามโดเมนได้) คืน header `Location`
    - `getFileMeta(id: string): Promise<{id: string; name: string; size: number; parents: string[]; appProperties: Record<string,string>}>`
    - `streamFile(id: string): Promise<Response>` — `alt=media&supportsAllDrives=true`
    - โหมดจำลอง: ถ้า `process.env.SARABAN_DRIVE_FAKE_DIR` ตั้งไว้ ทุกฟังก์ชันใช้ไฟล์ในโฟลเดอร์นั้น (`<id>.pdf` + `<id>.json` metadata) และ `createUploadSession` คืน `<origin>/sis/saraban/api/fake-drive/<id>`
  - `POST /saraban/api/upload-session` body `{bookId, kind, name, size}` → ตรวจ `size ≤ 30MB`, `rpc('saraban_can_upload')` ด้วย client ของผู้ใช้ → `{uploadUrl}` หรือ 403
  - `actions.ts`: `finalizeUpload(bookId: string, kind: "original"|"stamped"|"attachment", driveFileId: string): Promise<{ok: true; fileId: string} | {ok: false; error: string}>` — `getFileMeta` ต้องมี `parents` มี folder id, `appProperties.bookId === bookId`, `kind` ตรง, `uploader === my staff id`; จากนั้น `supabaseAdmin().rpc('saraban_add_file', …)`
  - `GET /saraban/api/file/[id]` → select `saraban_files` ด้วย client ผู้ใช้ (RLS) ไม่พบ → 404; พบ → stream จาก Drive พร้อม `Content-Type: application/pdf`, `Cache-Control` ตาม Global Constraints
  - `PUT /saraban/api/fake-drive/[id]` → 404 เมื่อไม่ได้ตั้ง `SARABAN_DRIVE_FAKE_DIR`

- [ ] **Step 1: เขียน unit test** ใน `tests/saraban.test.ts`:
  - `buildServiceJwt` ด้วย key ที่สร้างในเทสต์ (`generateKeyPairSync('rsa', {modulusLength: 2048})`): แยก 3 ส่วน, header `{"alg":"RS256","typ":"JWT"}`, payload `exp - iat === 3600`, `scope` ตรง, ลายเซ็นตรวจผ่านด้วย public key
  - โหมดจำลอง: ตั้ง `SARABAN_DRIVE_FAKE_DIR` เป็น temp dir → `createUploadSession({... origin: "http://x"})` ขึ้นต้นด้วย `http://x/sis/saraban/api/fake-drive/` และ `getFileMeta` คืน appProperties ที่ส่งไป
- [ ] **Step 2: รันให้ fail** — `npm test` → FAIL `Cannot find module '../src/lib/saraban/drive.ts'`
- [ ] **Step 3: เขียน `types.ts`, `drive.ts`** แล้วรัน `npm test` → PASS
- [ ] **Step 4: เขียน routes และ `finalizeUpload`** ตรวจ middleware (`src/middleware.ts`) ว่าไม่ redirect `/saraban/api/*` ไปหน้า login แบบ HTML (คืน 401 JSON แทนเมื่อไม่ได้ล็อกอิน)
- [ ] **Step 5: ตรวจ** — `npm run typecheck && npm run lint` → ไม่มี error
- [ ] **Step 6: Commit** — `git commit -m "สารบรรณ: อัปโหลด PDF ตรงเข้า Shared Drive และเปิดดูตามสิทธิ์"`

---

### Task 4: LINE และ Web Push

**Files:**
- Create: `src/lib/saraban/line.ts`, `src/lib/saraban/push.ts`, `src/app/(app)/saraban/api/cron/reminders/route.ts`
- Modify: `vercel.json`, `package.json` (เพิ่ม `web-push`)
- Test: `tests/saraban.test.ts`

**Interfaces:**
- Produces:
  - `formatLineMessage(b: {receiveNo: number; year: number; subject: string; fromOrg: string; urgency: Urgency; secret: boolean; command: string; assignees: string[]; url: string}): string` — บรรทัด: `📥 หนังสือรับที่ {receiveNo}/{year}` + (` [ด่วนที่สุด]` ฯลฯ เมื่อ urgency>0) / `เรื่อง: {subject หรือ "หนังสือลับ"}` / `จาก: {fromOrg}` / `ผอ. สั่งการ: {command}` / `ผู้รับผิดชอบ: {assignees.join(", ")}` (ไม่มี → ตัดบรรทัด) / `{url}`; ตัดให้ ≤ 5000 ตัวอักษร
  - `pushLineGroup(text: string): Promise<boolean>` — ไม่ได้ตั้ง env → คืน false ไม่ throw; error ของ LINE ไม่ทำให้คำสั่งเกษียนล้มเหลว
  - `pushToStaff(staffIds: string[], payload: {title: string; body: string; url: string}): Promise<void>` — `web-push` + VAPID env; ลบ subscription ที่ได้ 404/410
  - `GET /saraban/api/cron/reminders` — ต้องมี header `Authorization: Bearer ${CRON_SECRET}` ไม่งั้น 401; เรียก `saraban_due_reminders()` ด้วย admin client แล้ว `pushToStaff` รวมต่อคน 1 ข้อความ
  - `vercel.json`: `"crons": [{"path": "/sis/saraban/api/cron/reminders", "schedule": "0 0 * * 1-5"}]` (07:00 น. เวลาไทย)

- [ ] **Step 1: เขียน unit test** — `formatLineMessage` กรณีลับ: ไม่มีชื่อเรื่องจริงในผลลัพธ์ และมี `หนังสือลับ`; urgency 3 มี `[ด่วนที่สุด]`; urgency 0 ไม่มี `[`; ไม่มี assignees → ไม่มี `ผู้รับผิดชอบ`; `pushLineGroup` เมื่อไม่มี env คืน `false`
- [ ] **Step 2: รันให้ fail** — `npm test` → FAIL module not found
- [ ] **Step 3: ติดตั้ง** `npm install web-push@3.6.7 && npm install -D @types/web-push` แล้วเขียน `line.ts`, `push.ts`, route cron, แก้ `vercel.json`
- [ ] **Step 4: รัน** — `npm test && npm run typecheck` → PASS
- [ ] **Step 5: Commit** — `git commit -am "สารบรรณ: แจ้งเตือน LINE กลุ่มครู และ Web Push รายบุคคล"`

---

### Task 5: ตราประทับและการฝังลง PDF

**Files:**
- Create: `src/lib/saraban/stamp.ts`, `src/lib/saraban/stamp-canvas.ts`
- Modify: `package.json` (เพิ่ม `pdf-lib`, `qrcode`)
- Test: `tests/saraban.test.ts`

**Interfaces:**
- Produces:
  - `receiveStampLines(s: {schoolName: string; receiveNo: number; year: number; receivedAt: string}): string[]` — `[schoolName, "รับที่ {receiveNo}/{year}", "วันที่ {formatThaiDate(…,'long')}", "เวลา {HH.mm} น."]`
  - `endorsementLines(e: {note: string; signerName: string; position: string; date: string}, maxChars = 48): string[]` — ตัดบรรทัดตามช่องว่าง/ความยาว ไม่ตัดกลางคำที่มีช่องว่าง, ต่อด้วย `(signerName)`, `position`, วันที่แบบสั้น
  - `STAMP_SCALE = 3`
  - `embedPng(pdf: Uint8Array, png: Uint8Array, box: {page: number; x: number; y: number; width: number; height: number}): Promise<Uint8Array>` — pdf-lib, หน่วย point จากมุมซ้ายล่าง
  - `stamp-canvas.ts` (เบราว์เซอร์): `drawReceiveStamp(lines: string[], qrUrl: string): Promise<Uint8Array>`, `drawEndorsement(lines: string[], signature?: ImageBitmap): Promise<Uint8Array>` — canvas ×`STAMP_SCALE`, ฟอนต์ `Sarabun` (โหลดผ่าน `next/font/google` ที่หน้า), คืน PNG bytes

- [ ] **Step 1: เขียน unit test** — `receiveStampLines` คืน 4 บรรทัดและบรรทัดที่ 2 เท่ากับ `"รับที่ 12/2570"`; `endorsementLines` ข้อความยาว 120 ตัวอักษรไม่มีบรรทัดใดเกิน 48 และบรรทัดท้าย 3 บรรทัดเป็นชื่อ/ตำแหน่ง/วันที่; `embedPng` บน PDF 1 หน้าที่สร้างด้วย pdf-lib + PNG 1×1 → ผลลัพธ์โหลดได้, ยังมี 1 หน้า, ขนาดใหญ่ขึ้น
- [ ] **Step 2: รันให้ fail** — `npm test` → FAIL
- [ ] **Step 3: ติดตั้ง** `npm install pdf-lib@1.17.1 qrcode@1.5.4 && npm install -D @types/qrcode` แล้วเขียน `stamp.ts`, `stamp-canvas.ts`
- [ ] **Step 4: รัน** — `npm test && npm run typecheck` → PASS
- [ ] **Step 5: Commit** — `git commit -am "สารบรรณ: ตรารับ คำเกษียน และฝังลง PDF"`

---

### Task 6: หน้ารายการ ลงรับ และเมนู

**Files:**
- Create: `src/app/(app)/saraban/page.tsx`, `inbox.tsx`, `new/page.tsx`, `new/register-form.tsx`
- Modify: `src/app/(app)/saraban/actions.ts`, `src/components/nav-items.ts`, `src/app/(app)/staff/[id]/page.tsx`, `src/app/(app)/staff/actions.ts`, `src/lib/supabase/server.ts` (เพิ่ม `saraban_role`, `work_group` ใน `Profile` และ `my_profile()` ใน migration 0012)

**Interfaces:**
- Consumes: Task 2 RPC, Task 3 upload, Task 5 stamp
- Produces:
  - actions: `registerBook(input: {docNo, docDate, fromOrg, toText, subject, urgency, secret, dueDate, receiveNo?}): Promise<{ok: true; id: string; receiveNo: number} | {ok:false; error:string}>`, `findDuplicates(docNo, fromOrg)`, `orgSuggestions(q)`, `setSarabanRole(staffId, role, workGroup)` (admin หรือ director)
  - `/saraban`: server component เรียก `saraban_inbox` ครั้งเดียว; ช่องค้นหา (debounce 250ms, อัปเดต `?q=`), แท็บ `งานของฉัน`/`ทั้งหมด`/`ยังไม่อ่าน`, ป้ายสีตามชั้นความเร็ว, ไอคอนกุญแจสำหรับหนังสือลับ, "โหลดเพิ่ม" ทีละ 50; ปุ่ม `ลงรับหนังสือ` เฉพาะ director/clerk
  - `/saraban/new` (director/clerk): ลากไฟล์ PDF → กรอกฟอร์ม (เติม `from_org` อัตโนมัติ, เตือนซ้ำใต้ช่องเลขที่หนังสือ) → กด `ลงรับ` ลำดับ: `registerBook` → `upload-session` → PUT ไฟล์ → `finalizeUpload('original')` → วาดตรารับ + QR (`withBase('/saraban/book/'+id)` แบบ absolute) → `embedPng` มุมขวาบนหน้าแรก → อัปโหลดเป็น `stamped` → ไปหน้า `/saraban/book/:id`; ถ้าอัปโหลดล้มเหลวหลังได้เลขแล้ว ให้หน้า book แสดงปุ่ม `แนบไฟล์อีกครั้ง`
  - nav: `{ href: "/saraban", label: "สารบรรณ", icon: "saraban", color: "#FCA5A5" }` (เพิ่ม `"saraban"` ใน union ของ `icon` และ mapping ไอคอนใน `app-shell.tsx`)
  - หน้าทะเบียนครู: เลือกบทบาทสารบรรณ + กลุ่มงาน

- [ ] **Step 1: เขียนหน้าและ actions ตาม Interfaces**
- [ ] **Step 2: ตรวจ** — `npm run typecheck && npm run lint && npm run build` → สำเร็จ
- [ ] **Step 3: ทดลองใน local stack** — `scripts/local-stack/start.sh`, ตั้ง `SARABAN_DRIVE_FAKE_DIR=/tmp/saraban-fake`, `npm start` → ลงรับ 1 เล่มด้วย clerk เห็นในรายการพร้อมเลข 1 และเปิด PDF ที่มีตราได้
- [ ] **Step 4: Commit** — `git commit -m "สารบรรณ: หน้ารายการหนังสือ ลงรับ และบทบาทในทะเบียนครู"`

---

### Task 7: หน้าหนังสือ เกษียน มอบต่อ รับทราบ ตั้งค่า

**Files:**
- Create: `src/app/(app)/saraban/book/[id]/page.tsx`, `book-view.tsx`, `endorse-panel.tsx`, `src/app/(app)/saraban/settings/page.tsx`, `settings-forms.tsx`
- Modify: `src/app/(app)/saraban/actions.ts`

**Interfaces:**
- Consumes: Task 2, 3, 4, 5
- Produces:
  - actions: `proposeBook(bookId, note, fileId)`, `endorseBook(bookId, route: "head"|"teachers"|"close", note, targets: string[], fileId)` — หลัง RPC สำเร็จ: ถ้าคืน `line: true` เรียก `pushLineGroup(formatLineMessage(...))`; `pushToStaff` ให้ targets, `forwardBook(bookId, note, targets, fileId)` → push ให้ targets, `markRead(bookId)`, `deleteBook(bookId, reason)`, `renumberBook(bookId, no)`, `savePreset/deletePreset`, `savePushSubscription(sub: PushSubscriptionJSON)`
  - `/saraban/book/[id]`: เรียก `saraban_book` ครั้งเดียว; ไม่พบ/ไม่มีสิทธิ์ → หน้า "ไม่พบหนังสือ หรือคุณไม่มีสิทธิ์ดู"; PDF แสดงด้วย `<iframe src=withBase('/saraban/api/file/'+latestFileId)>`; ไทม์ไลน์จาก `actions`; รายชื่อผู้รับพร้อมสถานะอ่าน; ครูที่เป็น recipient เปิดหน้าแล้วเรียก `markRead` อัตโนมัติ
  - `endorse-panel.tsx` (ตามบทบาท/สถานะ): **ผอ. 4 แตะ** = (1) แตะชิปคำสั่งสำเร็จรูป (2) แตะเส้นทาง/ผู้รับ (ชิปหัวหน้ากลุ่ม หรือรายชื่อครู) (3) แตะ `ลงนาม` (4) ยืนยัน — ระหว่างนั้นวาดคำเกษียน + ลายเซ็นของ ผอ. ด้วย `drawEndorsement` ฝังมุมล่างขวาของหน้าแรก (หรือหน้าใหม่ถ้าพื้นที่ไม่พอ: เพิ่มหน้า A4 ท้ายไฟล์) อัปโหลดเป็น `stamped` แล้วเรียก action; ธุรการ: คำเกษียนเสนอ; หัวหน้า: เลือกครูในกลุ่ม; ปุ่มทำงานต้องสูง ≥ 44px
  - `/saraban/settings`: คำสั่งสำเร็จรูปตามบทบาท (director/clerk แก้ได้), อัปโหลดลายเซ็น PNG ของฉัน → `signatures/<staffId>/signature.png`, ปุ่ม `เปิดการแจ้งเตือน` (ขอ permission + `savePushSubscription`; ลงทะเบียนกับ `/sis/sw.js` เดิม)

- [ ] **Step 1: เขียนหน้า แผงเกษียน และ actions ตาม Interfaces**
- [ ] **Step 2: ตรวจ** — `npm run typecheck && npm run lint && npm run build` → สำเร็จ
- [ ] **Step 3: ทดลองใน local stack** — flow ครบ: clerk ลงรับ → เสนอ → director (มือถือ 390×844) เกษียนมอบหัวหน้า ภายใน 4 แตะ → head มอบครู → teacher เปิดแล้วสถานะ "อ่านแล้ว"
- [ ] **Step 4: Commit** — `git commit -m "สารบรรณ: หน้าหนังสือ เกษียนบนมือถือ มอบต่อ และตั้งค่า"`

---

### Task 8: ออฟไลน์, e2e วัดเวลา, เอกสาร

**Files:**
- Modify: `public/sw.js`, `scripts/backup-storage.mjs`, `src/lib/help.ts`, `docs/SETUP.md`, `docs/RECOVERY.md`, `README.md`, `.github/workflows/ci.yml` (ถ้า e2e อยู่ใน CI แล้วเท่านั้น)
- Create: `tests/e2e/saraban.cjs`

**Interfaces:**
- `sw.js`: คำขอ GET ที่ path ขึ้นต้น `/sis/saraban/api/file/` → cache-first ใน cache ใหม่ `tsr-saraban-files` (จำกัด 200 รายการ ลบเก่าสุดก่อน); `/sis/saraban/api/*` อื่นไม่ cache; หน้า `/sis/saraban*` ใช้ network-first เดิม; bump `VERSION`
- `backup-storage.mjs`: เพิ่ม bucket `signatures`
- `help.ts`: หัวข้อ "สารบรรณ" สำหรับแต่ละบทบาท
- `SETUP.md`: สร้าง Shared Drive + service account, env ฝั่งเซิร์ฟเวอร์ทั้งหมดใน Global Constraints + `VAPID_PUBLIC_KEY` (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`), LINE OA + หา group ID, `CRON_SECRET`; ตัวเลือก redirect `/saraban` → `/sis/saraban` ใน Caddy
- `RECOVERY.md`: แถว "PDF สารบรรณ" (Shared Drive, อยู่ใน Google ของโรงเรียน) และ "ลายเซ็น" (bucket `signatures`)

- [ ] **Step 1: เขียน `tests/e2e/saraban.cjs`** ตามรูปแบบ `tests/e2e/flow.cjs` (login ชื่อผู้ใช้ใน local stack, `SARABAN_DRIVE_FAKE_DIR`) ตรวจ:
  - flow ลงรับ → เสนอ → เกษียน → มอบต่อ → อ่าน ผ่าน และไม่มี `pageerror`
  - เวลา: `/saraban` ด้วย throttle 4G (CDP `Network.emulateNetworkConditions` latency 150ms, 1.6Mbps down) โหลด `load` ≤ 2000ms; คลิก `ลงนาม` ถึง toast สำเร็จ (ไม่รวม upload — วัดเฉพาะช่วง server action) ≤ 500ms; เปิด PDF รอบสองตอบจาก service worker (`response.fromServiceWorker()` เป็น true)
  - teacher2 เปิด `/saraban/book/<เล่มลับ>` เห็นข้อความไม่มีสิทธิ์ และ `GET /sis/saraban/api/file/<id>` ได้ 404
- [ ] **Step 2: รัน** — `node tests/e2e/saraban.cjs` (หลัง `scripts/local-stack/start.sh` และ `npm run build && npm start`) → ทุกขั้น ✓ และพิมพ์เวลาที่วัดได้
- [ ] **Step 3: แก้ `sw.js`, backup, help, เอกสาร**
- [ ] **Step 4: ตรวจทั้งหมด** — `npm test && npm run typecheck && npm run lint && tests/sql/run.sh -h localhost -U postgres && npm run build` → ผ่าน
- [ ] **Step 5: Commit** — `git commit -am "สารบรรณ: ใช้งานออฟไลน์ ทดสอบความเร็ว และคู่มือติดตั้ง"`
