# การสำรองและกู้คืนระบบ TSR-SIS

เอกสารนี้บอกว่าข้อมูลแต่ละส่วนเก็บอยู่ที่ไหน สำรองอย่างไร และกู้คืนอย่างไร
**ไม่มีรหัสผ่านหรือกุญแจในเอกสารนี้** ค่าเหล่านั้นให้เก็บในตัวจัดการรหัสผ่านของผู้ดูแลระบบ

## ส่วนประกอบของระบบ

| ส่วน | อยู่ที่ | สำรองโดย |
|---|---|---|
| โค้ดทั้งหมด + โครงสร้างฐานข้อมูล (supabase/migrations) | GitHub `krusuthee01-create/tsr-sis` | GitHub เก็บประวัติทุกครั้งที่บันทึก + ไฟล์ `.bundle` ที่ดาวน์โหลดเก็บไว้ |
| ข้อมูลในฐานข้อมูล (นักเรียน เช็กชื่อ โภชนาการ ดูแลช่วยเหลือ ผลการเรียน บัญชีผู้ใช้) | Supabase โปรเจกต์ `tsr-sis` | GitHub Actions "สำรองข้อมูลรายสัปดาห์" ทุกวันอาทิตย์ 02:23 น. เข้ารหัส เก็บ 90 วัน |
| รูปเยี่ยมบ้าน | Supabase Storage bucket `home-visits` | Workflow เดียวกัน (เมื่อตั้ง secret SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY) |
| ข้อมูลสารบรรณ (ทะเบียนหนังสือรับ การเกษียน ผู้รับ) | ตาราง `saraban_*` ใน Supabase | อยู่ในไฟล์สำรองฐานข้อมูลรายสัปดาห์เดียวกัน |
| PDF สารบรรณ | Shared Drive `eSaraban` ใน Google Workspace ของโรงเรียน (ไม่อยู่ใน Supabase) | Google เก็บให้ (ถังขยะ Shared Drive เก็บไฟล์ที่ลบ 30 วัน) · ระบบไม่ลบไฟล์เอง (ลบหนังสือ = ซ่อนในระบบ ไฟล์ยังอยู่) |
| ลายเซ็น (สารบรรณ) | Supabase Storage bucket `signatures` | Workflow เดียวกับรูปเยี่ยมบ้าน (`scripts/backup-storage.mjs`) |
| เว็บไซต์ | Vercel โปรเจกต์ `tsr-sis` ทุกหน้าอยู่ใต้ `/sis` เปิดได้ที่ gotime.anubantep.ac.th/sis (ผ่าน Caddy ของระบบลงเวลา), sis.anubantep.ac.th/sis และ tsr-sis.vercel.app/sis | สร้างใหม่ได้จากโค้ดบน GitHub |
| การตั้งค่า | Vercel (Environment Variables), Supabase (Authentication), Google Cloud (OAuth, service account สารบรรณ), LINE Developers, DNS (CNAME `sis`) | จดไว้ในหัวข้อ "ค่าที่ต้องตั้งเมื่อติดตั้งใหม่" |

## ดาวน์โหลดไฟล์สำรองฐานข้อมูล (ทำเดือนละครั้ง)
ไฟล์ใน GitHub หมดอายุใน 90 วัน ควรดาวน์โหลดเก็บใน Google Drive ของโรงเรียนเดือนละครั้ง
1. GitHub › repository `tsr-sis` › แท็บ **Actions** › **สำรองข้อมูลรายสัปดาห์**
2. คลิกรายการล่าสุดที่มีเครื่องหมายถูกสีเขียว
3. เลื่อนลงหัวข้อ **Artifacts** › คลิกชื่อ `tsr-sis-ปปปป-ดด-วว` จะได้ไฟล์ .zip
4. เก็บไฟล์ .zip ใน Google Drive โฟลเดอร์ที่จำกัดผู้เข้าถึง ไฟล์เข้ารหัสไว้แล้ว เปิดได้ด้วย BACKUP_PASSPHRASE เท่านั้น

## กู้คืนฐานข้อมูล
ทำเมื่อข้อมูลเสียหายหรือย้ายไปโปรเจกต์ Supabase ใหม่ (ควรให้ผู้มีความรู้ด้าน PostgreSQL ช่วย)
```bash
# 1) ถอดรหัส (ถามรหัส BACKUP_PASSPHRASE)
gpg -d tsr-sis-2569-11-17.dump.gpg > tsr-sis.dump
# 2) โปรเจกต์ใหม่: รันไฟล์ supabase/migrations ทั้งหมดตามลำดับก่อน แล้วนำข้อมูลเข้า
pg_restore --data-only --disable-triggers --no-owner -d "<SUPABASE_DB_URL>" tsr-sis.dump
# กู้ทับโปรเจกต์เดิมที่ข้อมูลเสีย: ใช้ --clean แทน --data-only (ลบของเดิมก่อน) และสำรองของปัจจุบันไว้ก่อนเสมอ
```

## กู้คืนรูปเยี่ยมบ้านและลายเซ็น
```bash
gpg -d tsr-sis-2569-11-17-photos.tar.gz.gpg | tar -xz
# ได้โฟลเดอร์ home-visits/<รหัสนักเรียน>/<ไฟล์>.jpg อัปโหลดกลับเข้า bucket home-visits ที่ path เดิม
# และ signatures/<รหัสครู>/signature.png อัปโหลดกลับเข้า bucket signatures ที่ path เดิม
# (ไม่มีไฟล์สำรองลายเซ็น: ให้ ผอ./ครู อัปโหลดใหม่ที่ สารบรรณ › ตั้งค่า)
```

## กู้คืน PDF สารบรรณ
- ไฟล์ถูกลบใน Drive โดยไม่ตั้งใจ: Shared Drive `eSaraban` › **ถังขยะ** › กู้คืน (ภายใน 30 วัน) ระบบเปิดได้ตามเดิมเพราะรหัสไฟล์ไม่เปลี่ยน
- service account ถูกลบ/คีย์รั่ว: สร้างคีย์ใหม่ (docs/SETUP.md หัวข้อ 6.2) ใส่ `GOOGLE_SA_PRIVATE_KEY` ใหม่ใน Vercel แล้ว Redeploy และลบคีย์เก่าใน Google Cloud
  ถ้าสร้าง service account ใหม่ ต้องเพิ่มอีเมลใหม่เป็นผู้จัดการเนื้อหาของ Shared Drive ด้วย
- ย้าย Shared Drive/โฟลเดอร์ใหม่: ไฟล์เดิมต้องอยู่ใน Shared Drive ที่ service account เข้าถึงได้ (ระบบเปิดไฟล์ด้วยรหัสไฟล์ ไม่ใช่ชื่อโฟลเดอร์) แก้ `SARABAN_DRIVE_FOLDER_ID` เฉพาะไฟล์ที่อัปโหลดใหม่

## ค่าที่ต้องตั้งเมื่อติดตั้งใหม่
| ที่ | ค่า |
|---|---|
| Vercel › Settings › Environment Variables | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable key), `SUPABASE_SERVICE_ROLE_KEY` (secret key) และค่าไม่บังคับใน docs/SETUP.md |
| Vercel › Settings › Domains | `sis.anubantep.ac.th` |
| DNS ของ anubantep.ac.th | CNAME `sis` → ค่าที่ Vercel แสดง |
| Supabase › Authentication › URL Configuration | Site URL และ Redirect URLs ตาม docs/SETUP.md หัวข้อ 2.2 (ทุกที่อยู่ต้องลงท้าย `/sis/...`) |
| Supabase › Authentication › Providers › Google | Client ID / Secret จาก Google Cloud |
| Google Cloud › OAuth Client | Authorized redirect URI = `https://<project>.supabase.co/auth/v1/callback` |
| Vercel › Environment Variables (สารบรรณ) | `GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY`, `SARABAN_DRIVE_FOLDER_ID`, `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_GROUP_ID`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_SECRET`, `NEXT_PUBLIC_SITE_URL` (docs/SETUP.md หัวข้อ 6) — VAPID ใช้คู่เดิม ไม่อย่างนั้นทุกคนต้องเปิดการแจ้งเตือนใหม่ |
| Shared Drive `eSaraban` | service account เป็นผู้จัดการเนื้อหา |
| GitHub › Settings › Secrets › Actions | `SUPABASE_DB_URL`, `BACKUP_PASSPHRASE`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` (keepalive), `SUPABASE_SERVICE_ROLE_KEY` (สำรองรูปและลายเซ็น) |

ขั้นตอนติดตั้งละเอียดอยู่ใน `docs/SETUP.md`
