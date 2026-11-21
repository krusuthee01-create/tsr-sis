"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CaretLeft, CaretRight, FilePlus } from "@phosphor-icons/react";
import { A4, placeAtTap, type PlaceBox } from "@/lib/saraban/book";
import type { PreparedEndorsement } from "../../pdf-client";

export type Placement = { appendPage: boolean; box: PlaceBox };

type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage>; destroy: () => Promise<void> };
type PdfPage = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void>; cancel: () => void };
};

/** โหลด pdf.js เฉพาะตอนเปิดหน้าลงนาม (ไม่อยู่ใน bundle หลัก) */
async function openPdf(bytes: Uint8Array): Promise<PdfDoc> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  // pdf.js ย้าย buffer ไปที่ worker — ส่งสำเนา ไม่ให้ไฟล์ต้นทางที่ใช้ฝังคำเกษียนว่างเปล่า
  return (await pdfjs.getDocument({ data: bytes.slice() }).promise) as unknown as PdfDoc;
}

/**
 * แตะ/คลิกตรงพื้นที่ว่างบนหน้าเอกสารเพื่อวางคำเกษียน (แบบระบบเดิมของโรงเรียน)
 * แสดงตัวอย่างคำเกษียนจริงบนหน้า · เลื่อนหน้าได้ · เลือก "หน้าใหม่ท้ายไฟล์" ได้เมื่อไม่มีที่ว่าง
 */
export function PlacementPicker({ prepared, value, onChange }: { prepared: PreparedEndorsement; value: Placement; onChange: (p: Placement) => void }) {
  const total = prepared.pages.length;
  const [view, setView] = useState(value.appendPage ? total : value.box.page); // total = หน้าใหม่ท้ายไฟล์
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [failed, setFailed] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const imgUrl = useMemo(() => URL.createObjectURL(new Blob([prepared.png as BlobPart], { type: "image/png" })), [prepared.png]);
  useEffect(() => () => URL.revokeObjectURL(imgUrl), [imgUrl]);

  useEffect(() => {
    let alive = true;
    let opened: PdfDoc | null = null;
    openPdf(prepared.bytes)
      .then((d) => { opened = d; if (alive) setDoc(d); else d.destroy(); })
      .catch((e) => { console.error("saraban pdfjs", e); if (alive) setFailed(true); });
    return () => { alive = false; opened?.destroy().catch(() => {}); };
  }, [prepared.bytes]);

  // วาดหน้าที่เลือกให้พอดีความกว้างกรอบ (คมตาม devicePixelRatio)
  useEffect(() => {
    if (!doc || view >= total || !canvas.current || !wrap.current) return;
    let task: { promise: Promise<void>; cancel: () => void } | null = null;
    let alive = true;
    (async () => {
      const page = await doc.getPage(view + 1);
      if (!alive || !canvas.current || !wrap.current) return;
      const cssW = wrap.current.clientWidth;
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: (cssW / base.width) * Math.min(window.devicePixelRatio || 1, 2) });
      const c = canvas.current;
      c.width = Math.floor(vp.width);
      c.height = Math.floor(vp.height);
      task = page.render({ canvasContext: c.getContext("2d")!, viewport: vp });
      await task.promise.catch(() => {});
    })();
    return () => { alive = false; task?.cancel(); };
  }, [doc, view, total]);

  const size = view >= total ? A4 : prepared.pages[view];
  const shown = value.appendPage ? view === total : value.box.page === view && view < total;

  function tap(e: React.MouseEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const box = placeAtTap({ fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height }, size, prepared.png_pt, view);
    onChange({ appendPage: view === total, box });
  }

  const b = value.box;
  return (
    <div className="flex flex-col gap-2">
      <p className="rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-900">
        แตะตรง<strong>พื้นที่ว่าง</strong>ในเอกสารเพื่อวางคำเกษียน (จุดที่แตะคือมุมซ้ายบน) · ตำแหน่งที่วางไว้ใช้ได้ กดยืนยันได้เลย
      </p>
      <div className="flex items-center justify-between gap-2">
        <button type="button" aria-label="หน้าก่อน" disabled={view === 0} onClick={() => setView((v) => v - 1)}
          className="flex size-11 items-center justify-center rounded-xl border-[1.5px] border-slate-300 disabled:opacity-40"><CaretLeft size={20} /></button>
        <span className="text-sm font-semibold" aria-live="polite">
          {view >= total ? "หน้าใหม่ท้ายไฟล์" : `หน้า ${view + 1} / ${total}`}
        </span>
        <button type="button" aria-label="หน้าถัดไป" disabled={view >= total} onClick={() => setView((v) => v + 1)}
          className="flex size-11 items-center justify-center rounded-xl border-[1.5px] border-slate-300 disabled:opacity-40">
          {view === total - 1 ? <FilePlus size={20} /> : <CaretRight size={20} />}
        </button>
      </div>
      <div ref={wrap} className="relative w-full cursor-crosshair overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm"
        style={{ aspectRatio: `${size.width} / ${size.height}` }} onClick={tap}
        role="application" aria-label={`ภาพหน้าเอกสาร แตะเพื่อวางคำเกษียน`}>
        {view < total && <canvas ref={canvas} className="absolute inset-0 size-full" aria-hidden />}
        {view < total && !doc && !failed && <p className="absolute inset-0 flex items-center justify-center text-sm text-muted">กำลังแสดงหน้าเอกสาร…</p>}
        {view < total && failed && <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-muted">แสดงภาพหน้าเอกสารไม่ได้ ยังแตะเพื่อกำหนดตำแหน่งได้</p>}
        {view >= total && <p className="absolute inset-x-0 top-1/2 text-center text-sm text-muted">หน้า A4 ว่าง (เพิ่มท้ายไฟล์)</p>}
        {shown && (
          // eslint-disable-next-line @next/next/no-img-element -- ภาพตัวอย่างจาก blob ในเครื่อง
          <img src={imgUrl} alt="ตัวอย่างคำเกษียน" className="pointer-events-none absolute outline outline-2 outline-offset-2 outline-sky-500/70"
            style={{
              left: `${(b.x / size.width) * 100}%`,
              top: `${((size.height - b.y - b.height) / size.height) * 100}%`,
              width: `${(b.width / size.width) * 100}%`,
            }} />
        )}
      </div>
      {!shown && <p className="text-center text-sm text-muted">คำเกษียนอยู่{value.appendPage ? "ในหน้าใหม่ท้ายไฟล์" : `ที่หน้า ${b.page + 1}`} — แตะหน้านี้เพื่อย้ายมาวางที่นี่</p>}
    </div>
  );
}
