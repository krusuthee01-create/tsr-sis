// วาดตรารับ/คำเกษียนด้วย canvas (เฉพาะเบราว์เซอร์) คืนค่าเป็น PNG พื้นหลังโปร่งใส
import QRCode from "qrcode";
import { STAMP_SCALE } from "./stamp.ts";

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

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("โหลดภาพไม่สำเร็จ"));
    img.src = src;
  });
}

/** ตรารับ: กรอบสี่เหลี่ยม ข้อความสีน้ำเงิน และ QR ทางซ้าย */
export async function drawReceiveStamp(lines: string[], qrUrl: string): Promise<Uint8Array> {
  const family = fontFamily();
  const fs = 14, lh = 20, pad = 10, qr = 76;
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
  ctx.lineWidth = 1.5;
  ctx.strokeRect(1, 1, w - 2, h - 2);

  const qrImg = await loadImage(await QRCode.toDataURL(qrUrl, { margin: 0, scale: STAMP_SCALE * 4, color: { dark: INK, light: "#0000" } }));
  ctx.drawImage(qrImg, pad, (h - qr) / 2, qr, qr);

  ctx.fillStyle = INK;
  ctx.textBaseline = "middle";
  const top = (h - lines.length * lh) / 2;
  lines.forEach((l, i) => {
    ctx.font = `${i === 0 ? "700" : "400"} ${fs}px ${family}`;
    ctx.fillText(l, pad * 2 + qr, top + i * lh + lh / 2);
  });
  return toPng(canvas);
}

/** คำเกษียน: ข้อความหลายบรรทัด (ชื่อ/ตำแหน่ง/วันที่อยู่ท้าย) และลายเซ็นคั่นเหนือชื่อ */
export async function drawEndorsement(lines: string[], signature?: ImageBitmap): Promise<Uint8Array> {
  const family = fontFamily();
  const fs = 14, lh = 20, pad = 8, sigH = 44;
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

  // 3 บรรทัดท้ายคือชื่อ/ตำแหน่ง/วันที่ จัดกึ่งกลางใต้ลายเซ็น
  const bodyCount = Math.max(0, lines.length - 3);
  let y = pad;
  lines.forEach((l, i) => {
    if (i === bodyCount && signature) {
      // ย่อด้วยตัวคูณเดียวกันทั้งกว้างและสูง ไม่ให้ภาพเพี้ยนสัดส่วน
      const k = Math.min((w - pad * 2) / signature.width, (sigH - 4) / signature.height);
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
