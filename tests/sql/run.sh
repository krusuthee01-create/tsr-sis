#!/usr/bin/env bash
# ทดสอบ migration บน PostgreSQL ในเครื่อง: tests/sql/run.sh <psql connection args...>
# แต่ละไฟล์ *_test.sql รันบนฐานข้อมูลใหม่ที่สร้างจาก migration ทั้งหมด
set -euo pipefail
cd "$(dirname "$0")/../.."
PSQL=(psql -v ON_ERROR_STOP=1 -q "$@")
for t in tests/sql/*_test.sql; do
  "${PSQL[@]}" -d postgres -c "drop database if exists tsr_test" -c "create database tsr_test"
  "${PSQL[@]}" -d tsr_test -f tests/sql/supabase_stub.sql
  for f in supabase/migrations/*.sql; do "${PSQL[@]}" -d tsr_test -f "$f"; done
  "${PSQL[@]}" -d tsr_test -f "$t" > /dev/null
  echo "ผ่าน: $t"
done
echo "ผ่านทุกการทดสอบ SQL"
