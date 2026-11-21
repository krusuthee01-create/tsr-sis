// สำรองไฟล์ใน Supabase Storage ลงโฟลเดอร์ในเครื่อง: รูปเยี่ยมบ้าน (home-visits) และลายเซ็นสารบรรณ (signatures)
// ใช้: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backup-storage.mjs <โฟลเดอร์ปลายทาง>
// pg_dump สำรองเฉพาะรายชื่อไฟล์ ไม่รวมตัวไฟล์รูป จึงต้องดาวน์โหลดแยกด้วยสคริปต์นี้
// (PDF สารบรรณอยู่ใน Shared Drive ของโรงเรียน ไม่อยู่ใน Supabase จึงไม่ต้องสำรองที่นี่)
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const BUCKETS = ["home-visits", "signatures"];
const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const out = process.argv[2];
if (!url || !key || !out) {
  console.error("ต้องมี SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY และโฟลเดอร์ปลายทาง");
  process.exit(1);
}
const headers = { apikey: key, Authorization: `Bearer ${key}` };

/** รายชื่อไฟล์ทั้งหมดใน bucket (โฟลเดอร์ = รายการที่ไม่มี id) */
async function list(bucket, prefix = "") {
  const files = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${url}/storage/v1/object/list/${bucket}`, {
      method: "POST", headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: "name", order: "asc" } }),
    });
    if (!res.ok) throw new Error(`อ่านรายชื่อไฟล์ไม่ได้ (${res.status}): ${await res.text()}`);
    const items = await res.json();
    for (const it of items) {
      const path = prefix ? `${prefix}/${it.name}` : it.name;
      if (it.id) files.push(path);
      else files.push(...(await list(bucket, path)));
    }
    if (items.length < 1000) return files;
  }
}

for (const bucket of BUCKETS) {
  const files = await list(bucket);
  let bytes = 0;
  for (const path of files) {
    const res = await fetch(`${url}/storage/v1/object/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`, { headers });
    if (!res.ok) throw new Error(`ดาวน์โหลด ${bucket}/${path} ไม่ได้ (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    const dest = join(out, bucket, path);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, buf);
    bytes += buf.length;
  }
  console.log(`สำรอง ${bucket} ${files.length} ไฟล์ (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
}
