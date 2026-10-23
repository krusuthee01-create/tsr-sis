import Link from "next/link";
import { notFound } from "next/navigation";
import { Phone } from "@phosphor-icons/react/dist/ssr";
import { can, getProfile, getSettings, supabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { Badge, Card, LinkTabs, SectionTitle, Stat } from "@/components/ui";
import { ATTENDANCE_STATUSES, classroomName, formatCitizenId, fullName, STUDENT_STATUSES } from "@/lib/domain";
import { ageOf, formatThaiDate, formatThaiDateTime, monthRange, parseISO, THAI_MONTHS, todayISO, weekdayOf } from "@/lib/thai-date";
import { attendancePercent } from "@/lib/reports";
import { HFA, TONE_STYLE, WFA, WFH } from "@/lib/nutrition";
import { ExtraForm, AdminActions } from "./student-actions";

export const metadata = { title: "ประวัตินักเรียน" };

type Student = {
  id: string; citizen_id: string; student_code: string | null; prefix: string | null; first_name: string; last_name: string;
  first_name_en: string | null; last_name_en: string | null; gender: string | null; birth_date: string | null; blood_group: string | null;
  nationality: string | null; religion: string | null; father_name: string | null; father_phone: string | null; mother_name: string | null;
  mother_phone: string | null; guardian_name: string | null; guardian_relation: string | null; guardian_phone: string | null;
  address_registered: string | null; address_current: string | null; weight_dmc: number | null; height_dmc: number | null;
  nickname: string | null; note: string | null; status: string; status_date: string | null; status_note: string | null; dmc_imported_at: string | null;
};

export default async function StudentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; m?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const sb = await supabaseServer();
  const [profile, settings] = await Promise.all([getProfile(), getSettings()]);
  const tab = sp.tab === "attendance" || sp.tab === "history" || sp.tab === "nutrition" ? sp.tab : "info";

  const [{ data: student }, { data: enrollData }] = await Promise.all([
    sb.from("students").select("*").eq("id", id).maybeSingle(),
    sb.from("enrollments").select("year, number, repeated, classroom_id, classrooms(grade, room)").eq("student_id", id).order("year", { ascending: false }),
  ]);
  const enrollments = (enrollData ?? []) as unknown as { year: number; number: number | null; repeated: boolean; classroom_id: number; classrooms: { grade: string; room: number } }[];
  const current = enrollments.find((e) => e.year === settings?.current_year) ?? enrollments[0];

  // ครูประจำวิชา/ครูพี่เลี้ยง: เห็นเฉพาะชื่อและการมาเรียน ไม่เห็นข้อมูลส่วนตัว
  type Basic = { student_id: string; prefix: string | null; first_name: string; last_name: string; nickname: string | null; student_code: string | null; status: string };
  let basic: Basic | null = null;
  if (!student && current) {
    const { data } = await sb.rpc("roster", { p_classroom: current.classroom_id, p_only_active: false });
    basic = ((data ?? []) as Basic[]).find((r) => r.student_id === id) ?? null;
  }
  const s = (student as Student | null) ?? null;
  const who = s ?? basic;
  if (!who) notFound();

  const isAdmin = can(profile, "admin");
  const canEditExtra = !!s; // ผู้ที่เห็นข้อมูลเต็ม = ครูที่ปรึกษา ผู้บริหาร แนะแนว ผู้ดูแลระบบ
  const status = STUDENT_STATUSES[who.status];
  const base = `/students/${id}`;

  let classrooms: { id: number; grade: string; room: number }[] = [];
  if (isAdmin && settings?.current_year) {
    const { data } = await sb.from("classrooms").select("id, grade, room").eq("year", settings.current_year);
    classrooms = (data ?? []) as typeof classrooms;
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={fullName(who)} module="registry" help="student" back={current ? `/students?c=${current.classroom_id}` : "/students"}
        subtitle={<span className="flex flex-wrap items-center gap-2">
          {current ? `${classroomName(current.classrooms)} · เลขที่ ${current.number ?? "-"}` : "ยังไม่มีห้องเรียน"} · รหัส {who.student_code ?? "-"}
          {who.nickname && ` · ชื่อเล่น ${who.nickname}`}
          <Badge tone={status?.tone ?? "gray"} className="bg-white">{status?.label ?? who.status}</Badge>
        </span>}
        actions={isAdmin && s ? <AdminActions studentId={id} status={s.status} classrooms={classrooms} currentClassroom={current?.classroom_id} /> : undefined} />

      <div className="mb-3">
        <LinkTabs current={tab} tabs={[
          { id: "info", label: "ข้อมูลทั่วไป", href: base },
          { id: "attendance", label: "การมาเรียน", href: `${base}?tab=attendance` },
          { id: "nutrition", label: "โภชนาการ", href: `${base}?tab=nutrition` },
          { id: "history", label: "ห้องเรียนและสถานะ", href: `${base}?tab=history` },
        ]} />
      </div>

      {tab === "info" && (s ? <InfoTab s={s} canEditExtra={canEditExtra} /> : (
        <Card className="text-muted">ท่านเห็นได้เฉพาะชื่อและการมาเรียนของนักเรียนคนนี้ ข้อมูลส่วนตัวและผู้ปกครองเปิดให้เฉพาะครูที่ปรึกษา ผู้บริหาร และงานแนะแนว (ตาม PDPA)</Card>
      ))}
      {tab === "attendance" && <AttendanceTab studentId={id} month={sp.m} base={base} />}
      {tab === "nutrition" && <NutritionTab studentId={id} />}
      {tab === "history" && <HistoryTab studentId={id} enrollments={enrollments} canSeeHistory={!!s} />}
    </div>
  );
}

function Row({ k, v, dmc }: { k: string; v: React.ReactNode; dmc?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-slate-100 py-2.5 sm:flex-row sm:justify-between sm:gap-4">
      <dt className="text-sm text-muted">{k}</dt>
      <dd className="font-semibold sm:text-right">{v || "-"} {dmc && <span className="ml-1 rounded bg-sky-100 px-1.5 py-0.5 text-[0.6875rem] font-bold text-sky-800">DMC</span>}</dd>
    </div>
  );
}

function PhoneLink({ phone }: { phone: string | null }) {
  if (!phone) return <>-</>;
  return <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1 text-green-700 underline"><Phone size={16} weight="duotone" />{phone}</a>;
}

function InfoTab({ s, canEditExtra }: { s: Student; canEditExtra: boolean }) {
  const phone = s.guardian_phone ?? s.mother_phone ?? s.father_phone;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Card>
        <p className="mb-2 rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-900">ข้อมูลที่มีป้าย DMC แก้ที่ DMC แล้วนำเข้าใหม่ · นำเข้าล่าสุด {formatThaiDateTime(s.dmc_imported_at)}</p>
        <dl>
          <Row k="เลขประจำตัวประชาชน" v={formatCitizenId(s.citizen_id)} dmc />
          <Row k="ชื่อ (อังกฤษ)" v={[s.first_name_en, s.last_name_en].filter(Boolean).join(" ")} dmc />
          <Row k="เพศ" v={s.gender === "ช" ? "ชาย" : s.gender === "ญ" ? "หญิง" : "-"} dmc />
          <Row k="วันเกิด" v={s.birth_date ? `${formatThaiDate(s.birth_date, "long")} (${ageOf(s.birth_date)})` : "-"} dmc />
          <Row k="หมู่โลหิต" v={s.blood_group} dmc />
          <Row k="สัญชาติ / ศาสนา" v={[s.nationality, s.religion].filter(Boolean).join(" / ")} dmc />
          <Row k="น้ำหนัก / ส่วนสูง (DMC)" v={s.weight_dmc ? `${s.weight_dmc} กก. / ${s.height_dmc ?? "-"} ซม.` : "-"} dmc />
        </dl>
      </Card>
      <Card>
        <dl>
          <Row k="ผู้ปกครอง" v={s.guardian_name ? `${s.guardian_name}${s.guardian_relation ? ` (${s.guardian_relation})` : ""}` : "-"} dmc />
          <Row k="โทรศัพท์ผู้ปกครอง" v={<PhoneLink phone={s.guardian_phone} />} dmc />
          <Row k="บิดา" v={s.father_name} dmc />
          <Row k="โทรศัพท์บิดา" v={<PhoneLink phone={s.father_phone} />} dmc />
          <Row k="มารดา" v={s.mother_name} dmc />
          <Row k="โทรศัพท์มารดา" v={<PhoneLink phone={s.mother_phone} />} dmc />
          <Row k="ที่อยู่ปัจจุบัน" v={s.address_current} dmc />
          <Row k="ที่อยู่ตามทะเบียนบ้าน" v={s.address_registered} dmc />
        </dl>
        {phone && (
          <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="mt-3 flex min-h-12 items-center justify-center gap-2 rounded-xl bg-green-600 font-bold text-white">
            <Phone size={22} weight="duotone" /> โทรหาผู้ปกครอง
          </a>
        )}
      </Card>
      <Card className="md:col-span-2">
        <SectionTitle>ข้อมูลเพิ่มเติม (ครูที่ปรึกษาแก้ได้)</SectionTitle>
        <ExtraForm studentId={s.id} nickname={s.nickname} note={s.note} canEdit={canEditExtra} />
      </Card>
    </div>
  );
}

async function AttendanceTab({ studentId, month, base }: { studentId: string; month?: string; base: string }) {
  const sb = await supabaseServer();
  const today = todayISO();
  const ym = month && /^\d{4}-\d{2}$/.test(month) ? month : today.slice(0, 7);
  const { y, m } = parseISO(`${ym}-01`);
  const range = monthRange(y, m);

  const { data: term } = await sb.from("terms").select("term, year, start_date, end_date").lte("start_date", today).order("start_date", { ascending: false }).limit(1).maybeSingle();
  const termTo = term ? (today < term.end_date ? today : term.end_date) : today;
  const [{ data: monthRows }, { data: termRows }, { data: schoolDays }, { data: holidays }] = await Promise.all([
    sb.from("attendance_daily").select("date, status").eq("student_id", studentId).gte("date", range.from).lte("date", range.to),
    term ? sb.from("attendance_daily").select("status").eq("student_id", studentId).gte("date", term.start_date).lte("date", termTo) : Promise.resolve({ data: [] }),
    term ? sb.rpc("school_days", { p_from: term.start_date, p_to: termTo }) : Promise.resolve({ data: 0 }),
    sb.from("holidays").select("date, name").gte("date", range.from).lte("date", range.to),
  ]);
  const byDate = new Map(((monthRows ?? []) as { date: string; status: number }[]).map((r) => [r.date, r.status]));
  const holidayMap = new Map(((holidays ?? []) as { date: string; name: string }[]).map((h) => [h.date, h.name]));
  const c = [0, 0, 0, 0, 0];
  for (const r of (termRows ?? []) as { status: number }[]) c[r.status] += 1;
  const pct = attendancePercent({ present: c[0], late: c[1] }, Number(schoolDays) || 0);

  const lastDay = Number(range.to.slice(8));
  const firstDow = weekdayOf(range.from);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;

  return (
    <div className="grid gap-3 md:grid-cols-[1fr_1.3fr]">
      <Card>
        <SectionTitle>{term ? `ภาคเรียนที่ ${term.term}/${term.year}` : "ภาคเรียนนี้"}</SectionTitle>
        <div className={`mb-3 rounded-2xl px-4 py-3 ${pct !== null && pct < 80 ? "bg-red-50 text-red-900" : "bg-green-50 text-green-900"}`}>
          <p className="text-sm">มาเรียน (มา + สาย)</p>
          <p className="font-display text-4xl font-bold">{pct ?? "-"}{pct !== null && "%"}</p>
          <p className="text-sm">จาก {Number(schoolDays) || 0} วันเรียน</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="มา" value={c[0]} tone="green" />
          <Stat label="สาย" value={c[1]} tone="amber" />
          <Stat label="ลา (ป่วย/กิจ)" value={`${c[2]} / ${c[3]}`} tone="blue" />
          <Stat label="ขาด" value={c[4]} tone="red" />
        </div>
      </Card>
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <Link href={`${base}?tab=attendance&m=${prev}`} className="rounded-xl px-3 py-2 font-semibold text-navy-700 hover:bg-navy-50">‹ ก่อนหน้า</Link>
          <h2 className="text-lg font-semibold">{THAI_MONTHS[m - 1]} {y + 543}</h2>
          <Link href={`${base}?tab=attendance&m=${next}`} className="rounded-xl px-3 py-2 font-semibold text-navy-700 hover:bg-navy-50">ถัดไป ›</Link>
        </div>
        <div className="grid grid-cols-7 gap-1.5 text-center text-sm">
          {["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"].map((d) => <div key={d} className="py-1 text-xs font-semibold text-muted">{d}</div>)}
          {Array.from({ length: firstDow }, (_, i) => <div key={`e${i}`} />)}
          {Array.from({ length: lastDay }, (_, i) => {
            const date = `${ym}-${String(i + 1).padStart(2, "0")}`;
            const st = byDate.get(date);
            const s = st !== undefined ? ATTENDANCE_STATUSES[st] : null;
            const off = holidayMap.get(date);
            return (
              <div key={date} title={off ?? s?.label ?? ""} className="flex h-11 flex-col items-center justify-center rounded-lg font-semibold"
                style={s ? { background: s.bg, color: s.fg } : { background: off ? "#F1F5F9" : "transparent", color: "#64748B" }}>
                {i + 1}
                {s && s.value !== 0 && <span className="text-[0.625rem] leading-none">{s.label}</span>}
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-xs">
          {ATTENDANCE_STATUSES.map((s) => <span key={s.value} className="flex items-center gap-1"><span className="size-3 rounded" style={{ background: s.bg, border: `1px solid ${s.border}` }} />{s.label}</span>)}
          <span className="flex items-center gap-1"><span className="size-3 rounded bg-slate-100" />วันหยุด</span>
        </div>
      </Card>
    </div>
  );
}

async function HistoryTab({ studentId, enrollments, canSeeHistory }: { studentId: string; enrollments: { year: number; number: number | null; repeated: boolean; classrooms: { grade: string; room: number } }[]; canSeeHistory: boolean }) {
  const sb = await supabaseServer();
  const { data: history } = canSeeHistory
    ? await sb.from("student_status_history").select("from_status, to_status, effective_date, reason, changed_at").eq("student_id", studentId).order("changed_at", { ascending: false })
    : { data: [] };
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Card>
        <SectionTitle>ห้องเรียนแต่ละปี</SectionTitle>
        <ul className="flex flex-col gap-2">
          {enrollments.map((e) => (
            <li key={e.year} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5">
              <span className="font-semibold">ปีการศึกษา {e.year}</span>
              <span>{classroomName(e.classrooms)} เลขที่ {e.number ?? "-"} {e.repeated && <Badge tone="amber">ซ้ำชั้น</Badge>}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <SectionTitle>ประวัติการเปลี่ยนสถานะ</SectionTitle>
        {(history ?? []).length === 0 ? <p className="text-muted">ยังไม่มีการเปลี่ยนสถานะ</p> : (
          <ul className="flex flex-col gap-2">
            {(history ?? []).map((h, i) => (
              <li key={i} className="rounded-xl bg-slate-50 px-3 py-2.5">
                <p className="font-semibold">{STUDENT_STATUSES[h.from_status ?? ""]?.label ?? "-"} → {STUDENT_STATUSES[h.to_status]?.label ?? h.to_status}</p>
                <p className="text-sm text-muted">มีผล {formatThaiDate(h.effective_date)} · {h.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function NChip({ map, v }: { map: Record<number, { short: string; tone: keyof typeof TONE_STYLE }>; v: number | null }) {
  if (!v) return <span className="text-slate-400">-</span>;
  const t = TONE_STYLE[map[v].tone];
  return <span className="whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: t.bg, color: t.fg }}>{map[v].short}</span>;
}

async function NutritionTab({ studentId }: { studentId: string }) {
  const sb = await supabaseServer();
  const { data } = await sb.from("measurements")
    .select("measured_on, weight, height, age_months, wfa, hfa, wfh, measurement_rounds(name, start_date)")
    .eq("student_id", studentId).order("measured_on", { ascending: false });
  const rows = (data ?? []) as unknown as { measured_on: string; weight: number | null; height: number | null; age_months: number | null; wfa: number | null; hfa: number | null; wfh: number | null; measurement_rounds: { name: string } }[];
  if (!rows.length) return <Card className="text-muted">ยังไม่มีข้อมูลน้ำหนัก/ส่วนสูง (หรือท่านไม่มีสิทธิ์ดูข้อมูลสุขภาพของนักเรียนคนนี้)</Card>;
  const latest = rows[0];
  const chart = [...rows].reverse().slice(-10);
  const max = Math.max(...chart.map((r) => r.weight ?? 0), 1);
  return (
    <div className="grid gap-3 md:grid-cols-[1fr_1.4fr]">
      <Card className="flex flex-col gap-3">
        <SectionTitle>ล่าสุด · {latest.measurement_rounds.name}</SectionTitle>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="น้ำหนัก (กก.)" value={latest.weight ?? "-"} tone="orange" />
          <Stat label="ส่วนสูง (ซม.)" value={latest.height ?? "-"} tone="blue" />
        </div>
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between"><dt className="text-muted">น้ำหนักตามส่วนสูง</dt><dd><NChip map={WFH} v={latest.wfh} /></dd></div>
          <div className="flex justify-between"><dt className="text-muted">น้ำหนักตามอายุ</dt><dd><NChip map={WFA} v={latest.wfa} /></dd></div>
          <div className="flex justify-between"><dt className="text-muted">ส่วนสูงตามอายุ</dt><dd><NChip map={HFA} v={latest.hfa} /></dd></div>
        </dl>
      </Card>
      <Card>
        <SectionTitle>น้ำหนักแต่ละรอบ (กก.)</SectionTitle>
        <div className="flex h-36 items-end gap-2" role="img" aria-label="กราฟน้ำหนักแต่ละรอบ">
          {chart.map((r) => (
            <div key={r.measured_on} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-[0.6875rem] text-slate-700">{r.weight ?? "-"}</span>
              <div className="w-full max-w-9 rounded-t-lg bg-orange-400" style={{ height: `${Math.max(6, ((r.weight ?? 0) / max) * 100)}px` }} />
              <span className="text-[0.6875rem] text-muted">{r.measurement_rounds.name.split(" ")[0]}</span>
            </div>
          ))}
        </div>
        <div className="table-wrap mt-3">
          <table className="data-table">
            <thead><tr><th>รอบ</th><th>วันที่</th><th>น้ำหนัก</th><th>ส่วนสูง</th><th>น้ำหนัก/ส่วนสูง</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.measured_on + r.measurement_rounds.name}><td>{r.measurement_rounds.name}</td><td>{formatThaiDate(r.measured_on)}</td><td>{r.weight ?? "-"}</td><td>{r.height ?? "-"}</td><td><NChip map={WFH} v={r.wfh} /></td></tr>
            ))}</tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
