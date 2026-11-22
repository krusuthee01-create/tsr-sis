import Link from "next/link";
import { BookOpenText, GearSix, NotePencil, PaperPlaneTilt, Plus } from "@phosphor-icons/react/dist/ssr";
import { getProfile, supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { LinkButton } from "@/components/ui";
import { sarabanHelp } from "@/lib/help";
import { Inbox, type InboxFilter } from "./inbox";
import type { InboxRow } from "./actions";

export const metadata = { title: "สารบรรณ" };

const FILTERS: InboxFilter[] = ["todo", "all", "unread", "mine"];

export default async function SarabanPage({ searchParams }: { searchParams: Promise<{ q?: string; f?: string; p?: string }> }) {
  const sp = await searchParams;
  const profile = await getProfile();
  const role = profile?.saraban_role ?? "teacher";
  const canRegister = role === "director" || role === "clerk";
  // ครูเห็น "งานของฉัน" ก่อน บทบาทอื่นเห็นทั้งหมด
  const filter: InboxFilter = FILTERS.includes(sp.f as InboxFilter) ? (sp.f as InboxFilter) : role === "teacher" ? "todo" : "all";
  const q = (sp.q ?? "").trim().slice(0, 200);
  const offset = Math.max(0, Math.floor(Number(sp.p)) || 0);

  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("saraban_inbox", { p_q: q || null, p_filter: filter, p_offset: offset });
  if (error) console.error("saraban_inbox", error);
  const rows = (data ?? []) as InboxRow[];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="สารบรรณ" module="saraban" subtitle="หนังสือรับ" help={sarabanHelp(role)}
        actions={<>
          {canRegister && <LinkButton href="/saraban/new" variant="secondary"><Plus size={20} weight="bold" /> ลงรับหนังสือ</LinkButton>}
          {canRegister && <LinkButton href="/saraban/register" variant="secondary"><BookOpenText size={20} weight="bold" /> ทะเบียนรับ</LinkButton>}
          <LinkButton href="/saraban/memo/new" variant="secondary"><NotePencil size={20} weight="bold" /> เขียนบันทึกข้อความ</LinkButton>
          <LinkButton href="/saraban/out" variant="secondary"><PaperPlaneTilt size={20} weight="bold" /> หนังสือส่ง / ขอเลข</LinkButton>
          <Link href="/saraban/settings" aria-label="ตั้งค่าสารบรรณ" title="ตั้งค่าสารบรรณ"
            className="flex size-[2.875rem] items-center justify-center rounded-xl bg-white/20 hover:bg-white/30"><GearSix size={24} weight="bold" /></Link>
        </>} />
      <Inbox rows={rows} q={q} filter={filter} offset={offset}
        error={error ? "โหลดรายการหนังสือไม่สำเร็จ กรุณาลองใหม่" : null} />
    </div>
  );
}
