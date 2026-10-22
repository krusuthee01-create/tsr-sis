import Link from "next/link";
import { CheckCircle, Drop, Tooth, ClipboardText, Warning, CaretRight, Chalkboard, GearSix } from "@phosphor-icons/react/dist/ssr";
import { can, getProfile, getSettings, supabaseServer } from "@/lib/supabase/server";
import { formatThaiDate, todayISO, addDays, formatTime } from "@/lib/thai-date";
import { classroomName, fullName, shortPrefix } from "@/lib/domain";
import { Card, Badge, SectionTitle, EmptyState, LinkButton } from "@/components/ui";
import { HelpButton } from "@/components/help";

type Progress = {
  classroom_id: number; grade: string; room: number; students: number;
  line_at: string | null; milk_at: string | null; brush_at: string | null;
  present: number; late: number; leave: number; absent: number; homeroom: string | null;
};

export default async function HomePage() {
  const sb = await supabaseServer();
  const [profile, settings] = await Promise.all([getProfile(), getSettings()]);
  const today = todayISO();
  const isLeader = can(profile, "admin", "executive");

  const [{ data: schoolDay }, { data: progressData }] = await Promise.all([
    sb.rpc("is_school_day", { p_date: today }),
    sb.rpc("daily_progress", { p_date: today }),
  ]);
  const progress = (progressData ?? []) as Progress[];
  const myRooms = (profile?.homerooms ?? []).map((h) => ({ ...h, p: progress.find((p) => p.classroom_id === h.classroom_id) }));
  const alerts = await consecutiveAbsences(sb, myRooms.map((r) => r.classroom_id), today);
  const firstName = profile ? `${shortPrefix(profile.prefix)}${profile.first_name}` : "";

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="no-print relative overflow-hidden rounded-[1.5rem] bg-navy-700 px-5 pb-6 pt-5 text-white">
        <div className="absolute -right-16 -top-20 size-56 rounded-full bg-sky-brand/30" aria-hidden />
        <div className="relative flex items-start gap-3">
          <div className="flex-1">
            <p className="text-sm text-sky-200">{formatThaiDate(today, "weekday")}{settings?.current_year ? ` · ปีการศึกษา ${settings.current_year}` : ""}</p>
            <h1 className="text-2xl font-semibold">สวัสดี {firstName}</h1>
            <p className="mt-1 text-sky-100">
              {myRooms.length ? `ครูที่ปรึกษา ${myRooms.map((r) => classroomName(r)).join(", ")}` : "ยินดีต้อนรับสู่ระบบสารสนเทศนักเรียน"}
            </p>
          </div>
          <HelpButton topic="home" tone="dark" />
        </div>
      </div>

      {can(profile, "admin") && (!settings?.current_year || schoolDay === null) && (
        <Card className="flex items-center gap-3 border-2 border-amber-300 bg-amber-50">
          <GearSix size={32} weight="duotone" className="text-amber-700" />
          <p className="flex-1 font-medium text-amber-950">ยังตั้งค่าระบบไม่ครบ (ปีการศึกษา ภาคเรียน) ครูจะยังเช็กชื่อไม่ได้</p>
          <LinkButton href="/settings" variant="primary">ไปตั้งค่า</LinkButton>
        </Card>
      )}

      {!schoolDay && (
        <Card className="bg-sky-50 text-sky-950">วันนี้ไม่ใช่วันเรียนตามปฏิทินของโรงเรียน (เสาร์-อาทิตย์ วันหยุด หรือนอกภาคเรียน)</Card>
      )}

      {myRooms.map((r) => <TodayCard key={r.classroom_id} room={r} p={r.p} schoolDay={!!schoolDay} />)}

      {alerts.length > 0 && (
        <Card className="bg-pink-50">
          <SectionTitle>นักเรียนที่ควรติดตาม</SectionTitle>
          <ul className="flex flex-col gap-2">
            {alerts.map((a) => (
              <li key={a.student_id}>
                <Link href={`/students/${a.student_id}`} className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 hover:bg-pink-100/50">
                  <Warning size={26} weight="duotone" className="shrink-0 text-pink-700" />
                  <span className="flex-1">
                    <span className="block font-semibold text-pink-950">{a.name} ขาดเรียน {a.days} วันติด</span>
                    <span className="text-sm text-pink-800">แนะนำ: โทรหาผู้ปกครอง แล้วบันทึกการติดตาม</span>
                  </span>
                  <CaretRight size={20} className="text-pink-700" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {!myRooms.length && !isLeader && (
        <EmptyState icon={<Chalkboard size={48} weight="duotone" className="text-sky-600" />} title="ท่านยังไม่ได้เป็นครูที่ปรึกษาของห้องใด"
          action={<LinkButton href="/attendance/subject" variant="primary">เช็กชื่อประจำวิชา</LinkButton>}>
          ถ้าท่านเป็นครูที่ปรึกษา แจ้งผู้ดูแลระบบให้กำหนดห้องที่หน้า &ldquo;ห้องเรียน&rdquo;
        </EmptyState>
      )}

      {isLeader && <SchoolToday progress={progress} schoolDay={!!schoolDay} />}
    </div>
  );
}

function TaskLink({ href, done, at, icon, title, detail }: { href: string; done: boolean; at: string | null; icon: React.ReactNode; title: string; detail: string }) {
  return (
    <Link href={href} className={`flex items-center gap-3 rounded-2xl px-3.5 py-3 ${done ? "bg-green-100" : "border-2 border-dashed border-sky-300 bg-white hover:bg-sky-50"}`}>
      <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${done ? "bg-green-600 text-white" : "bg-sky-100 text-sky-700"}`}>
        {done ? <CheckCircle size={26} weight="fill" /> : icon}
      </span>
      <span className="flex-1">
        <span className="block font-semibold">{title}</span>
        <span className={`text-sm ${done ? "text-green-800" : "text-muted"}`}>{done ? `บันทึกแล้ว ${formatTime(at)} น. · ${detail}` : "ยังไม่บันทึก · แตะเพื่อเริ่ม"}</span>
      </span>
      {!done && <CaretRight size={20} className="text-sky-700" />}
    </Link>
  );
}

function TodayCard({ room, p, schoolDay }: { room: { classroom_id: number; grade: string; room: number }; p?: Progress; schoolDay: boolean }) {
  const done = [p?.line_at, p?.milk_at, p?.brush_at].filter(Boolean).length;
  const base = `/attendance?c=${room.classroom_id}`;
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">งานวันนี้ · {classroomName(room)}</h2>
        <span className="text-sm text-muted">เสร็จ {done} จาก 3</span>
      </div>
      <div className="mb-3 h-2 overflow-hidden rounded-full bg-slate-200">
        <div className="h-full rounded-full bg-green-600" style={{ width: `${(done / 3) * 100}%` }} />
      </div>
      {schoolDay ? (
        <div className="grid gap-2 md:grid-cols-3">
          <TaskLink href={`${base}&k=line`} done={!!p?.line_at} at={p?.line_at ?? null} icon={<ClipboardText size={26} weight="duotone" />}
            title="เช็กชื่อเข้าแถว" detail={`มา ${(p?.present ?? 0) + (p?.late ?? 0)} ลา ${p?.leave ?? 0} ขาด ${p?.absent ?? 0}`} />
          <TaskLink href={`${base}&k=milk`} done={!!p?.milk_at} at={p?.milk_at ?? null} icon={<Drop size={26} weight="duotone" />} title="ดื่มนม" detail="ครบแล้ว" />
          <TaskLink href={`${base}&k=brush`} done={!!p?.brush_at} at={p?.brush_at ?? null} icon={<Tooth size={26} weight="duotone" />} title="แปรงฟัน" detail="ครบแล้ว" />
        </div>
      ) : (
        <p className="text-muted">วันนี้ไม่มีงานบันทึกประจำวัน</p>
      )}
    </Card>
  );
}

function SchoolToday({ progress, schoolDay }: { progress: Progress[]; schoolDay: boolean }) {
  if (!progress.length) return null;
  const missing = progress.filter((p) => !p.line_at);
  const totals = progress.reduce((a, p) => ({ students: a.students + p.students, present: a.present + p.present + p.late, leave: a.leave + p.leave, absent: a.absent + p.absent }),
    { students: 0, present: 0, leave: 0, absent: 0 });
  return (
    <Card>
      <SectionTitle action={<LinkButton href="/reports?tab=daily" variant="ghost" size="sm">ดูรายงาน</LinkButton>}>ทุกห้องวันนี้</SectionTitle>
      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        <div className="rounded-2xl bg-slate-100 px-3 py-2.5"><p className="font-display text-2xl font-bold">{totals.students}</p><p className="text-sm">นักเรียนทั้งหมด</p></div>
        <div className="rounded-2xl bg-green-100 px-3 py-2.5 text-green-900"><p className="font-display text-2xl font-bold">{totals.present}</p><p className="text-sm">มาเรียน</p></div>
        <div className="rounded-2xl bg-sky-100 px-3 py-2.5 text-sky-900"><p className="font-display text-2xl font-bold">{totals.leave}</p><p className="text-sm">ลา</p></div>
        <div className="rounded-2xl bg-red-100 px-3 py-2.5 text-red-900"><p className="font-display text-2xl font-bold">{totals.absent}</p><p className="text-sm">ขาด</p></div>
      </div>
      {schoolDay && (
        <p className={`mb-3 rounded-xl px-3 py-2 text-sm font-semibold ${missing.length ? "bg-amber-100 text-amber-950" : "bg-green-100 text-green-900"}`}>
          {missing.length ? `ยังไม่เช็กชื่อ ${missing.length} ห้อง: ${missing.map(classroomName).join(", ")}` : "ทุกห้องเช็กชื่อเข้าแถวแล้ว"}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {progress.map((p) => (
          <Link key={p.classroom_id} href={`/attendance?c=${p.classroom_id}`}
            className={`rounded-2xl border-2 px-3 py-2.5 ${p.line_at ? "border-green-200 bg-green-50" : "border-amber-300 bg-amber-50"}`}>
            <p className="font-display font-semibold">{classroomName(p)}</p>
            <div className="mt-1 flex flex-wrap gap-1">
              <Badge tone={p.line_at ? "green" : "amber"}>แถว</Badge>
              <Badge tone={p.milk_at ? "green" : "gray"}>นม</Badge>
              <Badge tone={p.brush_at ? "green" : "gray"}>ฟัน</Badge>
            </div>
            <p className="mt-1 truncate text-xs text-muted">{p.homeroom ?? "ยังไม่มีครูที่ปรึกษา"}</p>
          </Link>
        ))}
      </div>
    </Card>
  );
}

async function consecutiveAbsences(sb: Awaited<ReturnType<typeof supabaseServer>>, classroomIds: number[], today: string) {
  if (!classroomIds.length) return [];
  const [{ data: rows }, ...rosters] = await Promise.all([
    sb.from("attendance_daily").select("student_id, date, status").in("classroom_id", classroomIds).gte("date", addDays(today, -21)).order("date", { ascending: false }),
    ...classroomIds.map((c) => sb.rpc("roster", { p_classroom: c })),
  ]);
  const names = new Map<string, string>();
  for (const r of rosters) for (const s of (r.data ?? []) as { student_id: string; prefix: string; first_name: string; last_name: string }[]) names.set(s.student_id, fullName(s, true));
  const byStudent = new Map<string, number[]>();
  for (const r of (rows ?? []) as { student_id: string; status: number }[]) {
    const list = byStudent.get(r.student_id) ?? [];
    list.push(r.status);
    byStudent.set(r.student_id, list);
  }
  const out: { student_id: string; name: string; days: number }[] = [];
  for (const [id, statuses] of byStudent) {
    let n = 0;
    for (const s of statuses) { if (s === 4) n++; else break; }
    if (n >= 3 && names.has(id)) out.push({ student_id: id, name: names.get(id)!, days: n });
  }
  return out.sort((a, b) => b.days - a.days);
}
