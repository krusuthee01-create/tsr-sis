"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PaperPlaneRight } from "@phosphor-icons/react";
import { Button, Card, Field, SectionTitle } from "@/components/ui";
import { useToast } from "@/components/toast";
import { withBase } from "@/lib/base-path";
import { supabaseBrowser } from "@/lib/supabase/client";
import { todayISO } from "@/lib/thai-date";
import { safeMessage } from "@/lib/saraban/book";
import { parseMemoInput, type MemoInput } from "@/lib/saraban/memo";
import { uploadPdf } from "../../upload";
import { createMemo } from "../actions";

const PLACEHOLDER_NO = "(ระบบออกเลขเมื่อส่ง)";

/** ฟอร์มบันทึกข้อความ + พรีวิว A4 สด · ส่ง: ออกเลข › สร้าง PDF › อัปโหลดเป็นต้นฉบับ › ไปหน้าหนังสือ */
export function MemoForm({ staffId, signerName, school, defaultPosition }: { staffId: string; signerName: string; school: string; defaultPosition: string }) {
  const router = useRouter();
  const toast = useToast();
  const [f, setF] = useState<MemoInput>({
    unit: school, subject: "", to: `ผู้อำนวยการ${school}`, cause: "", intent: "", closing: "จึงเรียนมาเพื่อโปรดพิจารณา", position: defaultPosition,
  });
  const [signature, setSignature] = useState<ImageBitmap | null>(null);
  const [pages, setPages] = useState<string[]>([]);
  const [step, setStep] = useState<string | null>(null);
  const [pending, setPending] = useState<{ bookId: string; docNo: string } | null>(null); // ได้เลขแล้วแต่อัปโหลดไม่สำเร็จ
  const running = useRef(false);
  const set = (k: keyof MemoInput, v: string) => setF((x) => ({ ...x, [k]: v }));

  // ลายเซ็นของฉัน (ไม่มีก็ใช้ชื่ออย่างเดียว)
  useEffect(() => {
    let alive = true;
    supabaseBrowser().storage.from("signatures").download(`${staffId}/signature.png`)
      .then(async ({ data }) => { if (alive && data) setSignature(await createImageBitmap(data).catch(() => null)); })
      .catch(() => {});
    return () => { alive = false; };
  }, [staffId]);

  // พรีวิว A4 (หน่วงเล็กน้อยระหว่างพิมพ์)
  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      const { renderMemo } = await import("@/lib/saraban/memo-canvas");
      const cs = await renderMemo({ ...f, docNo: pending?.docNo ?? PLACEHOLDER_NO, date: todayISO(), signerName }, { garudaUrl: withBase("/saraban/garuda.png"), signature });
      if (alive) setPages(cs.map((c) => c.toDataURL("image/png")));
    }, 400);
    return () => { alive = false; clearTimeout(t); };
  }, [f, signature, signerName, pending?.docNo]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (running.current) return;
    const parsed = parseMemoInput(f);
    if (!parsed.ok) return toast(parsed.error, "error");
    running.current = true;
    try {
      let target = pending;
      if (!target) {
        setStep("กำลังออกเลขบันทึก…");
        const r = await createMemo(f);
        if (!r.ok) return toast(r.error, "error");
        target = { bookId: r.bookId, docNo: r.docNo };
        setPending(target);
      }
      setStep("กำลังสร้างไฟล์ PDF…");
      const [{ renderMemo, memoPdf }] = await Promise.all([import("@/lib/saraban/memo-canvas")]);
      const canvases = await renderMemo({ ...f, docNo: target.docNo, date: todayISO(), signerName }, { garudaUrl: withBase("/saraban/garuda.png"), signature });
      const pdf = await memoPdf(canvases);
      setStep("กำลังอัปโหลด…");
      await uploadPdf(target.bookId, "original", `บันทึกข้อความ ${target.docNo}.pdf`.replace(/\//g, "-"), new Blob([pdf as BlobPart], { type: "application/pdf" }));
      toast(`ส่งบันทึกข้อความ ${target.docNo} ถึงธุรการแล้ว`);
      router.push(`/saraban/book/${target.bookId}`);
    } catch (err) {
      toast(`ได้เลขบันทึกแล้ว แต่อัปโหลดไฟล์ไม่สำเร็จ (${safeMessage(err, "ไม่ทราบสาเหตุ")}) กด "ส่ง" อีกครั้ง`, "error");
    } finally {
      running.current = false;
      setStep(null);
    }
  }

  const area = (k: keyof MemoInput, label: string, rows: number, hint?: string) => (
    <Field label={label} htmlFor={`memo-${k}`} hint={hint}>
      <textarea id={`memo-${k}`} className="field-input" rows={rows} maxLength={k === "closing" ? 2000 : 4000}
        value={f[k]} disabled={!!pending} onChange={(e) => set(k, e.target.value)} />
    </Field>
  );

  return (
    <form onSubmit={submit} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card className="flex flex-col gap-3">
        <SectionTitle>ข้อความ</SectionTitle>
        {pending && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
            ได้เลข {pending.docNo} แล้ว (แก้ข้อความไม่ได้) กด &quot;ส่ง&quot; เพื่ออัปโหลดไฟล์อีกครั้ง หรือ <Link href={`/saraban/book/${pending.bookId}`} className="underline">เปิดหน้าหนังสือ</Link>
          </p>
        )}
        <Field label="ส่วนราชการ" htmlFor="memo-unit">
          <input id="memo-unit" className="field-input" maxLength={300} value={f.unit} disabled={!!pending} onChange={(e) => set("unit", e.target.value)} />
        </Field>
        <Field label="เรื่อง" htmlFor="memo-subject" required>
          <input id="memo-subject" className="field-input" maxLength={1000} value={f.subject} disabled={!!pending} onChange={(e) => set("subject", e.target.value)} />
        </Field>
        <Field label="เรียน" htmlFor="memo-to">
          <input id="memo-to" className="field-input" maxLength={300} value={f.to} disabled={!!pending} onChange={(e) => set("to", e.target.value)} />
        </Field>
        {area("cause", "ภาคเหตุ (ด้วย…)", 4, "เหตุผลที่ทำบันทึก ขึ้นบรรทัดใหม่ = ย่อหน้าใหม่")}
        {area("intent", "ภาคความประสงค์ (ในการนี้…)", 4)}
        {area("closing", "ภาคสรุป", 2)}
        <Field label="ตำแหน่งผู้เขียน" htmlFor="memo-position">
          <input id="memo-position" className="field-input" maxLength={200} value={f.position} disabled={!!pending} onChange={(e) => set("position", e.target.value)} />
        </Field>
        <p className="text-sm text-muted">
          ลงชื่อ: {signerName}{signature ? " (พร้อมลายเซ็น)" : <> — ยังไม่มีลายเซ็น <Link href="/saraban/settings" className="underline">ตั้งค่าลายเซ็น</Link></>}
        </p>
        <div className="sticky bottom-20 z-10 md:bottom-4">
          <Button type="submit" size="lg" className="w-full shadow-lg" disabled={!!step || !f.subject.trim()}>
            {step ?? <><PaperPlaneRight size={22} weight="bold" /> ส่งถึงธุรการ</>}
          </Button>
        </div>
      </Card>
      <Card className="flex flex-col gap-3 lg:sticky lg:top-4 lg:self-start">
        <SectionTitle>ตัวอย่าง (A4)</SectionTitle>
        {pages.length === 0 ? <p className="py-10 text-center text-muted">กำลังสร้างตัวอย่าง…</p> : pages.map((src, i) => (
          // eslint-disable-next-line @next/next/no-img-element -- ภาพพรีวิวจาก canvas ในเครื่อง
          <img key={i} src={src} alt={`ตัวอย่างบันทึกข้อความ หน้า ${i + 1}`} className="w-full rounded-md border border-slate-300 shadow-sm" />
        ))}
      </Card>
    </form>
  );
}
