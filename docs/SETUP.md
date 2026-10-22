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
  - Site URL: ที่อยู่เว็บจริง เช่น `https://tsr-sis.vercel.app`
  - Redirect URLs: เพิ่ม `https://tsr-sis.vercel.app/auth/callback`
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
4. กด **Deploy** ระบบใช้ภูมิภาค Singapore (`sin1`) ตามไฟล์ `vercel.json` ให้อัตโนมัติ
5. ถ้าต้องการชื่อเว็บของโรงเรียนเอง (ประมาณ 500 บาท/ปี) เพิ่มได้ที่ Settings › Domains
   แล้วอย่าลืมแก้ Site URL และ Redirect URLs ในข้อ 2.2 ให้ตรงกัน

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

## 6. ข้อจำกัดของแพ็กเกจฟรีที่ควรรู้

| รายการ | แพ็กเกจฟรี | การใช้งานของโรงเรียน (ประมาณ) |
|---|---|---|
| ฐานข้อมูล Supabase | 500 MB | ข้อมูลเช็กชื่อ 3 อย่าง × 500 คน × 200 วัน ≈ 30–60 MB ต่อปี |
| พื้นที่ไฟล์ Supabase | 1 GB | ใช้ในเฟส 2 (รูปเยี่ยมบ้าน) |
| Vercel | ใช้ส่วนตัว/ไม่แสวงกำไร | เว็บนี้ใช้ทรัพยากรน้อยมาก |

ถ้าเกินในอนาคต อัปเกรดเป็น Supabase Pro ได้โดยไม่ต้องย้ายข้อมูล
