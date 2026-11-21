// ทดสอบ src/lib/saraban/*: npm test (ข้อมูลสมมติทั้งหมด)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServiceJwt, createUploadSession, getFileMeta } from "../src/lib/saraban/drive.ts";

const b64urlJson = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

test("JWT ของ service account (RS256)", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const jwt = buildServiceJwt("sa@example.iam.gserviceaccount.com", pem, 1_700_000_000);
  const parts = jwt.split(".");
  assert.equal(parts.length, 3);
  assert.deepEqual(b64urlJson(parts[0]), { alg: "RS256", typ: "JWT" });
  const payload = b64urlJson(parts[1]);
  assert.equal(payload.exp - payload.iat, 3600);
  assert.equal(payload.iat, 1_700_000_000);
  assert.equal(payload.iss, "sa@example.iam.gserviceaccount.com");
  assert.equal(payload.scope, "https://www.googleapis.com/auth/drive");
  assert.equal(payload.aud, "https://oauth2.googleapis.com/token");
  const v = createVerify("RSA-SHA256");
  v.update(`${parts[0]}.${parts[1]}`);
  assert.ok(v.verify(publicKey, Buffer.from(parts[2], "base64url")));
});

test("JWT: private key จาก env ที่มี \\n แบบตัวอักษร", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString().replace(/\n/g, "\\n");
  assert.equal(buildServiceJwt("a@b.c", pem, 1).split(".").length, 3);
});

test("Drive โหมดจำลอง: เปิด session แล้วอ่าน metadata", async () => {
  const dir = mkdtempSync(join(tmpdir(), "saraban-fake-"));
  process.env.SARABAN_DRIVE_FAKE_DIR = dir;
  process.env.SARABAN_DRIVE_FOLDER_ID = "folder-test";
  try {
    const appProperties = { bookId: "11111111-1111-1111-1111-111111111111", kind: "original", uploader: "22222222-2222-2222-2222-222222222222" };
    const url = await createUploadSession({ name: "หนังสือทดสอบ.pdf", size: 1234, mime: "application/pdf", origin: "http://x", appProperties });
    assert.ok(url.startsWith("http://x/sis/saraban/api/fake-drive/"), url);
    const id = url.split("/").pop()!;
    const meta = await getFileMeta(id);
    assert.equal(meta.id, id);
    assert.equal(meta.name, "หนังสือทดสอบ.pdf");
    assert.deepEqual(meta.appProperties, appProperties);
    assert.deepEqual(meta.parents, ["folder-test"]);
    // id แปลก (เช่น ../) ต้องถูกปฏิเสธ ไม่อ่านไฟล์นอกโฟลเดอร์
    await assert.rejects(getFileMeta("../etc/passwd"));
  } finally {
    delete process.env.SARABAN_DRIVE_FAKE_DIR;
    delete process.env.SARABAN_DRIVE_FOLDER_ID;
    rmSync(dir, { recursive: true, force: true });
  }
});
