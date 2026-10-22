"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Button } from "@/components/ui";

export function PendingActions({ canClaimAdmin }: { canClaimAdmin: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function claim() {
    if (!confirm("ตั้งบัญชีนี้เป็นผู้ดูแลระบบคนแรก? (ทำได้ครั้งเดียวตอนติดตั้งระบบ)")) return;
    setBusy(true);
    await supabaseBrowser().rpc("claim_first_admin");
    router.replace("/settings");
    router.refresh();
  }

  return (
    <div className="flex w-full flex-col gap-2">
      {canClaimAdmin && (
        <div className="rounded-2xl bg-amber-50 p-4 text-left text-sm text-amber-950">
          <p className="mb-2 font-semibold">ติดตั้งระบบครั้งแรก</p>
          <p className="mb-3">ยังไม่มีผู้ดูแลระบบ ถ้าท่านเป็นผู้ติดตั้งระบบ กดปุ่มด้านล่างเพื่อเป็นผู้ดูแลระบบคนแรก</p>
          <Button variant="primary" disabled={busy} onClick={claim} className="w-full">ตั้งฉันเป็นผู้ดูแลระบบ</Button>
        </div>
      )}
      <Button variant="secondary" size="lg" onClick={() => router.refresh()}>ตรวจสอบอีกครั้ง</Button>
      <Button variant="ghost" onClick={async () => { await supabaseBrowser().auth.signOut(); router.replace("/login"); }}>ออกจากระบบ / ใช้บัญชีอื่น</Button>
    </div>
  );
}
