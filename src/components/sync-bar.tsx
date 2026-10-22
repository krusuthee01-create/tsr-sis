"use client";

import { useCallback, useEffect, useState } from "react";
import { CloudArrowUp, CloudCheck, CloudSlash, WarningCircle } from "@phosphor-icons/react";
import { flushQueue, onQueueChange, pendingItems, discardItem, type QueueItem } from "@/lib/offline-queue";
import { useToast } from "./toast";

/** แสดงรายการที่บันทึกไว้ในเครื่องและยังรอส่ง พร้อมส่งอัตโนมัติเมื่อมีสัญญาณ */
export function SyncBar() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [online, setOnline] = useState(true);
  const [open, setOpen] = useState(false);
  const toast = useToast();

  const refresh = useCallback(() => { pendingItems().then(setItems).catch(() => {}); }, []);

  const flush = useCallback(async (manual = false) => {
    const r = await flushQueue();
    if (r.failed.length) toast(`ส่งไม่สำเร็จ: ${r.failed[0].label} — ${r.failed[0].error}`, "error");
    else if (manual && r.offline) toast("ยังไม่มีสัญญาณ ระบบจะส่งให้อัตโนมัติเมื่อกลับมาออนไลน์", "info");
    else if (r.sent && manual) toast(`ส่งข้อมูลแล้ว ${r.sent} รายการ`);
  }, [toast]);

  useEffect(() => {
    setOnline(navigator.onLine);
    refresh();
    const off = onQueueChange(refresh);
    const up = () => { setOnline(true); flush(); };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    const timer = setInterval(() => { if (navigator.onLine) flush(); }, 30_000);
    flush();
    return () => { off(); window.removeEventListener("online", up); window.removeEventListener("offline", down); clearInterval(timer); };
  }, [refresh, flush]);

  const failed = items.filter((i) => i.error);
  if (online && items.length === 0) {
    return <span className="hidden items-center gap-1.5 px-2 text-sm text-green-700 sm:flex"><CloudCheck size={20} weight="duotone" />ออนไลน์</span>;
  }

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className={`flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold ${failed.length ? "bg-red-100 text-red-800" : online ? "bg-sky-100 text-sky-900" : "bg-amber-100 text-amber-900"}`}>
        {failed.length ? <WarningCircle size={20} weight="duotone" /> : online ? <CloudArrowUp size={20} weight="duotone" /> : <CloudSlash size={20} weight="duotone" />}
        {items.length ? `รอส่ง ${items.length}` : "ออฟไลน์"}
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-40 w-80 rounded-2xl border border-line bg-white p-3 shadow-xl">
          <p className="mb-2 text-sm text-muted">{online ? "กำลังส่งข้อมูลที่บันทึกไว้ในเครื่อง" : "ไม่มีสัญญาณ ข้อมูลเก็บไว้ในเครื่องอย่างปลอดภัย"}</p>
          <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
            {items.map((i) => (
              <li key={i.key} className={`rounded-xl p-2.5 text-sm ${i.error ? "bg-red-50" : "bg-slate-50"}`}>
                <p className="font-semibold">{i.label}</p>
                {i.error && (
                  <>
                    <p className="text-red-800">{i.error}</p>
                    <button type="button" className="mt-1 text-xs font-semibold text-red-700 underline"
                      onClick={() => { if (confirm("ลบรายการนี้ออกจากคิว? ข้อมูลที่ยังไม่ได้ส่งจะหายไป")) discardItem(i.key); }}>
                      ลบรายการนี้
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
          {items.length > 0 && (
            <button type="button" onClick={() => flush(true)} className="mt-3 min-h-11 w-full rounded-xl bg-navy-700 font-semibold text-white">ส่งตอนนี้</button>
          )}
        </div>
      )}
    </div>
  );
}
