import crypto from "node:crypto";
const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const sign = (p) => { const h = b({ alg: "HS256", typ: "JWT" }), d = b(p); return `${h}.${d}.${crypto.createHmac("sha256", process.env.JWT_SECRET).update(`${h}.${d}`).digest("base64url")}`; };
const exp = Math.floor(Date.now() / 1000) + 3600 * 24 * 365;
console.log(`ANON=${sign({ role: "anon", iss: "supabase", exp })}`);
console.log(`SERVICE=${sign({ role: "service_role", iss: "supabase", exp })}`);
