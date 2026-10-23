"use client";

// คิวบันทึกในเครื่อง: บันทึกลง IndexedDB ก่อนเสมอ แล้วค่อยส่งขึ้นเซิร์ฟเวอร์
// ทำให้ครูเห็น "บันทึกแล้ว" ทันที และใช้งานได้แม้ไม่มีสัญญาณ

import { createStore, del, entries, get, set } from "idb-keyval";
import { supabaseBrowser } from "./supabase/client";

export type QueueItem = {
  key: string;
  rpc: "save_daily" | "save_subject_attendance" | "save_measurements";
  args: Record<string, unknown>;
  label: string;
  createdAt: number;
  error?: string;
  attempts: number;
};

const store = typeof indexedDB !== "undefined" ? createStore("tsr-sis", "queue") : undefined;
const cacheStore = typeof indexedDB !== "undefined" ? createStore("tsr-sis-cache", "data") : undefined;
const EVENT = "tsr-queue-changed";

function notify() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

export function onQueueChange(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

/** เพิ่มรายการลงคิว (key เดียวกันจะแทนที่ของเดิม เพราะเป็นการบันทึกทั้งห้องของวันนั้น) */
export async function enqueue(item: Omit<QueueItem, "createdAt" | "attempts">): Promise<void> {
  if (!store) throw new Error("เบราว์เซอร์นี้ไม่รองรับการบันทึกในเครื่อง");
  await set(item.key, { ...item, createdAt: Date.now(), attempts: 0 } satisfies QueueItem, store);
  notify();
}

export async function pendingItems(): Promise<QueueItem[]> {
  if (!store) return [];
  const all = await entries<string, QueueItem>(store);
  return all.map(([, v]) => v).sort((a, b) => a.createdAt - b.createdAt);
}

function isNetworkError(message: string): boolean {
  return /fetch|network|Failed to|Load failed|timeout|ECONN/i.test(message);
}

let flushing: Promise<FlushResult> | null = null;
export type FlushResult = { sent: number; failed: { label: string; error: string }[]; offline: boolean };

/** ส่งทุกรายการในคิว — รายการที่ถูกเซิร์ฟเวอร์ปฏิเสธจะเก็บข้อความผิดพลาดไว้ให้ครูเห็น */
export function flushQueue(): Promise<FlushResult> {
  flushing ??= (async () => {
    const result: FlushResult = { sent: 0, failed: [], offline: false };
    try {
      if (!store) return result;
      const sb = supabaseBrowser();
      for (const item of await pendingItems()) {
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          result.offline = true;
          break;
        }
        let errorMessage: string | null = null;
        try {
          const { error } = await sb.rpc(item.rpc, item.args);
          errorMessage = error ? error.message : null;
        } catch (e) {
          errorMessage = e instanceof Error ? e.message : String(e);
        }
        if (!errorMessage) {
          // ถ้าระหว่างส่งมีการบันทึกใหม่ด้วย key เดิม อย่าลบของใหม่ทิ้ง
          const current = await get<QueueItem>(item.key, store);
          if (current && current.createdAt === item.createdAt) await del(item.key, store);
          result.sent += 1;
        } else if (isNetworkError(errorMessage)) {
          result.offline = true;
          break;
        } else {
          await set(item.key, { ...item, error: errorMessage, attempts: item.attempts + 1 }, store);
          result.failed.push({ label: item.label, error: errorMessage });
        }
      }
      return result;
    } finally {
      flushing = null;
      notify();
    }
  })();
  return flushing;
}

export async function discardItem(key: string): Promise<void> {
  if (!store) return;
  await del(key, store);
  notify();
}

/** เก็บข้อมูลไว้ใช้ตอนไม่มีสัญญาณ เช่น รายชื่อนักเรียนของห้อง */
export async function cachePut<T>(key: string, value: T): Promise<void> {
  if (!cacheStore) return;
  try {
    await set(key, { value, at: Date.now() }, cacheStore);
  } catch {
    // พื้นที่เต็มหรือโหมดส่วนตัว — ไม่เป็นไร
  }
}

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  if (!cacheStore) return undefined;
  try {
    const v = await get<{ value: T }>(key, cacheStore);
    return v?.value;
  } catch {
    return undefined;
  }
}
