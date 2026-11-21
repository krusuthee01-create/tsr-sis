import { Plus } from "@phosphor-icons/react/dist/ssr";
import { getProfile, supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { LinkButton } from "@/components/ui";
import { Inbox, type InboxFilter } from "./inbox";
import type { InboxRow } from "./actions";

export const metadata = { title: "สารบรรณ" };

const FILTERS: InboxFilter[] = ["todo", "all", "unread"];

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
      <PageHeader title="สารบรรณ" module="saraban" subtitle="หนังสือรับ"
        actions={canRegister ? <LinkButton href="/saraban/new" variant="secondary"><Plus size={20} weight="bold" /> ลงรับหนังสือ</LinkButton> : undefined} />
      <Inbox rows={rows} q={q} filter={filter} offset={offset}
        error={error ? "โหลดรายการหนังสือไม่สำเร็จ กรุณาลองใหม่" : null} />
    </div>
  );
}
