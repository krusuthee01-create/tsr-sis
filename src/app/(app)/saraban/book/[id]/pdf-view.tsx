"use client";

import { useEffect, useRef, useState } from "react";
import { withBase } from "@/lib/base-path";
import { openPdf, type PdfDoc } from "./placement-picker";

/**
 * แสดงไฟล์หนังสือ: คอมพิวเตอร์ใช้ตัวแสดง PDF ของเบราว์เซอร์ (iframe)
 * มือถือ/แท็บเล็ต (Chrome Android ไม่แสดง PDF ใน iframe, iPhone แสดงแค่หน้าแรก) วาดทุกหน้าด้วย pdf.js
 */
export function PdfView({ fileId, title }: { fileId: string; title: string }) {
  const url = withBase(`/saraban/api/file/${fileId}`);
  const [inline, setInline] = useState<boolean | null>(null);
  useEffect(() => {
    const nav = navigator as Navigator & { pdfViewerEnabled?: boolean };
    setInline(nav.pdfViewerEnabled !== false && !matchMedia("(pointer: coarse)").matches);
  }, []);
  if (inline === null) return <div className="h-[60dvh] w-full rounded-xl border border-line bg-slate-50" />;
  if (inline) return <iframe src={url} title={title} className="h-[60dvh] w-full rounded-xl border border-line bg-slate-50 xl:h-[82vh]" />;
  return <PdfPages url={url} title={title} />;
}

function PdfPages({ url, title }: { url: string; title: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    let opened: PdfDoc | null = null;
    setDoc(null);
    setFailed(false);
    (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const d = await openPdf(new Uint8Array(await res.arrayBuffer()));
      opened = d;
      if (alive) setDoc(d); else d.destroy();
    })().catch((e) => { console.error("saraban pdf view", e); if (alive) setFailed(true); });
    return () => { alive = false; opened?.destroy().catch(() => {}); };
  }, [url]);

  // วาดทุกหน้าให้พอดีความกว้าง (คมตาม devicePixelRatio สูงสุด 2)
  useEffect(() => {
    const box = wrap.current;
    if (!doc || !box) return;
    let alive = true;
    const tasks: { cancel: () => void }[] = [];
    box.replaceChildren();
    (async () => {
      const cssW = box.clientWidth;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      for (let i = 1; i <= doc.numPages && alive; i++) {
        const page = await doc.getPage(i);
        if (!alive) return;
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: (cssW / base.width) * dpr });
        const c = document.createElement("canvas");
        c.width = Math.floor(vp.width);
        c.height = Math.floor(vp.height);
        c.className = "w-full rounded-md border border-slate-300 bg-white shadow-sm";
        c.setAttribute("role", "img");
        c.setAttribute("aria-label", `${title} หน้า ${i}`);
        box.appendChild(c);
        const task = page.render({ canvasContext: c.getContext("2d")!, viewport: vp });
        tasks.push(task);
        await task.promise.catch(() => {});
      }
    })().catch(() => {}); // ออกจากหน้าระหว่างวาด: pdf.js ถูกปิดแล้ว (Transport destroyed) ไม่ต้องแจ้ง
    return () => { alive = false; tasks.forEach((t) => t.cancel()); };
  }, [doc, title]);

  if (failed) return <p className="rounded-xl bg-slate-50 px-3 py-6 text-center text-muted">แสดงหน้าเอกสารไม่ได้ กด &quot;เปิด PDF&quot; เพื่อดูไฟล์</p>;
  return (
    <div className="flex flex-col gap-3">
      {!doc && <p className="rounded-xl bg-slate-50 px-3 py-10 text-center text-muted">กำลังแสดงหน้าเอกสาร…</p>}
      <div ref={wrap} className="flex flex-col gap-3" />
    </div>
  );
}
