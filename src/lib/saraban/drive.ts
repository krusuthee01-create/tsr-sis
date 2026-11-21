// Google Drive ของสารบรรณ (ฝั่งเซิร์ฟเวอร์เท่านั้น): token ของ service account, เปิด resumable session,
// อ่าน metadata, ส่งต่อไฟล์ — ใช้ fetch + node:crypto ไม่มี dependency เพิ่ม
// โหมดจำลอง: ตั้ง SARABAN_DRIVE_FAKE_DIR แล้วทุกฟังก์ชันใช้ไฟล์ในโฟลเดอร์นั้นแทน (<id>.pdf + <id>.json)
// ไฟล์นี้ต้อง import ได้จาก node --test ตรง ๆ จึงห้ามใช้ alias @/ หรือโมดูลเฉพาะของ Next
import { createSign, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SCOPE = "https://www.googleapis.com/auth/drive";
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
  // env บน Vercel มักเก็บ private key เป็น \n แบบตัวอักษร
  const key = privateKeyPem.includes("\\n") ? privateKeyPem.replace(/\\n/g, "\n") : privateKeyPem;
  return `${header}.${payload}.${signer.sign(key).toString("base64url")}`;
}

function fakeDir(): string | null {
  return process.env.SARABAN_DRIVE_FAKE_DIR || null;
}

/** id ของโฟลเดอร์ใน Shared Drive ที่เก็บไฟล์สารบรรณ */
export function driveFolderId(): string {
  const id = process.env.SARABAN_DRIVE_FOLDER_ID;
  if (id) return id;
  if (fakeDir()) return "fake-folder";
  throw new Error("ยังไม่ได้ตั้งค่า SARABAN_DRIVE_FOLDER_ID");
}

/** id ไฟล์ของ Drive เป็นตัวอักษร ตัวเลข - _ เท่านั้น — กันการแทรก path/URL */
function assertFileId(id: string) {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) throw new Error("รหัสไฟล์ไม่ถูกต้อง");
}

let cached: { token: string; exp: number } | null = null;

/** access token ของ service account (เก็บไว้ในหน่วยความจำจนเหลืออายุไม่ถึง 60 วินาที) */
export async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - now >= 60) return cached.token;
  const email = process.env.GOOGLE_SA_EMAIL;
  const key = process.env.GOOGLE_SA_PRIVATE_KEY;
  if (!email || !key) throw new Error("ยังไม่ได้ตั้งค่า GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: buildServiceJwt(email, key, now) }),
  });
  if (!res.ok) throw new Error(`ขอ token ของ Google ไม่สำเร็จ (${res.status})`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: data.access_token, exp: now + data.expires_in };
  return data.access_token;
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
    const meta: DriveFileMeta = { id, name: opts.name, size: 0, parents: [driveFolderId()], appProperties: { ...opts.appProperties } };
    await writeFile(join(dir, `${id}.json`), JSON.stringify(meta));
    return `${opts.origin}/sis/saraban/api/fake-drive/${id}`;
  }
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
    body: JSON.stringify({ name: opts.name, mimeType: opts.mime, parents: [driveFolderId()], appProperties: opts.appProperties }),
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
