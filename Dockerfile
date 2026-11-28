# syntax=docker/dockerfile:1
# TSR-SIS บนเซิร์ฟเวอร์ของโรงเรียน (เครื่องเดียวกับระบบลงเวลา gotime) — Next.js output: standalone, basePath /sis
# build: docker compose ของ school-platform (บริการ sis) · ไม่มีค่าลับใน image:
#   ค่าตั้งอ่านจาก secret "sis_env" (= /opt/tsr-sis/.env.production) เฉพาะตอน build (NEXT_PUBLIC_* ถูกฝังในโค้ดฝั่งเบราว์เซอร์)
#   และตอนรันจาก env_file ของ compose

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# .env.production มาจาก secret (ไม่อยู่ใน layer ใด ๆ ของ image) — Next อ่านไฟล์นี้เองตอน build
RUN --mount=type=secret,id=sis_env,target=/app/.env.production,required=true npm run build
# กันพลาด: ไฟล์ค่าตั้งต้องไม่หลุดเข้า standalone (ถ้ามี build ล้มทันที — ไม่ปล่อยค่าลับเข้า image)
RUN if ls -A .next/standalone | grep -q '^\.env'; then echo "พบไฟล์ .env ใน standalone" >&2; exit 1; fi

FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 DEPLOY_ENV=production
WORKDIR /app
RUN groupadd --system --gid 1001 app && useradd --system --uid 1001 --gid app app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/sis/login').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
