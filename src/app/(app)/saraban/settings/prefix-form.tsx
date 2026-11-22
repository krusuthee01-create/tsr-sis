"use client";

import { useState } from "react";
import { Button, Card, Field, SectionTitle } from "@/components/ui";
import { useToast } from "@/components/toast";
import { setOutPrefix } from "../out/actions";

/** เลขที่หนังสือของโรงเรียน (ส่วนหน้าเลขหนังสือส่ง เช่น ศธ 04109.84/123) — ผอ./ธุรการ */
export function PrefixForm({ initial }: { initial: string }) {
  const toast = useToast();
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <Card className="flex flex-col gap-3">
      <SectionTitle>เลขที่หนังสือของโรงเรียน</SectionTitle>
      <form className="flex flex-wrap items-end gap-3" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const r = await setOutPrefix(v);
        setBusy(false);
        toast(r.ok ? "บันทึกแล้ว ใช้กับเลขที่ขอใหม่" : r.error, r.ok ? undefined : "error");
      }}>
        <Field label="ส่วนหน้าเลขหนังสือส่ง" htmlFor="saraban-prefix" hint={`ตัวอย่าง: ${v.trim() || "ศธ 04109.84"}/123 และหนังสือเวียน ${v.trim() || "ศธ 04109.84"}/ว 123`}>
          <input id="saraban-prefix" className="field-input" maxLength={40} value={v} onChange={(e) => setV(e.target.value)} />
        </Field>
        <Button type="submit" variant="secondary" disabled={busy || !v.trim() || v.trim() === initial}>บันทึก</Button>
      </form>
    </Card>
  );
}
