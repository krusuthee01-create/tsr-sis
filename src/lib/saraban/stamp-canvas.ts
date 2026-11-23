// วาดตรารับ/คำเกษียนด้วย canvas (เฉพาะเบราว์เซอร์) คืนค่าเป็น PNG พื้นหลังโปร่งใส
import QRCode from "qrcode";
import { ENDORSEMENT_FOOTER_LINES, STAMP_SCALE } from "./stamp.ts";

const INK = "#1d4ed8";
const FALLBACK_FONT = '"Sarabun", "TH Sarabun New", sans-serif';

function fontFamily(): string {
  const v = getComputedStyle(document.body).getPropertyValue("--font-sarabun").trim();
  return v ? `${v}, ${FALLBACK_FONT}` : FALLBACK_FONT;
}

async function loadFont(family: string, size: number, text: string) {
  // โหลดฟอนต์ให้ครอบคลุมอักขระที่จะวาดจริง (ไทย/ละติน/ตัวเลข) ทั้งน้ำหนัก 400 และ 700
  await Promise.all([`400 ${size}px ${family}`, `700 ${size}px ${family}`].map((f) => document.fonts.load(f, text).catch(() => [])));
  await document.fonts.ready;
}

function toPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (b) => {
      try {
        if (!b) throw new Error("สร้างภาพ PNG ไม่สำเร็จ");
        resolve(new Uint8Array(await b.arrayBuffer()));
      } catch (err) {
        reject(err);
      }
    }, "image/png");
  });
}

/**
 * วาด QR ทีละโมดูลลง canvas (หน่วย point หลัง ctx.scale) ขอบโมดูลปัดลงพิกเซลจริง ภาพจึงคมแม้ QR เล็ก
 * ระดับแก้ผิด M: ลิงก์หนังสือ (~80 ตัวอักษร) ได้ QR 37×37 โมดูล ≈ 1.2 pt (0.4 มม.) ต่อโมดูลที่ขนาด 44 pt
 */
function drawQr(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number) {
  const q = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = q.modules.size;
  const px = (v: number) => Math.round(v * STAMP_SCALE) / STAMP_SCALE; // ขอบตรงพิกเซล
  const m = size / n;
  ctx.fillStyle = INK;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!q.modules.get(r, c)) continue;
      const x0 = px(x + c * m), y0 = px(y + r * m);
      ctx.fillRect(x0, y0, px(x + (c + 1) * m) - x0, px(y + (r + 1) * m) - y0);
    }
  }
}

/**
 * ตรารับขนาดเท่าตรายางของโรงเรียน (เทียบจากหนังสือจริง: กรอบสูง ~74 pt ข้อความ Sarabun ~9.5 pt บรรทัดห่าง ~16.5 pt)
 * ชื่อโรงเรียน + รับที่/วันที่/เวลา มีเส้นประใต้ค่าแบบตรายาง · QR 52 pt ทางซ้าย (≈0.5 มม. ต่อโมดูล สแกนง่าย)
 */
export async function drawReceiveStamp(lines: string[], qrUrl: string): Promise<Uint8Array> {
  const family = fontFamily();
  const fs = 9.5, lh = 16.5, pad = 4, gap = 6, qr = 52;
  await loadFont(family, fs, lines.join(" "));
  const font = `400 ${fs}px ${family}`;
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = font;
  const textW = Math.max(...lines.map((l) => measure.measureText(l).width)) + 6;
  const w = Math.ceil(pad * 2 + qr + gap + textW);
  const h = Math.ceil(Math.max(pad * 2 + lines.length * lh, pad * 2 + qr));

  const canvas = document.createElement("canvas");
  canvas.width = w * STAMP_SCALE;
  canvas.height = h * STAMP_SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(STAMP_SCALE, STAMP_SCALE);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.25;
  ctx.strokeRect(0.625, 0.625, w - 1.25, h - 1.25);

  drawQr(ctx, qrUrl, pad, (h - qr) / 2, qr);

  ctx.fillStyle = INK;
  ctx.textBaseline = "middle";
  ctx.font = font;
  const x0 = pad + qr + gap, right = w - pad;
  const top = (h - lines.length * lh) / 2;
  lines.forEach((l, i) => {
    const cy = top + i * lh + lh / 2;
    ctx.fillText(l, x0, cy);
    // เส้นประใต้ค่า (หลังคำนำ "รับที่ / วันที่ / เวลา") แบบตรายาง
    const sp = l.indexOf(" ");
    if (i === 0 || sp < 0) return;
    const from = x0 + ctx.measureText(l.slice(0, sp + 1)).width - 1;
    ctx.save();
    ctx.lineWidth = 0.6;
    ctx.setLineDash([0.8, 1.2]);
    ctx.beginPath();
    ctx.moveTo(from, cy + fs * 0.62);
    ctx.lineTo(right, cy + fs * 0.62);
    ctx.stroke();
    ctx.restore();
  });
  return toPng(canvas);
}

/**
 * คำเกษียน: ข้อความหลายบรรทัด ลายเซ็น ชื่อ วันที่ ชิดซ้ายทั้งหมด (แบบเกษียนด้วยมือของโรงเรียน)
 * เทียบจากหนังสือจริง: Sarabun 10.5 pt บรรทัดห่าง 15 pt ลายเซ็นสูง ~24 pt · บรรทัดละไม่เกิน ~34 ตัว ยาวกว่านั้นขึ้นบรรทัดใหม่
 */
export async function drawEndorsement(lines: string[], signature?: ImageBitmap): Promise<Uint8Array> {
  const family = fontFamily();
  const fs = 10.5, lh = 15, pad = 3, sigH = 26;
  await loadFont(family, fs, lines.join(" "));
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = `400 ${fs}px ${family}`;
  const textW = Math.max(...lines.map((l) => measure.measureText(l).width));
  const w = Math.ceil(pad * 2 + textW);
  const h = pad * 2 + lines.length * lh + (signature ? sigH : 0);

  const canvas = document.createElement("canvas");
  canvas.width = w * STAMP_SCALE;
  canvas.height = h * STAMP_SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(STAMP_SCALE, STAMP_SCALE);
  ctx.fillStyle = INK;
  ctx.textBaseline = "middle";
  ctx.font = `${fs}px ${family}`;

  // บรรทัดท้ายคือชื่อ/วันที่ จัดกึ่งกลางใต้ลายเซ็น
  const bodyCount = Math.max(0, lines.length - ENDORSEMENT_FOOTER_LINES);
  let y = pad;
  lines.forEach((l, i) => {
    if (i === bodyCount && signature) {
      // ย่อด้วยตัวคูณเดียวกันทั้งกว้างและสูง ไม่ให้ภาพเพี้ยนสัดส่วน
      const k = Math.min((w - pad * 2) / signature.width, (sigH - 2) / signature.height);
      const sw = signature.width * k;
      const sh = signature.height * k;
      ctx.drawImage(signature, pad, y, sw, sh);
      y += sigH;
    }
    ctx.textAlign = "left";
    ctx.fillText(l, pad, y + lh / 2);
    y += lh;
  });
  return toPng(canvas);
}
