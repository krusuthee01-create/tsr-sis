# คู่มือติดตั้งระบบ TSR-SIS (สำหรับผู้ดูแลระบบ)

ใช้เวลาประมาณ 1 ชั่วโมง ทุกบริการใช้แพ็กเกจฟรี ทำตามลำดับจากบนลงล่าง

## 1. สร้างฐานข้อมูล Supabase

1. สมัครที่ https://supabase.com ด้วยบัญชี Google ของโรงเรียน
2. กด **New project**
   - Name: `tsr-sis`
   - Database Password: ตั้งรหัสที่ยาวและจดเก็บไว้ในที่ปลอดภัย (ใช้ตอนตั้งค่าการสำรองข้อมูล)
   - Region: **Southeast Asia (Singapore)** ← สำคัญ เพื่อให้ระบบเร็ว
3. เมื่อสร้างเสร็จ ไปที่ **SQL Editor** แล้วรันไฟล์ทีละไฟล์ตามลำดับ (คัดลอกทั้งไฟล์ไปวาง แล้วกด Run)
   1. `supabase/migrations/0001_init.sql`
   2. `supabase/migrations/0002_security_and_functions.sql`
   3. `supabase/migrations/0003_grants.sql`
4. ไปที่ **Project Settings › API** จดค่าเหล่านี้ไว้
   - Project URL
   - `anon` `public` key
   - `service_role` key (เป็นความลับ ห้ามเปิดเผย)

## 2. ตั้งค่าการเข้าสู่ระบบ

### 2.1 Google
1. ไปที่ https://console.cloud.google.com › สร้างโปรเจกต์ใหม่ › **APIs & Services › OAuth consent screen**
   ตั้งค่าเป็น External, ใส่ชื่อแอป "TSR-SIS" และอีเมลโรงเรียน แล้วกด Publish
2. **Credentials › Create Credentials › OAuth client ID** › ประเภท Web application
   - Authorized redirect URIs: `https://<Project URL ของ Supabase>/auth/v1/callback`
3. คัดลอก Client ID และ Client Secret ไปใส่ที่ Supabase › **Authentication › Sign In / Providers › Google** แล้วเปิดใช้งาน

### 2.2 ตั้งค่าอื่นใน Supabase › Authentication
- **URL Configuration**
  - Site URL: ที่อยู่เว็บจริง เช่น `https://tsr-sis.vercel.app/sis`
  - Redirect URLs: เพิ่ม `https://tsr-sis.vercel.app/sis/auth/callback` (ทุกหน้าอยู่ใต้ `/sis` — ดูหัวข้อ "ที่อยู่ /sis" ด้านล่าง)
    ถ้าเปิดผ่านระบบลงเวลาด้วย เพิ่ม `https://gotime.anubantep.ac.th/sis/**` และโดเมนโรงเรียน `https://sis.anubantep.ac.th/sis/**`
- **Sign In / Providers › Email**: เปิดไว้ (ใช้กับบัญชีชื่อผู้ใช้/รหัสผ่านที่ผู้ดูแลระบบสร้างให้)
  และ **ปิด "Confirm email"**
- ผู้ที่เข้าระบบด้วย Google ครั้งแรกจะอยู่ในสถานะ "รออนุมัติ" และไม่เห็นข้อมูลใดจนกว่าผู้ดูแลระบบจะอนุมัติ

## 3. นำเว็บขึ้น Vercel

1. สมัคร https://vercel.com ด้วยบัญชี GitHub ที่เป็นเจ้าของ repository `tsr-sis`
2. **Add New › Project** › เลือก repository `tsr-sis` › Framework: Next.js (ระบบเลือกให้)
3. **Environment Variables** ใส่ 3 ค่า (ดูตัวอย่างใน `.env.example`)
   | ชื่อ | ค่า |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role key |

   ไม่บังคับ (เมนู "สลับระบบ" / "ลงเวลา / การลา" — ค่าเริ่มต้นชี้ระบบลงเวลาของโรงเรียนอยู่แล้วใน `src/lib/portal-links.ts`):
   `NEXT_PUBLIC_PORTAL_URL` (ค่าเริ่มต้น `https://gotime.anubantep.ac.th/start?choose=1`) และ
   `NEXT_PUBLIC_ATTENDANCE_URL` (ค่าเริ่มต้น `https://gotime.anubantep.ac.th`) — แก้แล้วต้อง deploy ใหม่
   ไม่บังคับ: `SIS_PROXY_ORIGINS` = host ของระบบที่ส่งต่อ `/sis` มาที่นี่ คั่นด้วยจุลภาค (ค่าเริ่มต้น `gotime.anubantep.ac.th`)
   ใช้ตรวจ Origin ของ Server Actions (เช่น เปลี่ยนเป็นบัญชี Google ในหน้าทะเบียนครู) — ใช้ตอน build
4. กด **Deploy** ระบบใช้ภูมิภาค Singapore (`sin1`) ตามไฟล์ `vercel.json` ให้อัตโนมัติ
5. ถ้าต้องการชื่อเว็บของโรงเรียนเอง (ประมาณ 500 บาท/ปี) เพิ่มได้ที่ Settings › Domains
   แล้วอย่าลืมแก้ Site URL และ Redirect URLs ในข้อ 2.2 ให้ตรงกัน

## ที่อยู่ /sis (เปิดใต้ที่อยู่เดียวกับระบบลงเวลา)

ทุกหน้าของ TSR-SIS อยู่ใต้ `/sis` (`basePath` ใน `next.config.ts`) build เดียวใช้ได้ทุกที่อยู่:
- `https://gotime.anubantep.ac.th/sis/...` — Caddy ของระบบลงเวลาส่งต่อมา Vercel (`Host: tsr-sis.vercel.app`)
  ทำให้ iPhone เปิด TSR-SIS ในแอปบนหน้าจอโฮมของระบบลงเวลาได้เลย ไม่เด้งหน้าต่างเบราว์เซอร์ซ้อน
- `https://sis.anubantep.ac.th/sis/...` และ `https://tsr-sis.vercel.app/sis/...` — ที่อยู่เดิมยังใช้ได้
- ที่อยู่เดิมที่ไม่มี `/sis` (บุ๊กมาร์ก ไอคอนบนหน้าจอโฮมเดิม) พาไป `/sis/...` อัตโนมัติ (redirect 307)

ข้อควรรู้:
- redirect ทุกตัวของระบบเป็นแบบ relative (`Location: /sis/...`) เบราว์เซอร์จึงอยู่ที่ที่อยู่เดิมเสมอ ไม่หลุดไป `tsr-sis.vercel.app`
  ห้ามใช้ `request.nextUrl.origin` สร้างลิงก์ (หลัง proxy คือ host ของ Vercel) — ใช้ `src/lib/relative-redirect.ts`
- คุกกี้เข้าสู่ระบบอยู่ที่ path `/sis` ไม่ปนกับระบบลงเวลา · คุกกี้รุ่นเก่า (path `/`) ย้ายให้อัตโนมัติครั้งแรกที่เปิด ไม่ต้องเข้าสู่ระบบใหม่
- service worker อยู่ที่ `/sis/sw.js` scope `/sis` · แคชชื่อ `tsr-*` เท่านั้น · ตัวเก่า (scope `/`) ถูกถอนเมื่อเปิดหน้าใหม่
- รายการเช็กชื่อที่ยังไม่ส่ง (IndexedDB) และแคชแยกตามที่อยู่เว็บ: ของ `sis.anubantep.ac.th` อยู่ที่นั่น ไม่ย้ายไป `gotime...`
  ครูที่มีรายการค้าง ให้เปิดไอคอน TSR-SIS เดิมตอนมีสัญญาณ 1 ครั้งให้ส่งให้ครบก่อนเปลี่ยนไปใช้ไอคอนระบบลงเวลา
- ในโค้ด: `next/link`, `router.push`, `redirect()` เติม `/sis` ให้เอง · `<a href>`, `<form action>`, `<Image src>`, metadata,
  `history.replaceState` และ URL ที่ส่งให้ Supabase ต้องใช้ `withBase()` จาก `src/lib/base-path.ts`
- ทดสอบผ่าน reverse proxy: `tests/e2e/basepath-proxy.cjs` (วิธีเปิด proxy อยู่ในหัวไฟล์) และ `E2E_ORIGIN=<proxy> node tests/e2e/flow.cjs`

## 4. ตั้งค่าครั้งแรกในระบบ

1. เปิดเว็บ กด **เข้าสู่ระบบด้วย Google** ด้วยบัญชีของผู้ดูแลระบบคนที่ 1
2. หน้า "รออนุมัติ" จะมีปุ่ม **ตั้งฉันเป็นผู้ดูแลระบบ** (มีเฉพาะตอนที่ระบบยังไม่มีผู้ดูแลระบบ) กดปุ่มนี้
3. ทำตามรายการในหน้า **ตั้งค่าระบบ › ภาพรวม** ตามลำดับ:
   1. ข้อมูลโรงเรียน (ชื่อผู้อำนวยการ นายทะเบียน)
   2. ปีการศึกษา ภาคเรียน และวันหยุด
   3. นำเข้ารายชื่อนักเรียนจาก DMC (หน้า ทะเบียนนักเรียน › นำเข้าจาก DMC)
   4. เพิ่มครูในหน้า ทะเบียนครู โดยใส่อีเมล Google ของครู (หรือสร้างชื่อผู้ใช้ให้ครูที่ไม่มีบัญชี Google)
   5. กำหนดครูที่ปรึกษาทุกห้องที่หน้า ห้องเรียน
   6. (ถ้าใช้เช็กชื่อประจำวิชา) นำเข้ารายวิชาจากไฟล์โปรแกรม ปพ.5 และกำหนดวิชาที่สอนให้ครู
4. ตั้งผู้ดูแลระบบสำรองอีก 1 คน: หน้า ทะเบียนครู › ชื่อครู › ติ๊ก "ผู้ดูแลระบบ"

## 5. สำรองข้อมูลและกันระบบหยุดทำงาน (GitHub Actions)

ใน GitHub › repository `tsr-sis` › **Settings › Secrets and variables › Actions** เพิ่ม Repository secrets:

| ชื่อ | ค่า |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_ANON_KEY` | anon key |
| `SUPABASE_DB_URL` | Supabase › **Connect** › Session pooler (connection string) แล้วแทน `[YOUR-PASSWORD]` ด้วยรหัสฐานข้อมูล |
| `BACKUP_PASSPHRASE` | รหัสสำหรับเข้ารหัสไฟล์สำรอง ตั้งให้ยาวและจดเก็บไว้ (หายแล้วเปิดไฟล์สำรองไม่ได้) |

จากนั้นระบบจะทำงานอัตโนมัติ:
- **keepalive** ทุกวัน 06:17 น. เรียกฐานข้อมูลเพื่อไม่ให้แพ็กเกจฟรีหยุดโปรเจกต์ช่วงปิดเทอม
- **backup** ทุกวันอาทิตย์ 02:23 น. สำรองฐานข้อมูลแบบเข้ารหัส เก็บไว้ 90 วัน (ดาวน์โหลดได้ที่แท็บ Actions)

ทดสอบได้ทันทีที่แท็บ **Actions** › เลือก workflow › **Run workflow**

### กู้คืนข้อมูลจากไฟล์สำรอง
```bash
gpg --decrypt tsr-sis-2569-xx-xx.dump.gpg > backup.dump          # ใส่ BACKUP_PASSPHRASE
pg_restore --clean --if-exists --no-owner -d "<SUPABASE_DB_URL>" backup.dump
```
แนะนำให้ทดลองกู้คืนลงโปรเจกต์ Supabase ใหม่ก่อน เพื่อตรวจว่าไฟล์ใช้ได้

## 6. สารบรรณอิเล็กทรอนิกส์ (e-Saraban)

ลงรับหนังสือ PDF › เสนอ ผอ. › เกษียนบนมือถือ › มอบหมายต่อ › ครูอ่าน (รายละเอียดการออกแบบ: `docs/superpowers/specs/2026-11-21-esaraban-design.md`)
ไฟล์ PDF เก็บใน **Shared Drive ของโรงเรียน** (Google Workspace for Education ฟรี) ไม่ใช้พื้นที่ Supabase
ทุกค่าด้านล่างใส่ที่ Vercel › Settings › Environment Variables แล้ว **Redeploy** (ค่า `NEXT_PUBLIC_*` ฝังตอน build ต้อง deploy ใหม่ทุกครั้งที่แก้)
ห้ามนำค่าลับลง git, LINE, อีเมล หรือเอกสารนี้ — เก็บในตัวจัดการรหัสผ่านของผู้ดูแลระบบ

### 6.1 ฐานข้อมูล
1. Supabase › **SQL Editor** › รัน `supabase/migrations/0012_saraban.sql`, `0013_saraban_drive_oauth.sql`, `0014_saraban_school_practice.sql`, `0015_saraban_outgoing.sql` แล้ว `0016_saraban_memo.sql` (หลังไฟล์ก่อนหน้าทั้งหมด) ได้ตาราง สิทธิ์ และ bucket `signatures` (ลายเซ็น)
2. ตรวจ: Supabase › **Storage** ต้องมี bucket `signatures` (Private)
3. เลขที่หนังสือของโรงเรียน (ส่วนหน้าเลขหนังสือส่ง) ค่าเริ่มต้น `ศธ 04109.84` แก้ได้ที่ สารบรรณ › ตั้งค่า (ผอ./ธุรการ)

### 6.2 ที่เก็บไฟล์ PDF (Google Drive) — เลือกแบบใดแบบหนึ่ง
| แบบ | เหมาะกับ | ไฟล์เป็นของ |
|---|---|---|
| **ก. บัญชี Google ของโรงเรียน** (แนะนำเมื่อสร้าง Shared Drive ไม่ได้ เช่นบัญชี @phrae1.go.th) | กดเชื่อมต่อครั้งเดียวในระบบ | บัญชีที่เชื่อมต่อ (ใช้พื้นที่ของบัญชีนั้น) |
| ข. service account + Shared Drive | หน่วยงานที่สร้าง Shared Drive ได้ | Shared Drive |

ถ้าตั้งทั้งสองแบบ ระบบใช้แบบ ก. ก่อน · **ห้ามใช้บัญชี Gmail ส่วนตัว** (เอกสารราชการต้องเป็นของหน่วยงาน และเก็บอย่างน้อย 10 ปี)

#### ก. บัญชี Google ของโรงเรียน (OAuth)
ระบบขอสิทธิ์ `drive.file` เท่านั้น: เห็นเฉพาะไฟล์ที่ระบบสร้างเอง ไม่เห็นไฟล์อื่นในไดรฟ์ของบัญชีนั้น
1. https://console.cloud.google.com › โปรเจกต์ (เช่น `TSR-SIS`) › **APIs & Services › Library** › **Google Drive API** › **Enable**
2. **Google Auth Platform › Branding** (หรือ OAuth consent screen): User type **External**, ชื่อแอป เช่น `ระบบสารบรรณ อนุบาลเทพสุนทรินทร์`, อีเมลติดต่อ
3. **Google Auth Platform › Audience › Publish app** ให้เป็น **In production**
   **สำคัญ:** ถ้าค้างอยู่ที่ Testing สิทธิ์ที่เชื่อมต่อจะหมดอายุใน 7 วัน (สิทธิ์ drive.file ไม่ต้องรอ Google ตรวจสอบแอป)
4. **Google Auth Platform › Clients › Create client** › ชนิด **Web application** ชื่อ `saraban`
   **Authorized redirect URIs** ใส่ (ตรงกับ `NEXT_PUBLIC_SITE_URL` ทุกตัวอักษร):
   `https://gotime.anubantep.ac.th/sis/saraban/api/drive/callback`
   › Create ได้ **Client ID** → `GOOGLE_OAUTH_CLIENT_ID` และ **Client secret** → `GOOGLE_OAUTH_CLIENT_SECRET` (ความลับ)
5. ใส่สองค่านี้และ `NEXT_PUBLIC_SITE_URL` (ข้อ 6.4) ใน Vercel แล้ว **Redeploy**
6. เข้าระบบด้วยบัญชีผู้ดูแลระบบหรือผู้อำนวยการ › **สารบรรณ › ตั้งค่า › เชื่อมต่อ Google Drive**
   › เลือกบัญชีของโรงเรียนที่จะเป็นเจ้าของเอกสาร (แนะนำบัญชีกลางของงานธุรการ ไม่ใช่บัญชีส่วนตัวของครู) › อนุญาต
   ระบบสร้างโฟลเดอร์ `eSaraban - หนังสือรับ (ห้ามลบ)` ในไดรฟ์ของบัญชีนั้นเอง
7. ถ้าขึ้น **"Access blocked / แอปนี้ถูกบล็อก"** แปลว่าผู้ดูแล Workspace ของบัญชีนั้น (เช่น สพป.) จำกัดแอปภายนอก
   ให้ผู้ดูแลเพิ่มแอปนี้: admin.google.com › Security › Access and data control › API controls › Manage third-party app access › Configure new app › ค้นด้วย Client ID › **Trusted**
8. เปลี่ยนบัญชีภายหลังไม่ได้เมื่อมีไฟล์แล้ว (ไฟล์เก่าเป็นของบัญชีเดิม) — เชื่อมต่อใหม่ด้วยบัญชีเดิมได้เสมอ (เช่น เมื่อสิทธิ์หมดอายุหรือถูกยกเลิก)
   **ห้ามลบโฟลเดอร์หรือยกเลิกสิทธิ์ของแอปในบัญชีนั้น** ไม่อย่างนั้นเปิดไฟล์ไม่ได้และลงรับไม่ได้จนกว่าจะเชื่อมต่อใหม่

#### ข. service account + Shared Drive
service account ไม่มีพื้นที่ Drive ของตัวเอง จึงต้องเก็บใน Shared Drive เท่านั้น (โฟลเดอร์ใน "ไดรฟ์ของฉัน" ใช้ไม่ได้)
1. https://console.cloud.google.com › เลือกโปรเจกต์ (ใช้โปรเจกต์เดียวกับข้อ 2.1 หรือสร้างใหม่ เช่น `tsr-sis-saraban`)
2. **APIs & Services › Library** › ค้นหา **Google Drive API** › **Enable**
3. **IAM & Admin › Service Accounts › Create service account** ชื่อ `saraban` (ไม่ต้องให้ role ใด ๆ) › Done
   จดอีเมลที่ได้ เช่น `saraban@tsr-sis-saraban.iam.gserviceaccount.com` → `GOOGLE_SA_EMAIL`
4. คลิก service account › แท็บ **Keys › Add key › Create new key › JSON** ได้ไฟล์ .json (ความลับ เก็บให้ดี ลบจากเครื่องเมื่อใส่ Vercel แล้ว)
   เปิดไฟล์ คัดลอกค่า `private_key` ทั้งก้อน (ขึ้นต้น `-----BEGIN PRIVATE KEY-----\n...`) → `GOOGLE_SA_PRIVATE_KEY`
   ใส่แบบบรรทัดเดียวที่มี `\n` ตามในไฟล์ได้เลย ระบบแปลง `\n` เป็นขึ้นบรรทัดใหม่ให้เอง
5. https://drive.google.com ด้วยบัญชี Workspace ของหน่วยงาน › **ไดรฟ์ที่แชร์ › ใหม่** ตั้งชื่อ `eSaraban`
6. ในไดรฟ์ `eSaraban` › **จัดการสมาชิก** › เพิ่มอีเมล service account ในข้อ 3 สิทธิ์ **ผู้จัดการเนื้อหา (Content manager)** › ไม่ต้องส่งอีเมลแจ้ง
   (เพิ่มผู้ดูแลระบบอีกคนเป็น "ผู้จัดการ" ไว้ด้วย กันไดรฟ์ไม่มีเจ้าของเมื่อคนใดคนหนึ่งย้ายออก)
7. สร้างโฟลเดอร์ เช่น `หนังสือรับ` ในไดรฟ์ `eSaraban` แล้วเปิดโฟลเดอร์นั้น
   ที่อยู่เว็บจะเป็น `https://drive.google.com/drive/folders/<รหัสโฟลเดอร์>` คัดลอกส่วน `<รหัสโฟลเดอร์>` → `SARABAN_DRIVE_FOLDER_ID`
   ตรวจว่าแถบที่อยู่ด้านบนขึ้น **ไดรฟ์ที่แชร์ › eSaraban** (ถ้าขึ้น "ไดรฟ์ของฉัน" คือโฟลเดอร์ธรรมดา ใช้ไม่ได้)

### 6.3 LINE OA (แจ้งกลุ่มครูเฉพาะหนังสือ "ด่วนที่สุด")
**ทำไมไม่ส่งทุกเล่ม:** LINE นับโควตาตาม**จำนวนสมาชิกที่ได้รับ** ส่ง 1 ข้อความเข้ากลุ่มครู 35 คน = 35 ข้อความ
หนังสือประมาณ 125 เล่ม/เดือน × 35 ≈ 4,400 ข้อความ เกินแพ็กเกจฟรีมาก ระบบจึงแจ้ง**รายบุคคลทาง Web Push (ฟรี ข้อ 6.4) ทุกเล่ม**
และส่งเข้ากลุ่ม LINE เฉพาะเล่ม**ด่วนที่สุด**ที่ ผอ. สั่งการ (ปรับเกณฑ์ได้ด้วย `SARABAN_LINE_MIN_URGENCY` = 0–3, 0 = ทุกเล่ม)
ดูโควตาคงเหลือได้ที่ LINE Official Account Manager › หน้าแรก/ข้อมูลการใช้งานข้อความ · หนังสือลับไม่เผยเรื่อง หน่วยงาน ข้อสั่งการ หรือผู้รับ

1. **สร้างบัญชี LINE OA** (ข้ามถ้าโรงเรียนมีแล้ว): https://manager.line.biz ล็อกอินด้วยบัญชี LINE ของผู้ดูแล › **สร้างบัญชี LINE Official Account**
   ชื่อ เช่น `สารบรรณ อนุบาลเทพสุนทรินทร์` หมวดหมู่ การศึกษา/โรงเรียน
2. **เปิด Messaging API:** LINE Official Account Manager › บัญชีนั้น › **ตั้งค่า (มุมขวาบน) › Messaging API › ใช้ Messaging API**
   › สร้าง Provider ใหม่ (ชื่อโรงเรียน) › ตกลง
3. **อนุญาตให้เข้ากลุ่ม:** ตั้งค่า › **ตั้งค่าบัญชี** › หัวข้อการตั้งค่าฟีเจอร์ › **"อนุญาตให้บัญชีเข้าร่วมแชทกลุ่มหรือแชทรวม" = ใช้**
4. **ปิดข้อความอัตโนมัติ** (ไม่อย่างนั้นบัญชีจะตอบกลับในกลุ่มและเปลืองโควตา): ตั้งค่า › **การตั้งค่าการตอบกลับ**
   › ข้อความทักทาย = ปิด · ข้อความตอบกลับอัตโนมัติ = ปิด · **Webhook = เปิด** (ใช้ชั่วคราวในข้อ 6)
5. **Channel access token:** https://developers.line.biz/console › Provider ในข้อ 2 › channel ของบัญชี › แท็บ **Messaging API**
   › เลื่อนล่างสุด **Channel access token (long-lived) › Issue** › คัดลอก → `LINE_CHANNEL_ACCESS_TOKEN` (ความลับ)
6. **หา group ID** (ทำครั้งเดียว — LINE ส่ง group ID ทาง webhook ตอนบัญชีเข้ากลุ่มเท่านั้น):
   1. เปิด https://webhook.site จะได้ที่อยู่ชั่วคราว (เช่น `https://webhook.site/xxxx`)
   2. LINE Developers › แท็บ **Messaging API › Webhook URL › Edit** ใส่ที่อยู่นั้น › Update › เปิด **Use webhook**
   3. ในแอป LINE: เพิ่มบัญชี OA เป็นเพื่อน (ค้นด้วย ID `@...` ในหน้าแรกของ OA Manager) › เปิดกลุ่ม LINE ครู › **เชิญ** › เลือกบัญชี OA
   4. หน้า webhook.site จะมีรายการ `"type": "join"` ดู `"source": {"type": "group", "groupId": "C..."}` คัดลอกค่าขึ้นต้นด้วย `C` → `LINE_GROUP_ID` (ความลับ)
   5. กลับไป**ลบ Webhook URL และปิด Use webhook** และปิด Webhook ในการตั้งค่าการตอบกลับ (ระบบส่งอย่างเดียว ไม่รับ webhook)
7. ใส่สองค่าใน Vercel (แบบ Secret, Production) แล้ว Redeploy
8. ทดสอบ: ลงรับหนังสือทดสอบ ชั้นความเร็ว **ด่วนที่สุด** › เสนอ › ผอ. สั่งการ (มอบหัวหน้าหรือครู) › ต้องมีข้อความเข้ากลุ่ม

### 6.4 แจ้งเตือนบนมือถือ (Web Push) และงานตั้งเวลา
1. ในเครื่องที่มี Node.js: `npx web-push generate-vapid-keys` ได้ Public Key และ Private Key
   - Public Key → `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
   - Private Key → `VAPID_PRIVATE_KEY` (ความลับ)
   - `VAPID_SUBJECT` = `mailto:<อีเมลผู้ดูแลระบบ>` (ไม่ตั้ง = `mailto:admin@anubantep.ac.th`)
   - สร้างครั้งเดียว ถ้าเปลี่ยนคีย์ ทุกคนต้องกด "เปิดการแจ้งเตือน" ใหม่
2. `CRON_SECRET` = ข้อความสุ่มยาว ๆ เช่นผลของ `openssl rand -hex 32`
   Vercel Cron (ตั้งไว้ใน `vercel.json`: วันจันทร์–ศุกร์ 07:00 น. เวลาไทย) ส่งค่านี้ให้ `/sis/saraban/api/cron/reminders` เองอัตโนมัติเมื่อตั้งเป็น Environment Variable
   ไม่ตั้ง = งานเตือนหนังสือใกล้ครบกำหนดตอบ 401 ไม่ทำงาน
3. `NEXT_PUBLIC_SITE_URL` = ที่อยู่หลักที่ครูเปิด เช่น `https://gotime.anubantep.ac.th` (ไม่ต้องใส่ `/sis`) ใช้สร้างลิงก์ในข้อความ LINE
4. iPhone: ครูต้อง "เพิ่มไปยังหน้าจอโฮม" แล้วเปิดจากไอคอนก่อน จึงจะเปิดการแจ้งเตือนได้ (ข้อจำกัดของ iOS)

### 6.5 สรุปค่าที่ต้องตั้ง
| ชื่อ | ค่า | ความลับ |
|---|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | แบบ ก.: Client ID (6.2 ก. ข้อ 4) | |
| `GOOGLE_OAUTH_CLIENT_SECRET` | แบบ ก.: Client secret (6.2 ก. ข้อ 4) | ✔ |
| `GOOGLE_SA_EMAIL` | แบบ ข.: อีเมล service account (6.2 ข. ข้อ 3) | |
| `GOOGLE_SA_PRIVATE_KEY` | แบบ ข.: `private_key` จากไฟล์ JSON (6.2 ข. ข้อ 4) | ✔ |
| `SARABAN_DRIVE_FOLDER_ID` | แบบ ข.: รหัสโฟลเดอร์ใน Shared Drive (6.2 ข. ข้อ 7) | ✔ |
| `LINE_CHANNEL_ACCESS_TOKEN` | channel access token (6.3 ข้อ 5) | ✔ |
| `LINE_GROUP_ID` | group ID ขึ้นต้น `C` (6.3 ข้อ 6) | ✔ |
| `SARABAN_LINE_MIN_URGENCY` | ไม่บังคับ: ส่ง LINE ตั้งแต่ความเร่งด่วนนี้ (ค่าเริ่มต้น 3 = ด่วนที่สุด) | |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | VAPID Public Key | |
| `VAPID_PRIVATE_KEY` | VAPID Private Key | ✔ |
| `VAPID_SUBJECT` | `mailto:...` (ไม่บังคับ) | |
| `CRON_SECRET` | ข้อความสุ่ม | ✔ |
| `NEXT_PUBLIC_SITE_URL` | เช่น `https://gotime.anubantep.ac.th` | |

ค่าลับทุกตัวอ่านเฉพาะฝั่งเซิร์ฟเวอร์ ไม่ถูกส่งไปเบราว์เซอร์ · `SARABAN_DRIVE_FAKE_DIR` ใช้เฉพาะทดสอบในเครื่อง **ห้ามตั้งบน Vercel**

### 6.6 กำหนดบทบาทและเริ่มใช้งาน
1. หน้า **ทะเบียนครู** › ชื่อครู › หัวข้อ "ระบบสารบรรณ" เลือกบทบาทแล้วกดบันทึก (ทำได้โดยผู้ดูแลระบบหรือผู้อำนวยการ):
   - ผู้อำนวยการ 1 คน, เจ้าหน้าที่ธุรการ, หัวหน้ากลุ่มงาน (ต้องระบุกลุ่มงาน เช่น วิชาการ งบประมาณ บุคคล บริหารทั่วไป)
   - ครูที่จะรับงานจากหัวหน้ากลุ่มงาน ให้ระบุกลุ่มงานเดียวกัน · ค่าเริ่มต้นของทุกคนคือ "ครู"
2. ผอ. และธุรการ: สารบรรณ › ตั้งค่า › อัปโหลดลายเซ็น (PNG) และกด "เปิดการแจ้งเตือน" บนมือถือของตน
3. ทดลองลงรับหนังสือทดสอบ 1 ฉบับ เกษียน และมอบหมาย ตรวจว่าไฟล์ขึ้นในโฟลเดอร์ของ Google Drive (6.2) ผู้รับได้แจ้งเตือนบนมือถือ และเล่มด่วนที่สุดมีข้อความเข้ากลุ่ม LINE
4. **ทดลองใช้ 2 สัปดาห์** กับธุรการ + ผอ. (ลงรับ เกษียน มอบหมาย) โดย**ใช้ระบบเดิมควบคู่** เมื่อไม่พบปัญหาจึงเปิดให้ครูทุกคนเปิดการแจ้งเตือนและใช้งาน

### 6.7 (ไม่บังคับ) ที่อยู่สั้น `/saraban`
ถ้าต้องการให้ `https://gotime.anubantep.ac.th/saraban` เปิดหน้าสารบรรณ ให้เพิ่มใน Caddyfile ของระบบลงเวลา (นอก repo นี้) ภายในบล็อกของ `gotime.anubantep.ac.th`:
```
redir /saraban /sis/saraban 302
redir /saraban/* /sis{uri} 302
```
แก้แล้ว `caddy reload` (`{uri}` มี `/saraban/...` อยู่แล้ว ปลายทางจึงเป็น `/sis/saraban/...`)

## 7. ข้อจำกัดของแพ็กเกจฟรีที่ควรรู้

| รายการ | แพ็กเกจฟรี | การใช้งานของโรงเรียน (ประมาณ) |
|---|---|---|
| ฐานข้อมูล Supabase | 500 MB | ข้อมูลเช็กชื่อ 3 อย่าง × 500 คน × 200 วัน ≈ 30–60 MB ต่อปี |
| พื้นที่ไฟล์ Supabase | 1 GB | รูปเยี่ยมบ้าน + ลายเซ็นสารบรรณ (ไฟล์ละไม่เกิน 200 KB) |
| Shared Drive (Google Workspace for Education) | ตามพื้นที่รวมของโรงเรียน | PDF สารบรรณ ประมาณ 1–3 GB ต่อปี |
| LINE OA | ดูในแพ็กเกจ (นับตามจำนวนผู้รับ) | เฉพาะเล่มด่วนที่สุด × จำนวนสมาชิกกลุ่ม (เล่มอื่นใช้ Web Push ฟรี) |
| Vercel | ใช้ส่วนตัว/ไม่แสวงกำไร | เว็บนี้ใช้ทรัพยากรน้อยมาก |

ถ้าเกินในอนาคต อัปเกรดเป็น Supabase Pro ได้โดยไม่ต้องย้ายข้อมูล
