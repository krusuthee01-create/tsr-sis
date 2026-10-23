"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, MapPin, Trash, WarningCircle } from "@phosphor-icons/react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { compressionPlan, VISIT_OPTIONS, type VisitData } from "@/lib/care";
import { Card, SectionTitle } from "@/components/ui";
import { useToast } from "@/components/toast";

export type Visit = {
  id: string | null; visit_date: string; data: VisitData; household_size: number | null; monthly_income: number | null;
  latitude: number | null; longitude: number | null; photos: { path: string; url: string }[];
};

const MAX_PHOTOS = 3;
const TARGET_BYTES = 200 * 1024;

/** ย่อรูปด้วย canvas เป็น JPEG ไม่เกินประมาณ 200 KB (ลดคุณภาพทีละขั้น) */
async function compress(file: File): Promise<Blob> {
  const img = await createImageBitmap(file);
  let { w, h } = compressionPlan(img.width, img.height);
  for (let attempt = 0; attempt < 3; attempt++) {
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
    for (const q of [0.8, 0.65, 0.5, 0.4]) {
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", q));
      if (blob && blob.size <= TARGET_BYTES) return blob;
    }
    w = Math.round(w * 0.75); h = Math.round(h * 0.75);
  }
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
  return (await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.4)))!;
}

function Choice({ label, options, value, onChange }: { label: string; options: readonly string[]; value?: string; onChange: (v: string) => void }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-semibold">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button key={o} type="button" aria-pressed={value === o} onClick={() => onChange(value === o ? "" : o)}
            className={`min-h-11 rounded-xl border-[1.5px] px-3 text-sm font-semibold ${value === o ? "border-pink-600 bg-pink-600 text-white" : "border-slate-300 bg-white text-slate-700"}`}>{o}</button>
        ))}
      </div>
    </fieldset>
  );
}

function Multi({ label, options, value = [], onChange, danger }: { label: string; options: readonly string[]; value?: string[]; onChange: (v: string[]) => void; danger?: boolean }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-semibold">{label} <span className="font-normal text-muted">(เลือกได้หลายข้อ)</span></legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = value.includes(o);
          return (
            <button key={o} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
              className={`min-h-11 rounded-xl border-[1.5px] px-3 text-sm font-semibold ${on ? (danger ? "border-red-600 bg-red-600 text-white" : "border-pink-600 bg-pink-600 text-white") : "border-slate-300 bg-white text-slate-700"}`}>{on ? "✓ " : ""}{o}</button>
          );
        })}
      </div>
    </fieldset>
  );
}

function Text({ label, value, onChange, area, ...rest }: { label: string; value?: string | number | null; onChange: (v: string) => void; area?: boolean } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-semibold">{label}
      {area
        ? <textarea className="field-input min-h-24 font-normal" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
        : <input className="field-input font-normal" value={value ?? ""} onChange={(e) => onChange(e.target.value)} {...rest} />}
    </label>
  );
}

export function VisitForm({ studentId, classroomId, year, visitorId, initial, backHref }: {
  studentId: string; classroomId: number; year: number; visitorId: string | null; initial: Visit; backHref: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [v, setV] = useState(initial);
  const [d, setD] = useState<VisitData>(initial.data);
  const [newPhotos, setNewPhotos] = useState<{ blob: Blob; url: string }[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const set = <K extends keyof VisitData>(k: K, val: VisitData[K]) => setD((x) => ({ ...x, [k]: val }));
  const keptPhotos = v.photos.filter((p) => !removed.includes(p.path));
  const photoCount = keptPhotos.length + newPhotos.length;
  const perPerson = v.monthly_income && v.household_size ? Math.round(v.monthly_income / v.household_size) : null;

  function locate() {
    if (!navigator.geolocation) return toast("อุปกรณ์นี้ไม่รองรับการระบุตำแหน่ง", "error");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setLocating(false); setV((x) => ({ ...x, latitude: +p.coords.latitude.toFixed(6), longitude: +p.coords.longitude.toFixed(6) })); toast("บันทึกตำแหน่งแล้ว"); },
      () => { setLocating(false); toast("ระบุตำแหน่งไม่ได้ กรุณาอนุญาตการเข้าถึงตำแหน่ง แล้วลองใหม่", "error"); },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    const room = MAX_PHOTOS - photoCount;
    const list = [...files].slice(0, room);
    if (files.length > room) toast(`แนบรูปได้ไม่เกิน ${MAX_PHOTOS} รูป`, "error");
    try {
      const out = await Promise.all(list.map(async (f) => { const blob = await compress(f); return { blob, url: URL.createObjectURL(blob) }; }));
      setNewPhotos((x) => [...x, ...out]);
    } catch {
      toast("เปิดรูปนี้ไม่ได้ กรุณาเลือกรูป JPG หรือ PNG", "error");
    }
  }

  async function save() {
    if (!v.visit_date) return toast("กรุณาระบุวันที่เยี่ยมบ้าน", "error");
    setBusy(true);
    const sb = supabaseBrowser();
    try {
      const uploaded: string[] = [];
      for (const p of newPhotos) {
        const path = `${studentId}/${crypto.randomUUID()}.jpg`;
        const { error } = await sb.storage.from("home-visits").upload(path, p.blob, { contentType: "image/jpeg" });
        if (error) throw new Error(`อัปโหลดรูปไม่สำเร็จ: ${error.message}`);
        uploaded.push(path);
      }
      const row = {
        student_id: studentId, year, classroom_id: classroomId, visit_date: v.visit_date, visitor_id: visitorId, data: d,
        household_size: v.household_size, monthly_income: v.monthly_income, safety_risk: (d.risks?.length ?? 0) > 0,
        latitude: v.latitude, longitude: v.longitude, photos: [...keptPhotos.map((p) => p.path), ...uploaded],
      };
      const { error } = v.id ? await sb.from("home_visits").update(row).eq("id", v.id) : await sb.from("home_visits").insert(row);
      if (error) throw new Error(error.message);
      if (removed.length) await sb.storage.from("home-visits").remove(removed);
      toast("บันทึกการเยี่ยมบ้านแล้ว");
      router.push(backHref);
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(/,/g, "")));
  return (
    <div className="flex flex-col gap-3 pb-28">
      <Card className="flex flex-col gap-4">
        <SectionTitle>1. การเยี่ยมบ้าน</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          <Text label="วันที่เยี่ยมบ้าน" type="date" value={v.visit_date} onChange={(x) => setV({ ...v, visit_date: x })} />
          <div className="flex flex-col gap-1.5 text-sm font-semibold">ตำแหน่งบ้าน (GPS)
            <button type="button" onClick={locate} disabled={locating} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border-[1.5px] border-pink-600 bg-white font-bold text-pink-700">
              <MapPin size={22} weight="duotone" />{locating ? "กำลังหาตำแหน่ง…" : v.latitude ? "ระบุตำแหน่งใหม่" : "ระบุตำแหน่งปัจจุบัน"}
            </button>
            {v.latitude && v.longitude && (
              <a className="text-sm font-normal text-sky-700 underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${v.latitude},${v.longitude}`}>
                {v.latitude}, {v.longitude} · เปิดแผนที่
              </a>
            )}
          </div>
        </div>
      </Card>

      <Card className="flex flex-col gap-4">
        <SectionTitle>2. ครอบครัวและผู้ปกครอง</SectionTitle>
        <Choice label="นักเรียนอาศัยอยู่กับ" options={VISIT_OPTIONS.living_with} value={d.living_with} onChange={(x) => set("living_with", x)} />
        <Choice label="สถานภาพบิดามารดา" options={["อยู่ด้วยกัน", "แยกกันอยู่", "หย่าร้าง", "บิดาหรือมารดาเสียชีวิต", "อื่น ๆ"]} value={d.parents_status} onChange={(x) => set("parents_status", x)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Text label="ผู้ปกครอง (จาก DMC แก้ได้)" value={d.guardian_name} onChange={(x) => set("guardian_name", x)} />
          <Text label="โทรศัพท์ผู้ปกครอง" inputMode="tel" value={d.guardian_phone} onChange={(x) => set("guardian_phone", x)} />
          <Text label="อาชีพผู้ปกครอง" value={d.guardian_job} onChange={(x) => set("guardian_job", x)} />
          <Text label="จำนวนสมาชิกในบ้าน (คน)" inputMode="numeric" value={v.household_size} onChange={(x) => setV({ ...v, household_size: num(x) })} />
          <Text label="รายได้รวมของครอบครัว (บาท/เดือน)" inputMode="numeric" value={v.monthly_income} onChange={(x) => setV({ ...v, monthly_income: num(x) })} />
          <div className="flex items-end text-sm text-muted">{perPerson !== null && Number.isFinite(perPerson) ? `เฉลี่ย ${perPerson.toLocaleString("th-TH")} บาท/คน/เดือน` : "ระบบคำนวณรายได้ต่อคนให้"}</div>
        </div>
      </Card>

      <Card className="flex flex-col gap-4">
        <SectionTitle>3. ที่อยู่อาศัยและการเดินทาง</SectionTitle>
        <Text label="ที่อยู่ปัจจุบัน (จาก DMC แก้ได้)" area value={d.address} onChange={(x) => set("address", x)} />
        <Choice label="ลักษณะที่อยู่อาศัย" options={VISIT_OPTIONS.house_owner} value={d.house_owner} onChange={(x) => set("house_owner", x)} />
        <Choice label="สภาพบ้าน" options={VISIT_OPTIONS.house_condition} value={d.house_condition} onChange={(x) => set("house_condition", x)} />
        <Multi label="สิ่งอำนวยความสะดวก" options={VISIT_OPTIONS.utilities} value={d.utilities} onChange={(x) => set("utilities", x)} />
        <Choice label="การเดินทางมาโรงเรียน" options={VISIT_OPTIONS.travel} value={d.travel} onChange={(x) => set("travel", x)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Text label="ระยะทาง (กม.)" inputMode="decimal" value={d.distance_km} onChange={(x) => set("distance_km", num(x))} />
          <Text label="เวลาเดินทาง (นาที)" inputMode="numeric" value={d.travel_minutes} onChange={(x) => set("travel_minutes", num(x))} />
        </div>
      </Card>

      <Card className="flex flex-col gap-4">
        <SectionTitle>4. ความเสี่ยงและความต้องการ</SectionTitle>
        <Multi label="ความเสี่ยงที่พบ" options={VISIT_OPTIONS.risks} value={d.risks} onChange={(x) => set("risks", x)} danger />
        {(d.risks?.length ?? 0) > 0 && (
          <p className="flex items-center gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-900"><WarningCircle size={22} weight="fill" className="shrink-0" />ระบบจะเสนอด้านความปลอดภัยเป็น &ldquo;เสี่ยง&rdquo; ในการคัดกรอง ข้อมูลนี้เห็นเฉพาะครูที่ปรึกษา ผู้บริหาร และงานแนะแนว</p>
        )}
        <Multi label="ความต้องการความช่วยเหลือ" options={VISIT_OPTIONS.needs} value={d.needs} onChange={(x) => set("needs", x)} />
        <Text label="พฤติกรรมของนักเรียนที่บ้าน" area value={d.home_behavior} onChange={(x) => set("home_behavior", x)} />
        <Text label="ความคิดเห็น/ข้อเสนอแนะของผู้ปกครอง" area value={d.parent_comment} onChange={(x) => set("parent_comment", x)} />
        <Text label="สรุปผลการเยี่ยมบ้าน (ครู)" area value={d.teacher_summary} onChange={(x) => set("teacher_summary", x)} />
      </Card>

      <Card className="flex flex-col gap-3">
        <SectionTitle>5. รูปถ่าย (ไม่เกิน {MAX_PHOTOS} รูป)</SectionTitle>
        <p className="text-sm text-muted">ระบบย่อรูปให้อัตโนมัติ (ประมาณ 200 KB ต่อรูป) ควรถ่ายให้เห็นสภาพบ้าน ไม่จำเป็นต้องเห็นหน้าบุคคล</p>
        <div className="grid grid-cols-3 gap-2">
          {keptPhotos.map((p) => (
            <div key={p.path} className="relative aspect-square overflow-hidden rounded-xl bg-slate-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt="รูปเยี่ยมบ้าน" className="size-full object-cover" />
              <button type="button" aria-label="ลบรูป" onClick={() => setRemoved((x) => [...x, p.path])} className="absolute right-1 top-1 flex size-9 items-center justify-center rounded-full bg-white/90 text-red-600"><Trash size={18} weight="bold" /></button>
            </div>
          ))}
          {newPhotos.map((p, i) => (
            <div key={p.url} className="relative aspect-square overflow-hidden rounded-xl bg-slate-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt="รูปใหม่" className="size-full object-cover" />
              <span className="absolute bottom-1 left-1 rounded bg-white/90 px-1.5 text-[0.6875rem] font-semibold">{Math.round(p.blob.size / 1024)} KB</span>
              <button type="button" aria-label="ลบรูป" onClick={() => setNewPhotos((x) => x.filter((_, j) => j !== i))} className="absolute right-1 top-1 flex size-9 items-center justify-center rounded-full bg-white/90 text-red-600"><Trash size={18} weight="bold" /></button>
            </div>
          ))}
          {photoCount < MAX_PHOTOS && (
            <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-pink-300 bg-pink-50 text-sm font-semibold text-pink-700">
              <Camera size={32} weight="duotone" />ถ่าย/เลือกรูป
              <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { addPhotos(e.target.files); e.target.value = ""; }} />
            </label>
          )}
        </div>
      </Card>

      <div className="no-print fixed inset-x-0 bottom-16 z-20 border-t border-line bg-white/95 px-3 pb-3 pt-2 backdrop-blur lg:bottom-0 lg:left-auto lg:w-[calc(100%-16rem)]">
        <div className="mx-auto max-w-3xl">
          <button type="button" onClick={save} disabled={busy} className="min-h-[3.25rem] w-full rounded-xl bg-navy-700 text-base font-bold text-white disabled:bg-slate-300">
            {busy ? "กำลังบันทึก…" : "บันทึกการเยี่ยมบ้าน"}
          </button>
        </div>
      </div>
    </div>
  );
}
