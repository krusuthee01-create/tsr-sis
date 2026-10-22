#!/usr/bin/env bash
# เปิด Supabase จำลองในเครื่อง (ไม่ต้องใช้ Docker) สำหรับพัฒนาและทดสอบ:
#   PostgreSQL ที่รันอยู่แล้ว (ค่าเริ่มต้น 127.0.0.1:54329 ผู้ใช้ postgres แบบ trust)
#   + Supabase Auth (GoTrue) + PostgREST + gateway ที่พอร์ต 54321
# ใช้: scripts/local-stack/start.sh  แล้วนำค่าที่พิมพ์ออกมาไปใส่ .env.local
set -euo pipefail
cd "$(dirname "$0")"
DIR="${STACK_DIR:-/tmp/tsr-stack}"
PGURL="${PGURL:-postgres://postgres@127.0.0.1:54329}"
DB="${DB:-tsr_e2e}"
export JWT_SECRET="${JWT_SECRET:-local-e2e-secret-at-least-32-characters-long}"
mkdir -p "$DIR/bin"

if [ ! -x "$DIR/bin/postgrest" ]; then
  curl -sSL https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz | tar -xJ -C "$DIR/bin"
fi
if [ ! -x "$DIR/bin/auth/auth" ]; then
  mkdir -p "$DIR/bin/auth"
  curl -sSL https://github.com/supabase/auth/releases/download/v2.169.0/auth-v2.169.0-x86.tar.gz | tar -xz -C "$DIR/bin/auth"
fi

psql "$PGURL/postgres" -qc "drop database if exists $DB" -c "create database $DB"
psql "$PGURL/$DB" -q -v ON_ERROR_STOP=1 <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator login password 'pw' noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='supabase_auth_admin') then create role supabase_auth_admin login password 'pw' createrole; end if;
end $$;
grant anon, authenticated, service_role to authenticator;
create schema if not exists auth authorization supabase_auth_admin;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
SQL
psql "$PGURL/postgres" -qc "grant create on database $DB to supabase_auth_admin"

HOSTPORT="${PGURL#postgres://postgres@}"
(cd "$DIR/bin/auth" && GOTRUE_DB_DRIVER=postgres DATABASE_URL="postgres://supabase_auth_admin:pw@$HOSTPORT/$DB?search_path=auth&sslmode=disable" \
  GOTRUE_SITE_URL=http://localhost:3000 API_EXTERNAL_URL=http://localhost:54321/auth/v1 GOTRUE_API_HOST=127.0.0.1 PORT=9999 \
  GOTRUE_JWT_SECRET="$JWT_SECRET" GOTRUE_JWT_AUD=authenticated GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated GOTRUE_JWT_ADMIN_ROLES=service_role GOTRUE_JWT_EXP=3600 \
  GOTRUE_MAILER_AUTOCONFIRM=true GOTRUE_EXTERNAL_EMAIL_ENABLED=true GOTRUE_DISABLE_SIGNUP=true \
  nohup ./auth > "$DIR/auth.log" 2>&1 &)
sleep 5
for f in ../../supabase/migrations/*.sql; do psql "$PGURL/$DB" -q -v ON_ERROR_STOP=1 -f "$f"; done

cat > "$DIR/pgrst.conf" <<CONF
db-uri = "postgres://authenticator:pw@$HOSTPORT/$DB"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$JWT_SECRET"
server-host = "127.0.0.1"
server-port = 3001
CONF
nohup "$DIR/bin/postgrest" "$DIR/pgrst.conf" > "$DIR/pgrst.log" 2>&1 &
nohup node proxy.mjs > "$DIR/proxy.log" 2>&1 &
sleep 2
node jwt.mjs > "$DIR/keys.env"
. "$DIR/keys.env"
echo "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321"
echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON"
echo "SUPABASE_SERVICE_ROLE_KEY=$SERVICE"
# ผู้ใช้ทดสอบ: admin.test / krusomjai รหัสผ่าน pass1234
for n in admin.test krusomjai; do
  curl -s -o /dev/null -X POST http://127.0.0.1:54321/auth/v1/admin/users -H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" \
    -H "Content-Type: application/json" -d "{\"email\":\"$n@users.tsr-sis.local\",\"password\":\"pass1234\",\"email_confirm\":true,\"user_metadata\":{\"full_name\":\"ทดสอบ $n\"}}"
done
