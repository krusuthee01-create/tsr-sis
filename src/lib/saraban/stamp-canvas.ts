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

/** ตรารับขนาดเท่าตรายางทั่วไป (~150×54 pt): กรอบ ข้อความสีน้ำเงิน 4 บรรทัด และ QR 44 pt ทางซ้าย */
export async function drawReceiveStamp(lines: string[], qrUrl: string): Promise<Uint8Array> {
  const family = fontFamily();
  const fs = 9, lh = 11.5, pad = 4, qr = 44;
  await loadFont(family, fs, lines.join(" "));
  const measure = document.createElement("canvas").getContext("2d")!;
  // วัดด้วยฟอนต์เดียวกับที่วาด (บรรทัดแรกตัวหนา)
  const textW = Math.max(...lines.map((l, i) => {
    measure.font = `${i === 0 ? "700" : "400"} ${fs}px ${family}`;
    return measure.measureText(l).width;
  }));
  const w = Math.ceil(pad * 3 + qr + textW);
  const h = Math.max(pad * 2 + lines.length * lh, pad * 2 + qr);

  const canvas = document.createElement("canvas");
  canvas.width = w * STAMP_SCALE;
  canvas.height = h * STAMP_SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(STAMP_SCALE, STAMP_SCALE);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

  drawQr(ctx, qrUrl, pad, (h - qr) / 2, qr);

  ctx.fillStyle = INK;
  ctx.textBaseline = "middle";
  const top = (h - lines.length * lh) / 2;
  lines.forEach((l, i) => {
    ctx.font = `${i === 0 ? "700" : "400"} ${fs}px ${family}`;
    ctx.fillText(l, pad * 2 + qr, top + i * lh + lh / 2);
  });
  return toPng(canvas);
}

/**
 * คำเกษียน: ข้อความหลายบรรทัด (ชื่อ/วันที่อยู่ท้าย) และลายเซ็นคั่นเหนือชื่อ
 * ตัวอักษร 14 pt บรรทัดละไม่เกิน ~34 ตัว (กว้าง ~7 ซม.) ยาวกว่านั้นขึ้นบรรทัดใหม่ ลายเซ็นสูง 32 pt
 */
export async function drawEndorsement(lines: string[], signature?: ImageBitmap): Promise<Uint8Array> {
  const family = fontFamily();
  const fs = 14, lh = 17, pad = 3, sigH = 32;
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
      ctx.drawImage(signature, (w - sw) / 2, y, sw, sh);
      y += sigH;
    }
    if (i < bodyCount) {
      ctx.textAlign = "left";
      ctx.fillText(l, pad, y + lh / 2);
    } else {
      ctx.textAlign = "center";
      ctx.fillText(l, w / 2, y + lh / 2);
    }
    y += lh;
  });
  return toPng(canvas);
}
