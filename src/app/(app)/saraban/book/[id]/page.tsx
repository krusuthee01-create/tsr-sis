import { getProfile, getSettings, supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { EmptyState, LinkButton } from "@/components/ui";
import { isUuid, type BookDetail, type Preset, type StaffOption } from "@/lib/saraban/book";
import { sarabanHelp } from "@/lib/help";
import { BookView } from "./book-view";

export const metadata = { title: "หนังสือรับ" };

export default async function BookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  // id ผิดรูปแบบ = ไม่พบ (ไม่ส่งไปฐานข้อมูล)
  const [profile, settings, bookRes, staffRes, presetRes] = await Promise.all([
    getProfile(),
    getSettings(),
    isUuid(id) ? sb.rpc("saraban_book", { p_book: id }) : Promise.resolve({ data: null, error: null }),
    sb.rpc("saraban_staff_options"),
    sb.from("saraban_presets").select("id, role, text, sort").order("sort").order("id"),
  ]);
  if (bookRes.error) console.error("saraban_book", bookRes.error);
  if (staffRes.error) console.error("saraban_staff_options", staffRes.error);
  if (presetRes.error) console.error("saraban_presets", presetRes.error);
  const detail = bookRes.data as BookDetail | null;

  // RLS ซ่อนหนังสือ (ไม่มีสิทธิ์/ลบแล้ว/ไม่มีอยู่) → ไม่บอกว่ามีอยู่จริงหรือไม่
  if (!detail?.book || !profile) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="หนังสือรับ" module="saraban" back="/saraban" help={sarabanHelp(profile?.saraban_role)} />
        <EmptyState title="ไม่พบหนังสือ หรือคุณไม่มีสิทธิ์ดู" action={<LinkButton href="/saraban">กลับไปรายการหนังสือ</LinkButton>}>
          หนังสืออาจถูกลบ หรือยังไม่ได้มอบหมายถึงท่าน
        </EmptyState>
      </div>
    );
  }

  const b = detail.book;
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={`หนังสือรับที่ ${b.receive_no}/${b.year}`} module="saraban" back="/saraban" help={sarabanHelp(profile.saraban_role)}
        subtitle={b.secret ? "หนังสือลับ" : b.from_org} />
      <BookView
        detail={detail}
        me={{
          id: profile.id,
          role: profile.saraban_role ?? "teacher",
          workGroup: profile.work_group,
          // แบบหนังสือราชการ: คำนำหน้าติดชื่อ "นายสุธี พาทีทิน"
          name: `${profile.prefix ?? ""}${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim(),
        }}
        staff={(staffRes.data ?? []) as StaffOption[]}
        presets={(presetRes.data ?? []) as Preset[]}
        schoolName={settings?.school_name ?? "โรงเรียนอนุบาลเทพสุนทรินทร์"}
      />
    </div>
  );
}
