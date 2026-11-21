"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, BellRinging, Plus, Signature, Trash, UploadSimple } from "@phosphor-icons/react";
import { Button, Card, SectionTitle } from "@/components/ui";
import { useToast } from "@/components/toast";
import { BASE_PATH, withBase } from "@/lib/base-path";
import { supabaseBrowser } from "@/lib/supabase/client";
import { DEFAULT_PRESETS, PRESET_ROLES, type Preset, type PresetRole } from "@/lib/saraban/book";
import { deletePreset, savePreset, savePushSubscription } from "../actions";

const SIG_MAX = 200 * 1024;

/** คีย์ VAPID (base64url) → Uint8Array สำหรับ pushManager.subscribe */
function vapidBytes(key: string): Uint8Array<ArrayBuffer> {
  const b64 = (key + "=".repeat((4 - (key.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type PushState = "checking" | "unsupported" | "off" | "on" | "denied" | "busy";

/** เปิดการแจ้งเตือน Web Push บนอุปกรณ์นี้ */
export function PushToggle({ vapidKey }: { vapidKey: string }) {
  const toast = useToast();
  const [state, setState] = useState<PushState>("checking");

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported" as const;
      if (Notification.permission === "denied") return "denied" as const;
      const reg = await navigator.serviceWorker.getRegistration(withBase("/"));
      const sub = await reg?.pushManager.getSubscription();
      if (!sub) return "off" as const;
      // เครื่องที่ใช้ร่วมกัน: ผูก subscription เดิมกับบัญชีที่เข้าสู่ระบบอยู่
      await savePushSubscription(sub.toJSON()).catch(() => {});
      return "on" as const;
    })()
      .then((s) => alive && setState(s))
      .catch(() => alive && setState("off"));
    return () => { alive = false; };
  }, []);

  async function enable() {
    if (!vapidKey || state === "busy") return;
    setState("busy");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? "denied" : "off");
        return;
      }
      // service worker เดิมของระบบ (/sis/sw.js scope /sis)
      await navigator.serviceWorker.register(withBase("/sw.js"), { scope: BASE_PATH });
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription())
        ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidBytes(vapidKey) }));
      const r = await savePushSubscription(sub.toJSON());
      if (!r.ok) {
        toast(r.error, "error");
        setState("off");
        return;
      }
      toast("เปิดการแจ้งเตือนแล้ว");
      setState("on");
    } catch (err) {
      console.error("push subscribe", err);
      toast("เปิดการแจ้งเตือนไม่สำเร็จ กรุณาลองใหม่", "error");
      setState("off");
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <SectionTitle>การแจ้งเตือนบนอุปกรณ์นี้</SectionTitle>
      <p className="text-[0.9375rem] text-muted">แจ้งเตือนเมื่อมีหนังสือถึงท่าน และเตือนก่อนครบกำหนด (iPhone/iPad ต้องเพิ่มแอปลงหน้าจอโฮมก่อน — iOS 16.4 ขึ้นไป)</p>
      {state === "on" ? (
        <p className="flex min-h-11 items-center gap-2 font-semibold text-green-700"><BellRinging size={22} weight="fill" /> เปิดการแจ้งเตือนแล้ว</p>
      ) : (
        <Button size="lg" className="w-full sm:w-auto sm:self-start" onClick={enable}
          disabled={!vapidKey || state === "busy" || state === "checking" || state === "unsupported" || state === "denied"}>
          <Bell size={22} weight="bold" /> {state === "busy" ? "กำลังเปิด…" : "เปิดการแจ้งเตือน"}
        </Button>
      )}
      {!vapidKey && <p className="text-sm text-amber-800">ระบบยังไม่ได้ตั้งค่าการแจ้งเตือน (VAPID) โปรดติดต่อผู้ดูแลระบบ</p>}
      {state === "unsupported" && <p className="text-sm text-amber-800">เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน</p>}
      {state === "denied" && <p className="text-sm text-amber-800">ท่านปิดการแจ้งเตือนของเว็บนี้ไว้ เปิดได้ที่การตั้งค่าของเบราว์เซอร์</p>}
    </Card>
  );
}

/** ลายเซ็นของฉัน (PNG) — เก็บที่ signatures/<staffId>/signature.png อ่าน/เขียนได้เฉพาะเจ้าของ */
export function SignatureForm({ staffId }: { staffId: string }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState<string | null | undefined>(undefined); // undefined = กำลังโหลด
  const [busy, setBusy] = useState(false);
  const path = `${staffId}/signature.png`;

  async function load() {
    const { data } = await supabaseBrowser().storage.from("signatures").download(path).catch(() => ({ data: null }));
    setUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return data ? URL.createObjectURL(data) : null;
    });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffId]);

  async function upload(file: File | undefined) {
    if (!file || busy) return;
    if (input.current) input.current.value = "";
    if (file.type !== "image/png") return toast("รองรับเฉพาะไฟล์ PNG", "error");
    if (file.size > SIG_MAX) return toast("ไฟล์ใหญ่เกิน 200 KB", "error");
    setBusy(true);
    try {
      const { error } = await supabaseBrowser().storage.from("signatures").upload(path, file, { upsert: true, contentType: "image/png", cacheControl: "0" });
      if (error) {
        console.error("signature upload", error);
        return toast("อัปโหลดลายเซ็นไม่สำเร็จ กรุณาลองใหม่", "error");
      }
      toast("บันทึกลายเซ็นแล้ว");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy || !confirm("ลบลายเซ็นของท่าน?")) return;
    setBusy(true);
    try {
      const { error } = await supabaseBrowser().storage.from("signatures").remove([path]);
      if (error) {
        console.error("signature remove", error);
        return toast("ลบลายเซ็นไม่สำเร็จ", "error");
      }
      toast("ลบลายเซ็นแล้ว");
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <SectionTitle>ลายเซ็นของฉัน</SectionTitle>
      <p className="text-[0.9375rem] text-muted">ใช้ประกอบคำเกษียนเมื่อท่านลงนาม — ไฟล์ PNG พื้นหลังโปร่งใส ไม่เกิน 200 KB (เห็นได้เฉพาะท่าน)</p>
      <div className="flex min-h-28 items-center justify-center rounded-2xl border-2 border-dashed border-sky-200 bg-white p-3">
        {url === undefined ? <span className="text-muted">กำลังโหลด…</span>
          // eslint-disable-next-line @next/next/no-img-element
          : url ? <img src={url} alt="ลายเซ็นของฉัน" className="max-h-24 max-w-full object-contain" />
          : <span className="flex items-center gap-2 text-muted"><Signature size={24} /> ยังไม่มีลายเซ็น</span>}
      </div>
      <input ref={input} id="signature-file" type="file" accept="image/png" className="sr-only" disabled={busy} onChange={(e) => upload(e.target.files?.[0])} />
      <div className="flex flex-wrap gap-2">
        <label htmlFor="signature-file" aria-disabled={busy}
          className={`inline-flex min-h-[2.875rem] cursor-pointer items-center gap-2 rounded-xl bg-navy-700 px-4 font-semibold text-white hover:bg-navy-800 ${busy ? "pointer-events-none opacity-60" : ""}`}>
          <UploadSimple size={20} /> {url ? "เปลี่ยนลายเซ็น" : "อัปโหลดลายเซ็น"}
        </label>
        {url && <Button variant="secondary" disabled={busy} onClick={remove}><Trash size={20} /> ลบ</Button>}
      </div>
    </Card>
  );
}

const ROLE_TITLE: Record<PresetRole, string> = {
  director: "ผู้อำนวยการ (เกษียนสั่งการ)",
  clerk: "ธุรการ (เสนอ ผอ.)",
  head: "หัวหน้ากลุ่มงาน (มอบหมาย)",
};

/** คำสั่งสำเร็จรูปตามบทบาท (ผอ./ธุรการแก้ได้) */
export function PresetEditor({ initial, editable }: { initial: Preset[]; editable: boolean }) {
  const toast = useToast();
  const [items, setItems] = useState(initial);
  const [draft, setDraft] = useState<Record<PresetRole, string>>({ director: "", clerk: "", head: "" });
  const [busy, setBusy] = useState(false);

  async function add(role: PresetRole) {
    const text = draft[role].trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const r = await savePreset(role, text);
      if (!r.ok) return toast(r.error, "error");
      setItems((x) => [...x, { id: r.id, role, text, sort: Math.max(0, ...x.filter((p) => p.role === role).map((p) => p.sort)) + 1 }]);
      setDraft((d) => ({ ...d, [role]: "" }));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await deletePreset(id);
      if (!r.ok) return toast(r.error, "error");
      setItems((x) => x.filter((p) => p.id !== id));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-5">
      <SectionTitle>คำสั่งสำเร็จรูป</SectionTitle>
      {!editable && <p className="-mt-3 text-sm text-muted">เฉพาะผู้อำนวยการและธุรการแก้ไขได้</p>}
      {PRESET_ROLES.map((role) => {
        const list = items.filter((p) => p.role === role);
        return (
          <section key={role} className="flex flex-col gap-2">
            <h3 className="font-semibold">{ROLE_TITLE[role]}</h3>
            {list.length === 0 ? (
              <p className="text-sm text-muted">ยังไม่ได้ตั้ง — ใช้ค่าตั้งต้น: {DEFAULT_PRESETS[role].join(" · ")}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line rounded-2xl border-[1.5px] border-line">
                {list.map((p) => (
                  <li key={p.id} className="flex min-h-12 items-center gap-2 pl-3">
                    <span className="flex-1">{p.text}</span>
                    {editable && (
                      <button type="button" aria-label={`ลบ “${p.text}”`} disabled={busy} onClick={() => remove(p.id)}
                        className="flex size-11 items-center justify-center rounded-xl text-red-700 hover:bg-red-50 disabled:opacity-40"><Trash size={20} /></button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {editable && (
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add(role); }}>
                <input className="field-input min-w-0 flex-1" maxLength={300} placeholder="เพิ่มข้อความ" aria-label={`เพิ่มคำสั่งสำเร็จรูป ${ROLE_TITLE[role]}`}
                  value={draft[role]} onChange={(e) => setDraft((d) => ({ ...d, [role]: e.target.value }))} />
                <Button type="submit" variant="secondary" disabled={busy || !draft[role].trim()}><Plus size={20} /> เพิ่ม</Button>
              </form>
            )}
          </section>
        );
      })}
    </Card>
  );
}
