"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileArrowUp, MicrosoftExcelLogo, X, CheckCircle, Warning } from "@phosphor-icons/react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { downloadXlsx, readSheet } from "@/lib/excel";
import { diffStaff, parseStaffSheet, TEMPLATE_HEADERS, toStaffRecord, type StaffChange, type StaffIssue, type ExistingStaff } from "@/lib/staff-import";
import { Button, Spinner, Badge } from "@/components/ui";
import { useToast } from "@/components/toast";

/** นำเข้ารายชื่อครูจากไฟล์ Excel: ดาวน์โหลดแม่แบบ → เลือกไฟล์ → ตรวจตัวอย่าง → ยืนยัน */
export function StaffImport() {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const toast = useToast();
  const [changes, setChanges] = useState<StaffChange[] | null>(null);
  const [issues, setIssues] = useState<StaffIssue[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ added: number; updated: number; failed: string[] } | null>(null);

  function open() {
    setChanges(null);
    setIssues([]);
    setDone(null);
    ref.current?.showModal();
  }

  async function template() {
    await downloadXlsx("แม่แบบรายชื่อครู", [
      { name: "รายชื่อครู", widths: [10, 16, 18, 18, 16, 22, 14, 28], rows: [
        TEMPLATE_HEADERS,
        ["นาง", "สมใจ", "รักเรียน", "ครู", "ชำนาญการ", "ภาษาไทย", "081-234-5678", "somjai@gmail.com"],
      ] },
      { name: "คำอธิบาย", widths: [90], rows: [
        ["วิธีกรอก"],
        ["1. หนึ่งแถวต่อครู 1 คน ลบแถวตัวอย่าง (สมใจ รักเรียน) ออกก่อนนำเข้า"],
        ["2. ช่องที่ต้องมี: ชื่อ — ช่องอื่นเว้นว่างได้"],
        ["3. อีเมล Google: ครูใช้อีเมลนี้กด 'เข้าสู่ระบบด้วย Google' ได้ทันทีโดยไม่ต้องรออนุมัติ"],
        ["4. ตำแหน่ง เช่น ผู้อำนวยการ, ครู, ครูผู้ช่วย, พนักงานราชการ, ครูอัตราจ้าง, ครูพี่เลี้ยง"],
        ["5. วิทยฐานะ เช่น ชำนาญการ, ชำนาญการพิเศษ, เชี่ยวชาญ (ไม่มีให้เว้นว่าง)"],
        ["6. นำเข้าซ้ำได้: ระบบจับคู่ครูเดิมด้วยอีเมลหรือชื่อ-นามสกุล และไม่ลบข้อมูลเดิมในช่องที่เว้นว่าง"],
        ["7. ใช้คอลัมน์ 'ชื่อ-สกุล' แบบรวม (เช่น นางสมใจ รักเรียน) แทนสามคอลัมน์แรกก็ได้"],
      ] },
    ]);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const { rows } = await readSheet(file);
      const parsed = parseStaffSheet(rows);
      if (parsed.missingHeaders.length) {
        toast("ไม่พบคอลัมน์ \"ชื่อ\" ในไฟล์ กรุณาใช้แม่แบบของระบบ", "error");
        return;
      }
      const { data, error } = await supabaseBrowser().from("staff").select("id, prefix, first_name, last_name, position, academic_rank, learning_area, phone, email");
      if (error) throw error;
      setIssues(parsed.issues);
      setChanges(diffStaff(parsed.rows, (data ?? []) as ExistingStaff[]));
    } catch (e) {
      toast("อ่านไฟล์ไม่ได้: " + (e instanceof Error ? e.message : String(e)), "error");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!changes) return;
    setBusy(true);
    const sb = supabaseBrowser();
    const failed: string[] = [];
    const news = changes.filter((c) => c.kind === "new");
    let added = 0;
    if (news.length) {
      const { error } = await sb.from("staff").insert(news.map((c) => ({ ...toStaffRecord(c.row), approved: true })));
      if (error) failed.push(error.code === "23505" ? "มีอีเมลซ้ำกับครูที่อยู่ในระบบแล้ว" : error.message);
      else added = news.length;
    }
    let updated = 0;
    for (const c of changes) {
      if (c.kind !== "update") continue;
      const { error } = await sb.from("staff").update(toStaffRecord(c.row)).eq("id", c.existing.id);
      if (error) failed.push(`${c.row.first_name}: ${error.code === "23505" ? "อีเมลซ้ำกับครูท่านอื่น" : error.message}`);
      else updated += 1;
    }
    setBusy(false);
    setDone({ added, updated, failed });
    router.refresh();
  }

  const count = (k: StaffChange["kind"]) => changes?.filter((c) => c.kind === k).length ?? 0;
  const name = (c: StaffChange) => `${c.row.prefix ?? ""}${c.row.first_name} ${c.row.last_name}`.trim();

  return (
    <>
      <Button variant="secondary" size="sm" onClick={open}><MicrosoftExcelLogo size={20} weight="duotone" /> นำเข้าจาก Excel</Button>
      <dialog ref={ref} className="m-auto w-[min(44rem,calc(100vw-2rem))] rounded-3xl p-0 shadow-2xl backdrop:bg-slate-900/40">
        <div className="flex max-h-[90dvh] flex-col text-ink">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="text-lg font-semibold">นำเข้ารายชื่อครูจาก Excel</h2>
            <button type="button" aria-label="ปิด" onClick={() => ref.current?.close()} className="rounded-lg p-2 hover:bg-slate-100"><X size={20} /></button>
          </div>
          <div className="flex flex-col gap-4 overflow-y-auto p-5">
            {done ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <CheckCircle size={64} weight="duotone" className="text-green-600" />
                <p className="text-xl font-semibold">นำเข้าเรียบร้อย</p>
                <p className="text-muted">เพิ่มครูใหม่ {done.added} คน · ปรับปรุงข้อมูล {done.updated} คน</p>
                {done.failed.length > 0 && <ul className="mt-2 rounded-xl bg-red-50 p-3 text-left text-sm text-red-900">{done.failed.map((f, i) => <li key={i}>{f}</li>)}</ul>}
                <p className="mt-2 text-sm text-muted">ครูที่มีอีเมล Google เข้าระบบได้ทันที ครูที่ไม่มีอีเมล ให้สร้างชื่อผู้ใช้ในหน้าของครูแต่ละคน</p>
                <Button onClick={() => ref.current?.close()} className="mt-2">ปิด</Button>
              </div>
            ) : !changes ? (
              <>
                <ol className="flex flex-col gap-2.5 text-[0.9375rem]">
                  <li className="flex gap-3"><Step n={1} />ดาวน์โหลดแม่แบบ แล้วกรอกรายชื่อครู 1 แถวต่อ 1 คน (หรือใช้ไฟล์เดิมที่มีคอลัมน์ ชื่อ / นามสกุล)</li>
                  <li className="flex gap-3"><Step n={2} />เลือกไฟล์ ระบบจะแสดงตัวอย่างให้ตรวจก่อนบันทึก</li>
                </ol>
                <Button variant="secondary" onClick={template} className="self-start"><MicrosoftExcelLogo size={22} weight="duotone" /> ดาวน์โหลดแม่แบบ</Button>
                <label className="flex cursor-pointer flex-col items-center gap-2 rounded-3xl border-[2.5px] border-dashed border-sky-300 bg-white px-6 py-8 text-center hover:bg-sky-50">
                  <FileArrowUp size={48} weight="duotone" className="text-sky-600" />
                  <span className="font-semibold">แตะเพื่อเลือกไฟล์ Excel (.xlsx)</span>
                  <input type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
                </label>
                {busy && <Spinner label="กำลังอ่านไฟล์" />}
              </>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-2xl bg-green-100 p-3 text-green-900"><p className="font-display text-2xl font-bold">{count("new")}</p><p className="text-sm">ครูใหม่</p></div>
                  <div className="rounded-2xl bg-sky-100 p-3 text-sky-900"><p className="font-display text-2xl font-bold">{count("update")}</p><p className="text-sm">ปรับปรุงข้อมูล</p></div>
                  <div className="rounded-2xl bg-slate-100 p-3 text-slate-800"><p className="font-display text-2xl font-bold">{count("same")}</p><p className="text-sm">ไม่เปลี่ยนแปลง</p></div>
                </div>
                {issues.length > 0 && (
                  <div className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-950">
                    <p className="mb-1 flex items-center gap-2 font-semibold"><Warning size={20} weight="duotone" /> ข้อสังเกต {issues.length} รายการ</p>
                    <ul className="flex flex-col gap-0.5">{issues.map((i, k) => <li key={k}>แถว {i.row}: {i.message}</li>)}</ul>
                  </div>
                )}
                <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-2xl border border-line">
                  {changes.map((c, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm">
                      <Badge tone={c.kind === "new" ? "green" : c.kind === "update" ? "blue" : "gray"}>{c.kind === "new" ? "ใหม่" : c.kind === "update" ? "ปรับปรุง" : "เหมือนเดิม"}</Badge>
                      <span className="font-semibold">{name(c)}</span>
                      <span className="text-muted">{c.kind === "update" ? `แก้: ${c.fields.join(", ")}` : [c.row.position, c.row.email].filter(Boolean).join(" · ")}</span>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap justify-between gap-2">
                  <Button variant="secondary" onClick={() => setChanges(null)} disabled={busy}>‹ เลือกไฟล์ใหม่</Button>
                  <Button variant="success" onClick={confirm} disabled={busy || count("new") + count("update") === 0}>
                    {busy ? "กำลังบันทึก…" : `ยืนยันนำเข้า ${count("new") + count("update")} คน`}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}

function Step({ n }: { n: number }) {
  return <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sm font-bold text-sky-900">{n}</span>;
}
