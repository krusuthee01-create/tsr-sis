// Google Drive ของสารบรรณ (ฝั่งเซิร์ฟเวอร์เท่านั้น): token, เปิด resumable session, อ่าน metadata, ส่งต่อไฟล์
// ใช้ fetch + node:crypto ไม่มี dependency เพิ่ม
// วิธีเชื่อมต่อ (เลือกตามลำดับ):
//   1) โหมดจำลอง: ตั้ง SARABAN_DRIVE_FAKE_DIR (ทดสอบ/e2e) ใช้ไฟล์ในโฟลเดอร์นั้นแทน (<id>.pdf + <id>.json)
//   2) บัญชี Google ของโรงเรียน (OAuth): ผู้ดูแลกด "เชื่อมต่อ Google Drive" ในหน้าตั้งค่าสารบรรณ
//      ระบบเก็บ refresh token + โฟลเดอร์ในตาราง saraban_drive_config (service_role เท่านั้น) ไฟล์ใช้พื้นที่ของบัญชีนั้น
//   3) service account + Shared Drive: GOOGLE_SA_EMAIL, GOOGLE_SA_PRIVATE_KEY, SARABAN_DRIVE_FOLDER_ID
// ไฟล์นี้ต้อง import ได้จาก node --test ตรง ๆ จึงห้ามใช้ alias @/ หรือโมดูลเฉพาะของ Next
import { createSign, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SCOPE = "https://www.googleapis.com/auth/drive";
// OAuth ใช้ drive.file: เห็นเฉพาะไฟล์/โฟลเดอร์ที่ระบบนี้สร้างเอง ไม่เห็นไฟล์อื่นในไดรฟ์ของบัญชีนั้น
export const OAUTH_SCOPES = "openid email https://www.googleapis.com/auth/drive.file";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const FOLDER_NAME = "eSaraban - หนังสือรับ (ห้ามลบ)";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";

export type DriveFileMeta = { id: string; name: string; size: number; parents: string[]; appProperties: Record<string, string> };

const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64url");

/** JWT สำหรับแลก access token ของ service account (RS256, อายุ 1 ชั่วโมง) */
export function buildServiceJwt(email: string, privateKeyPem: string, nowSec: number): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iss: email, scope: SCOPE, aud: TOKEN_URL, iat: nowSec, exp: nowSec + 3600 }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(normalizePrivateKey(privateKeyPem)).toString("base64url")}`;
}

/**
 * private key จาก env: ตัดช่องว่างและเครื่องหมายคำพูดครอบ (คัดลอกจากไฟล์ JSON มาทั้ง "...")
 * แล้วแปลง \n แบบตัวอักษร (env บน Vercel มักเก็บแบบนี้) เป็นขึ้นบรรทัดใหม่
 */
export function normalizePrivateKey(raw: string): string {
  let key = raw.trim();
  if (key.length >= 2 && key.startsWith('"') && key.endsWith('"')) key = key.slice(1, -1).trim();
  return key.includes("\\n") ? key.replace(/\\n/g, "\n") : key;
}

/** โหมดจำลอง (ทดสอบ/e2e) — ปิดเสมอบน production แม้ตั้ง SARABAN_DRIVE_FAKE_DIR ไว้โดยพลาด
 *  (Vercel: VERCEL_ENV=production · เซิร์ฟเวอร์ของโรงเรียน: image Docker ตั้ง DEPLOY_ENV=production ไว้ในตัว) */
export function isFakeDrive(): boolean {
  return (
    Boolean(process.env.SARABAN_DRIVE_FAKE_DIR) &&
    process.env.VERCEL_ENV !== "production" &&
    process.env.DEPLOY_ENV !== "production"
  );
}

function fakeDir(): string | null {
  return isFakeDrive() ? process.env.SARABAN_DRIVE_FAKE_DIR! : null;
}

/** วิธีเชื่อมต่อ Drive ที่ใช้อยู่ */
export type DriveSetup =
  | { mode: "fake"; folderId: string }
  | { mode: "oauth"; folderId: string; refreshToken: string }
  | { mode: "service"; folderId: string };

/** ข้อผิดพลาดที่ผู้ดูแลต้องแก้ (ยังไม่เชื่อมต่อ / การเชื่อมต่อหมดอายุ) — ข้อความภาษาไทยแสดงผู้ใช้ได้ */
export class DriveSetupError extends Error {}

const NOT_CONNECTED = "ยังไม่ได้เชื่อมต่อ Google Drive (ผู้ดูแลระบบ: สารบรรณ › ตั้งค่า › เชื่อมต่อ Google Drive)";
const SETUP_TTL_MS = 60_000;
let setupCache: { setup: DriveSetup; at: number } | null = null;

/** ล้าง cache หลังเชื่อมต่อใหม่ (instance อื่นของเซิร์ฟเวอร์จะเห็นภายใน 60 วินาที) */
export function clearDriveSetupCache() {
  setupCache = null;
  cached = null;
}

/** การเชื่อมต่อแบบ OAuth ที่บันทึกไว้ (อ่านด้วย service role ผ่าน REST — ตารางนี้ไม่เปิดให้ผู้ใช้ทั่วไป) */
export async function readOauthConfig(): Promise<{ refreshToken: string; folderId: string; accountEmail: string | null } | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const res = await fetch(`${url}/rest/v1/saraban_drive_config?id=eq.1&select=refresh_token,folder_id,account_email`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`อ่านการเชื่อมต่อ Google Drive ไม่สำเร็จ (${res.status})`);
  const rows = (await res.json()) as { refresh_token: string; folder_id: string; account_email: string | null }[];
  const r = rows[0];
  return r?.refresh_token && r.folder_id ? { refreshToken: r.refresh_token, folderId: r.folder_id, accountEmail: r.account_email } : null;
}

/** เลือกวิธีเชื่อมต่อ: จำลอง → บัญชีโรงเรียน (OAuth) → service account (cache 60 วินาที) */
export async function getDriveSetup(): Promise<DriveSetup> {
  if (fakeDir()) return { mode: "fake", folderId: process.env.SARABAN_DRIVE_FOLDER_ID || "fake-folder" };
  if (setupCache && Date.now() - setupCache.at < SETUP_TTL_MS) return setupCache.setup;
  let setup: DriveSetup | null = null;
  const oauth = await readOauthConfig();
  if (oauth) setup = { mode: "oauth", folderId: oauth.folderId, refreshToken: oauth.refreshToken };
  else if (process.env.GOOGLE_SA_EMAIL && process.env.GOOGLE_SA_PRIVATE_KEY && process.env.SARABAN_DRIVE_FOLDER_ID) {
    setup = { mode: "service", folderId: process.env.SARABAN_DRIVE_FOLDER_ID };
  }
  if (!setup) throw new DriveSetupError(NOT_CONNECTED);
  setupCache = { setup, at: Date.now() };
  return setup;
}

/** id ของโฟลเดอร์ที่เก็บไฟล์สารบรรณ */
export async function driveFolderId(): Promise<string> {
  return (await getDriveSetup()).folderId;
}

/** id ไฟล์ของ Drive เป็นตัวอักษร ตัวเลข - _ เท่านั้น — กันการแทรก path/URL */
function assertFileId(id: string) {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) throw new Error("รหัสไฟล์ไม่ถูกต้อง");
}

let cached: { token: string; exp: number; key: string } | null = null;

function oauthClient(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new DriveSetupError("ยังไม่ได้ตั้งค่า GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET");
  return { clientId, clientSecret };
}

/** พารามิเตอร์ขอ access token จาก refresh token (แยกไว้ทดสอบได้) */
export function refreshTokenBody(clientId: string, clientSecret: string, refreshToken: string): URLSearchParams {
  return new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken });
}

/** access token ตามวิธีเชื่อมต่อ (เก็บไว้ในหน่วยความจำจนเหลืออายุไม่ถึง 60 วินาที) */
export async function getAccessToken(): Promise<string> {
  const setup = await getDriveSetup();
  const now = Math.floor(Date.now() / 1000);
  const cacheKey = setup.mode === "oauth" ? `oauth:${setup.refreshToken.slice(-12)}` : setup.mode;
  if (cached && cached.key === cacheKey && cached.exp - now >= 60) return cached.token;

  let body: URLSearchParams;
  if (setup.mode === "oauth") {
    const { clientId, clientSecret } = oauthClient();
    body = refreshTokenBody(clientId, clientSecret, setup.refreshToken);
  } else {
    const email = process.env.GOOGLE_SA_EMAIL;
    const key = process.env.GOOGLE_SA_PRIVATE_KEY;
    if (!email || !key) throw new DriveSetupError("ยังไม่ได้ตั้งค่า GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY");
    body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: buildServiceJwt(email, key, now) });
  }
  const res = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null;
    if (setup.mode === "oauth" && err?.error === "invalid_grant") {
      setupCache = null;
      throw new DriveSetupError("การเชื่อมต่อ Google Drive หมดอายุหรือถูกยกเลิก ผู้ดูแลระบบต้องกด \"เชื่อมต่อ Google Drive\" ใหม่ในหน้าตั้งค่าสารบรรณ");
    }
    throw new Error(`ขอ token ของ Google ไม่สำเร็จ (${res.status})`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: data.access_token, exp: now + data.expires_in, key: cacheKey };
  return data.access_token;
}

// ---------- เชื่อมต่อด้วยบัญชี Google ของโรงเรียน (OAuth) ----------

/** หน้ายินยอมของ Google: ขอ refresh token (offline + consent) เฉพาะสิทธิ์ drive.file */
export function buildConsentUrl(opts: { clientId: string; redirectUri: string; state: string; loginHint?: string }): string {
  const q = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: OAUTH_SCOPES,
    access_type: "offline",
    prompt: "consent",
    state: opts.state,
  });
  if (opts.loginHint) q.set("login_hint", opts.loginHint);
  return `${AUTH_URL}?${q}`;
}

/** อีเมลจาก id_token (ได้จาก token endpoint ของ Google โดยตรงผ่าน TLS จึงไม่ต้องตรวจลายเซ็นซ้ำ) */
export function emailFromIdToken(idToken: string | undefined): string | null {
  const part = idToken?.split(".")[1];
  if (!part) return null;
  try {
    const p = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as { email?: unknown };
    return typeof p.email === "string" ? p.email : null;
  } catch {
    return null;
  }
}

/** แลก code จากหน้ายินยอมเป็น refresh token + access token + อีเมลบัญชี */
export async function exchangeAuthCode(code: string, redirectUri: string): Promise<{ refreshToken: string | null; accessToken: string; email: string | null }> {
  const { clientId, clientSecret } = oauthClient();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret }),
  });
  if (!res.ok) throw new Error(`แลก code กับ Google ไม่สำเร็จ (${res.status})`);
  const d = (await res.json()) as { access_token: string; refresh_token?: string; id_token?: string };
  return { refreshToken: d.refresh_token ?? null, accessToken: d.access_token, email: emailFromIdToken(d.id_token) };
}

/** ใช้โฟลเดอร์เดิมถ้ายังอยู่ (ไม่อยู่ในถังขยะ) ไม่อย่างนั้นสร้างโฟลเดอร์ใหม่ในไดรฟ์ของบัญชีที่เชื่อมต่อ */
export async function ensureFolder(accessToken: string, existingId?: string | null): Promise<string> {
  const auth = { Authorization: `Bearer ${accessToken}` };
  if (existingId && /^[A-Za-z0-9_-]{1,200}$/.test(existingId)) {
    const res = await fetch(`${API}/${existingId}?fields=id,trashed`, { headers: auth });
    if (res.ok) {
      const f = (await res.json()) as { id: string; trashed?: boolean };
      if (!f.trashed) return f.id;
    }
  }
  const res = await fetch(`${API}?fields=id`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
  });
  if (!res.ok) throw new Error(`สร้างโฟลเดอร์ใน Google Drive ไม่สำเร็จ (${res.status})`);
  return ((await res.json()) as { id: string }).id;
}

/**
 * เปิด resumable upload session แล้วคืน URL ให้เบราว์เซอร์ PUT ไฟล์ตรงเข้า Drive
 * appProperties ถูกกำหนดที่นี่ (ฝั่งเซิร์ฟเวอร์) เบราว์เซอร์แก้ไม่ได้ — ใช้ยืนยันไฟล์ตอน finalize
 */
export async function createUploadSession(opts: {
  name: string;
  size: number;
  mime: "application/pdf";
  origin: string;
  appProperties: { bookId: string; kind: string; uploader: string };
}): Promise<string> {
  const dir = fakeDir();
  if (dir) {
    const id = randomUUID();
    const meta: DriveFileMeta = { id, name: opts.name, size: 0, parents: [await driveFolderId()], appProperties: { ...opts.appProperties } };
    await writeFile(join(dir, `${id}.json`), JSON.stringify(meta));
    return `${opts.origin}/sis/saraban/api/fake-drive/${id}`;
  }
  const folderId = await driveFolderId();
  const res = await fetch(`${UPLOAD_API}?uploadType=resumable&supportsAllDrives=true`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await getAccessToken()}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": opts.mime,
      "X-Upload-Content-Length": String(opts.size),
      // Drive จะอนุญาต CORS ให้ origin นี้ตอนเบราว์เซอร์ PUT ไฟล์
      Origin: opts.origin,
    },
    body: JSON.stringify({ name: opts.name, mimeType: opts.mime, parents: [folderId], appProperties: opts.appProperties }),
  });
  const location = res.headers.get("location");
  if (!res.ok || !location) throw new Error(`เปิดการอัปโหลดกับ Google Drive ไม่สำเร็จ (${res.status})`);
  return location;
}

/** metadata ของไฟล์ (ใช้ยืนยันว่าเป็นไฟล์ที่เราเปิด session ให้จริง) */
export async function getFileMeta(id: string): Promise<DriveFileMeta> {
  assertFileId(id);
  const dir = fakeDir();
  if (dir) {
    const raw = await readFile(join(dir, `${id}.json`), "utf8").catch(() => null);
    if (!raw) throw new Error("ไม่พบไฟล์ใน Drive");
    return JSON.parse(raw) as DriveFileMeta;
  }
  const res = await fetch(`${API}/${id}?supportsAllDrives=true&fields=id,name,size,parents,appProperties`, {
    headers: { Authorization: `Bearer ${await getAccessToken()}` },
  });
  if (!res.ok) throw new Error(res.status === 404 ? "ไม่พบไฟล์ใน Drive" : `อ่านข้อมูลไฟล์จาก Drive ไม่สำเร็จ (${res.status})`);
  const d = (await res.json()) as { id: string; name: string; size?: string; parents?: string[]; appProperties?: Record<string, string> };
  return { id: d.id, name: d.name, size: Number(d.size ?? 0), parents: d.parents ?? [], appProperties: d.appProperties ?? {} };
}

/** เนื้อไฟล์จาก Drive (Response ที่ body เป็น stream) */
export async function streamFile(id: string): Promise<Response> {
  assertFileId(id);
  const dir = fakeDir();
  if (dir) {
    const buf = await readFile(join(dir, `${id}.pdf`)).catch(() => null);
    return buf ? new Response(new Uint8Array(buf), { status: 200 }) : new Response(null, { status: 404 });
  }
  return fetch(`${API}/${id}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${await getAccessToken()}` } });
}

/** โหมดจำลอง: รับเนื้อไฟล์ที่เบราว์เซอร์ PUT มา (เฉพาะ id ที่เปิด session ไว้แล้ว) */
export async function writeFakeUpload(id: string, data: Uint8Array): Promise<DriveFileMeta | null> {
  const dir = fakeDir();
  if (!dir) return null;
  assertFileId(id);
  const raw = await readFile(join(dir, `${id}.json`), "utf8").catch(() => null);
  if (!raw) return null;
  const meta = JSON.parse(raw) as DriveFileMeta;
  meta.size = data.byteLength;
  await writeFile(join(dir, `${id}.pdf`), data);
  await writeFile(join(dir, `${id}.json`), JSON.stringify(meta));
  return meta;
}
