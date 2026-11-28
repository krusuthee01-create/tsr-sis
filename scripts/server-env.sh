#!/usr/bin/env bash
# สร้างไฟล์ค่าตั้งของ TSR-SIS บนเซิร์ฟเวอร์ของโรงเรียน (/opt/tsr-sis/.env.production) โดยไม่ต้องใช้ Vercel
# ใช้เมื่อดึงค่าจาก Vercel ไม่ได้ (เช่น เข้าบัญชี Vercel ไม่ได้) — ค่าแต่ละตัวหาได้จากต้นทาง (ดูคำถาม)
# รัน (บนเซิร์ฟเวอร์ ในฐานะ root):  bash /opt/tsr-sis/scripts/server-env.sh
# - ค่าลับพิมพ์/วางแบบไม่แสดงบนจอ ไม่ลงประวัติคำสั่ง · ไฟล์สิทธิ์ 600 · สำรองไฟล์เดิมเป็น .env.production.bak
# - กด Enter ข้าม = ไม่ตั้งค่านั้น (ฟีเจอร์ที่ใช้ค่านั้นจะแจ้งว่ายังไม่ได้ตั้งค่า)
# - ห้ามส่งค่าเหล่านี้ทางแชต/อีเมล/LINE
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=".env.production"
GOTIME_ENV="${GOTIME_ENV:-/opt/school-platform/.env}"

declare -a LINES=()
declare -a NAMES=()

add() { # add NAME VALUE — ค่าเดี่ยวบรรทัดเดียว (ใส่ใน '...')
  local n="$1" v="$2"
  [ -z "$v" ] && return 0
  case "$v" in *"'"*|*$'\n'*) echo "  ✗ $n มีเครื่องหมาย ' หรือขึ้นบรรทัดใหม่ — ข้าม" >&2; return 0 ;; esac
  LINES+=("$n='$v'"); NAMES+=("$n")
}

ask() { # ask "คำถาม" [ค่าเริ่มต้น] — แสดงบนจอ (ค่าที่ไม่ลับ)
  local q="$1" d="${2:-}" v
  if [ -n "$d" ]; then read -rp "$q [$d]: " v; v="${v:-$d}"; else read -rp "$q: " v; fi
  v="${v//$'\r'/}"; v="${v#"${v%%[![:space:]]*}"}"; v="${v%"${v##*[![:space:]]}"}"
  printf '%s' "$v"
}

secret() { # secret "คำถาม" — ไม่แสดงบนจอ
  local v
  read -rsp "$1 (วางแล้วกด Enter · หน้าจอไม่แสดง · Enter เปล่า = ข้าม): " v; echo >&2
  v="${v//$'\r'/}"; v="${v#"${v%%[![:space:]]*}"}"; v="${v%"${v##*[![:space:]]}"}"
  printf '%s' "$v"
}

echo "== ค่าตั้ง TSR-SIS สำหรับเซิร์ฟเวอร์ของโรงเรียน =="
echo
echo "1) Supabase ของ TSR-SIS — supabase.com › โปรเจกต์ TSR-SIS › Project Settings › API"
U=$(ask "   Project URL (https://xxxx.supabase.co)")
case "$U" in https://*.supabase.co) ;; *) echo "   ต้องเป็น https://<รหัส>.supabase.co — ยกเลิก (ไม่มีอะไรถูกแก้)" >&2; exit 1 ;; esac
add NEXT_PUBLIC_SUPABASE_URL "$U"
A=$(ask "   Publishable key / anon key (ค่าสาธารณะ — ขึ้นต้น sb_publishable_ หรือ eyJ)")
[ -n "$A" ] || { echo "   ต้องมี anon key — ยกเลิก" >&2; exit 1; }
add NEXT_PUBLIC_SUPABASE_ANON_KEY "$A"
S=$(secret "   Secret key / service_role key (ความลับ)")
[ -n "$S" ] || { echo "   ต้องมี service role key — ยกเลิก" >&2; exit 1; }
add SUPABASE_SERVICE_ROLE_KEY "$S"; unset S

echo
echo "2) ที่อยู่หลักที่ครูเปิด (ใช้สร้างลิงก์ใน LINE และ redirect ของการเชื่อม Google Drive — ต้องตรงกับที่ตั้งใน Google Cloud)"
add NEXT_PUBLIC_SITE_URL "$(ask "   NEXT_PUBLIC_SITE_URL" "https://gotime.anubantep.ac.th")"
P=$(ask "   เปิดเข้าสู่ระบบด้วยชื่อผู้ใช้/รหัสผ่าน (บัญชีนักเรียน/ผู้ปกครอง)? 1 = เปิด, Enter = ปิด (ตรงกับ Vercel เดิม)")
[ "$P" = "1" ] && add NEXT_PUBLIC_ALLOW_PASSWORD_LOGIN 1

echo
echo "3) สารบรรณ ↔ Google Drive (ข้ามได้ถ้าไม่ใช้)"
echo "   แบบ ก. เชื่อมด้วยบัญชี Google — Google Cloud Console › APIs & Services › Credentials › OAuth client (ตัวเดิม)"
add GOOGLE_OAUTH_CLIENT_ID "$(ask "   Client ID (Enter = ข้าม)")"
add GOOGLE_OAUTH_CLIENT_SECRET "$(secret "   Client secret (สร้าง secret ใหม่ได้ใน Console · ของเดิมยังใช้ได้)")"
echo "   แบบ ข. service account + Shared Drive"
add GOOGLE_SA_EMAIL "$(ask "   อีเมล service account (Enter = ข้าม)")"
KF=$(ask "   path ไฟล์ JSON ของ key บนเซิร์ฟเวอร์ (คัดลอกขึ้นเครื่องด้วย scp ก่อน · Enter = ข้าม)")
if [ -n "$KF" ]; then
  if [ -f "$KF" ] && command -v python3 >/dev/null 2>&1; then
    K=$(python3 -c 'import json,sys; k=json.load(open(sys.argv[1]))["private_key"]; print(k.replace("\n","\\n"))' "$KF") || K=""
    if [ -n "$K" ]; then LINES+=("GOOGLE_SA_PRIVATE_KEY=\"$K\""); NAMES+=(GOOGLE_SA_PRIVATE_KEY); unset K
         echo "   ✓ อ่าน private_key แล้ว — ลบไฟล์ JSON ทิ้งได้: shred -u '$KF'"
    else echo "   ✗ อ่าน private_key จากไฟล์ไม่ได้ — ข้าม" >&2; fi
  else echo "   ✗ ไม่พบไฟล์หรือไม่มี python3 — ข้าม" >&2; fi
fi
add SARABAN_DRIVE_FOLDER_ID "$(ask "   รหัสโฟลเดอร์ใน Shared Drive (ท้ายลิงก์ drive.google.com/drive/folders/<รหัส> · Enter = ข้าม)")"

echo
echo "4) LINE กลุ่มสารบรรณ — LINE Developers › Channel › Messaging API (ข้ามได้)"
add LINE_CHANNEL_ACCESS_TOKEN "$(secret "   Channel access token (long-lived)")"
add LINE_GROUP_ID "$(secret "   Group ID (ขึ้นต้น C)")"
add SARABAN_LINE_MIN_URGENCY "$(ask "   ส่ง LINE ตั้งแต่ความเร่งด่วน 0–3 (Enter = ค่าเริ่มต้น 3 ด่วนที่สุด)")"

echo
echo "5) การแจ้งเตือนของ TSR-SIS (VAPID)"
G_PUB=$( [ -f "$GOTIME_ENV" ] && sed -n "s/^NEXT_PUBLIC_VAPID_PUBLIC_KEY=//p" "$GOTIME_ENV" | tr -d "\"'" || true)
G_PRIV=$( [ -f "$GOTIME_ENV" ] && sed -n "s/^VAPID_PRIVATE_KEY=//p" "$GOTIME_ENV" | tr -d "\"'" || true)
SAME=""
if [ -n "$G_PUB" ] && [ -n "$G_PRIV" ]; then
  # TSR-SIS บน Vercel ใช้คีย์ชุดเดียวกับระบบลงเวลาหรือไม่ — ค้นคีย์สาธารณะในไฟล์ JS ของหน้าเว็บ (ค่าสาธารณะ)
  BASE="${SIS_CHECK_URL:-https://tsr-sis.vercel.app}"
  for page in /sis/login /sis /sis/me /sis/saraban; do
    for js in $(curl -fsS --max-time 15 "$BASE$page" 2>/dev/null | grep -o '/sis/_next/static/[^"]*\.js' | sort -u); do
      if curl -fsS --max-time 15 "$BASE$js" 2>/dev/null | grep -qF "$G_PUB"; then SAME=1; break 2; fi
    done
  done
fi
if [ -n "$SAME" ]; then
  echo "   ✓ TSR-SIS ใช้คีย์ชุดเดียวกับระบบลงเวลา → ใช้ต่อ (การแจ้งเตือนที่ครูเปิดไว้ทำงานต่อ)"
  add NEXT_PUBLIC_VAPID_PUBLIC_KEY "$G_PUB"; add VAPID_PRIVATE_KEY "$G_PRIV"
else
  echo "   ไม่พบว่าใช้คีย์ร่วมกับระบบลงเวลา"
  V=$(ask "   มีคีย์ VAPID เดิมของ TSR-SIS ไหม? y = ใส่เอง, Enter = สร้างใหม่ (ครูต้องกดเปิดแจ้งเตือนของ TSR-SIS ใหม่ 1 ครั้ง)")
  if [ "$V" = "y" ]; then
    add NEXT_PUBLIC_VAPID_PUBLIC_KEY "$(ask "   Public key")"
    add VAPID_PRIVATE_KEY "$(secret "   Private key")"
  else
    J=$(docker run --rm node:22-bookworm-slim npx -y web-push@3.6.7 generate-vapid-keys --json 2>/dev/null | tail -1)
    PUB=$(printf '%s' "$J" | python3 -c 'import json,sys; print(json.load(sys.stdin)["publicKey"])')
    PRIV=$(printf '%s' "$J" | python3 -c 'import json,sys; print(json.load(sys.stdin)["privateKey"])')
    [ -n "$PUB" ] && [ -n "$PRIV" ] || { echo "   ✗ สร้างคีย์ไม่สำเร็จ — ยกเลิก" >&2; exit 1; }
    add NEXT_PUBLIC_VAPID_PUBLIC_KEY "$PUB"; add VAPID_PRIVATE_KEY "$PRIV"; unset J PRIV
    echo "   ✓ สร้างคีย์ใหม่แล้ว"
  fi
fi
unset G_PRIV
add VAPID_SUBJECT "$(ask "   VAPID_SUBJECT" "mailto:admin@anubantep.ac.th")"

echo
echo "6) รหัสงานตามเวลา (สร้างใหม่อัตโนมัติ — ใช้กับตัวตั้งเวลาบนเซิร์ฟเวอร์)"
add CRON_SECRET "$(openssl rand -hex 32)"

umask 077
[ -f "$OUT" ] && cp "$OUT" "$OUT.bak"
printf '%s\n' "# สร้างโดย scripts/server-env.sh $(date +%F) — ห้ามส่งไฟล์นี้ให้ใคร" "${LINES[@]}" > "$OUT.tmp"
chmod 600 "$OUT.tmp"; mv "$OUT.tmp" "$OUT"
echo
echo "บันทึก $(pwd)/$OUT แล้ว (สิทธิ์ 600) · ค่าที่ตั้ง: ${NAMES[*]}"
