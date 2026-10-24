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
import { DOMAINS, EQ_DOMAINS, EQ_LEVELS, INFORMANTS, INTERVENTION_DOMAINS, LEVELS, SDQ_SCALES } from "@/lib/care";
import { ExtraForm, AdminActions } from "./student-actions";
import { InterventionForm, InterventionStatus } from "./intervention-form";
import { ASSESSMENT_LABELS, gpa, TERM_LABEL, type AssessmentKind } from "@/lib/pp5-grades";
import { KG_DOMAINS, KG_LEVELS } from "@/lib/kg-dev";

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
  const tab = sp.tab === "attendance" || sp.tab === "history" || sp.tab === "nutrition" || sp.tab === "care" || sp.tab === "grades" ? sp.tab : "info";

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
          { id: "grades", label: "ผลการเรียน", href: `${base}?tab=grades` },
          { id: "nutrition", label: "โภชนาการ", href: `${base}?tab=nutrition` },
          ...(s ? [{ id: "care", label: "ดูแลช่วยเหลือ", href: `${base}?tab=care` }] : []),
          { id: "history", label: "ห้องเรียนและสถานะ", href: `${base}?tab=history` },
        ]} />
      </div>

      {tab === "info" && (s ? <InfoTab s={s} canEditExtra={canEditExtra} /> : (
        <Card className="text-muted">ท่านเห็นได้เฉพาะชื่อและการมาเรียนของนักเรียนคนนี้ ข้อมูลส่วนตัวและผู้ปกครองเปิดให้เฉพาะครูที่ปรึกษา ผู้บริหาร และงานแนะแนว (ตาม PDPA)</Card>
      ))}
      {tab === "attendance" && <AttendanceTab studentId={id} month={sp.m} base={base} />}
      {tab === "nutrition" && <NutritionTab studentId={id} />}
      {tab === "grades" && <GradesTab studentId={id} />}
      {tab === "care" && s && current && <CareTab studentId={id} classroomId={current.classroom_id} year={settings?.current_year ?? current.year}
        canEdit={can(profile, "admin") || can(profile, "guidance") || !!profile?.homerooms.some((h) => h.classroom_id === current.classroom_id && h.kind === "homeroom")} />}
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

function LevelChip({ v }: { v: number | null | undefined }) {
  if (!v) return <span className="text-muted">-</span>;
  return <span className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: LEVELS[v].bg, color: LEVELS[v].fg }}>{LEVELS[v].label}</span>;
}

async function CareTab({ studentId, classroomId, year, canEdit }: { studentId: string; classroomId: number; year: number; canEdit: boolean }) {
  const sb = await supabaseServer();
  const [{ data: sc }, { data: sdq }, { data: eq }, { data: visits }, { data: ivs }] = await Promise.all([
    sb.from("screenings").select("learning, health, economic, safety, behavior, overall, talent, notes, confirmed_at").eq("student_id", studentId).eq("year", year).maybeSingle(),
    sb.from("sdq_results").select("term, informant, emotional, conduct, hyperactivity, peer, prosocial, total, levels, level, recorded_at").eq("student_id", studentId).eq("year", year).order("term", { ascending: false }),
    sb.from("eq_results").select("term, version, good, smart, happy, levels").eq("student_id", studentId).eq("year", year).order("term", { ascending: false }),
    sb.from("home_visits").select("id, visit_date, monthly_income, household_size, safety_risk, data").eq("student_id", studentId).order("visit_date", { ascending: false }),
    sb.from("interventions").select("id, action_date, domain, activity, responsible, result, status").eq("student_id", studentId).order("action_date", { ascending: false }),
  ]);
  const screening = sc as (Record<string, number> & { talent: string | null; notes: Record<string, string>; confirmed_at: string }) | null;
  const sdqRows = (sdq ?? []) as unknown as ({ term: number; informant: string; total: number; level: number | null; levels: Record<string, number | null>; recorded_at: string } & Record<string, number>)[];
  const eqRows = (eq ?? []) as unknown as { term: number; version: string; good: number; smart: number; happy: number; levels: Record<string, number | null> }[];
  const visitRows = (visits ?? []) as unknown as { id: string; visit_date: string; monthly_income: number | null; household_size: number | null; safety_risk: boolean; data: { teacher_summary?: string; needs?: string[] } }[];
  const ivRows = (ivs ?? []) as { id: string; action_date: string; domain: string; activity: string; responsible: string | null; result: string | null; status: string }[];
  const worst = screening ? DOMAINS.filter((d) => screening[d.key] >= 2).sort((a, b) => screening[b.key] - screening[a.key])[0]?.key : undefined;

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Card>
        <SectionTitle action={screening ? <LevelChip v={screening.overall} /> : undefined}>ผลคัดกรองปี {year}</SectionTitle>
        {screening ? (
          <dl className="flex flex-col gap-2 text-sm">
            {DOMAINS.map((d) => (
              <div key={d.key} className="flex items-start justify-between gap-3">
                <dt className="text-muted">{d.label}{screening.notes?.[d.key] && <span className="block text-xs">เหตุผล: {screening.notes[d.key]}</span>}</dt>
                <dd><LevelChip v={screening[d.key]} /></dd>
              </div>
            ))}
            {screening.talent && <div className="flex justify-between gap-3"><dt className="text-muted">ความสามารถพิเศษ</dt><dd className="font-semibold">{screening.talent}</dd></div>}
            <p className="text-xs text-muted">ยืนยัน {formatThaiDateTime(screening.confirmed_at)}</p>
          </dl>
        ) : <p className="text-muted">ยังไม่ได้ยืนยันผลคัดกรอง (ทำที่เมนูดูแลช่วยเหลือ › คัดกรอง)</p>}
      </Card>

      <Card>
        <SectionTitle>SDQ / EQ</SectionTitle>
        {!sdqRows.length && !eqRows.length && <p className="text-muted">ยังไม่มีผลประเมิน</p>}
        <ul className="flex flex-col gap-2 text-sm">
          {sdqRows.map((r) => (
            <li key={`${r.term}${r.informant}`} className="rounded-xl bg-slate-50 p-2.5">
              <div className="mb-1 flex items-center justify-between gap-2"><span className="font-semibold">SDQ {INFORMANTS[r.informant]} · ภาค {r.term}</span><LevelChip v={r.level} /></div>
              <p className="text-xs text-muted">รวมปัญหา {r.total} · {SDQ_SCALES.map((x) => `${x.label.replace("ด้าน", "")} ${r[x.key]}${r.levels?.[x.key] && r.levels[x.key]! >= 2 && x.key !== "prosocial" ? ` (${LEVELS[r.levels[x.key]!].label})` : ""}`).join(" · ")}</p>
            </li>
          ))}
          {eqRows.map((r) => (
            <li key={`eq${r.term}`} className="rounded-xl bg-slate-50 p-2.5">
              <span className="font-semibold">EQ ฉบับ {r.version} ปี · ภาค {r.term}</span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {EQ_DOMAINS.map((d) => {
                  const lv = r.levels?.[d.key];
                  return <span key={d.key} className="rounded-full px-2.5 py-1 text-xs font-semibold" style={lv != null ? { background: EQ_LEVELS[lv].bg, color: EQ_LEVELS[lv].fg } : { background: "#F1F5F9" }}>{d.label} {r[d.key]}{lv != null ? ` · ${EQ_LEVELS[lv].label}` : ""}</span>;
                })}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="md:col-span-2">
        <SectionTitle action={canEdit ? <Link href={`/care/visit/${studentId}`} className="text-sm font-semibold text-pink-700">บันทึกเยี่ยมบ้าน ›</Link> : undefined}>การเยี่ยมบ้าน</SectionTitle>
        {visitRows.length ? (
          <ul className="flex flex-col gap-2 text-sm">
            {visitRows.map((v) => (
              <li key={v.id} className="rounded-xl bg-slate-50 p-2.5">
                <span className="font-semibold">{formatThaiDate(v.visit_date, "long")}</span>
                {v.safety_risk && <Badge tone="red" className="ml-2">พบความเสี่ยง</Badge>}
                {v.monthly_income != null && v.household_size ? <span className="ml-2 text-muted">รายได้ {Math.round(v.monthly_income / v.household_size).toLocaleString("th-TH")} บาท/คน/เดือน</span> : null}
                {v.data?.needs?.length ? <p className="text-muted">ต้องการ: {v.data.needs.join(", ")}</p> : null}
                {v.data?.teacher_summary && <p className="mt-1">{v.data.teacher_summary}</p>}
              </li>
            ))}
          </ul>
        ) : <p className="text-muted">ยังไม่ได้เยี่ยมบ้าน</p>}
      </Card>

      <Card className="md:col-span-2">
        <SectionTitle>การช่วยเหลือและส่งต่อ</SectionTitle>
        {canEdit && <div className="mb-3"><InterventionForm studentId={studentId} classroomId={classroomId} year={year} defaultDomain={worst} /></div>}
        {ivRows.length ? (
          <ul className="flex flex-col gap-2">
            {ivRows.map((i) => (
              <li key={i.id} className="flex flex-col gap-1 rounded-xl border border-line p-3 text-sm sm:flex-row sm:items-start sm:gap-3">
                <div className="flex-1">
                  <p className="text-xs text-muted">{formatThaiDate(i.action_date)} · {INTERVENTION_DOMAINS[i.domain] ?? i.domain}{i.responsible ? ` · ${i.responsible}` : ""}</p>
                  <p className="font-semibold">{i.activity}</p>
                  {i.result && <p className="text-muted">ผล: {i.result}</p>}
                </div>
                <InterventionStatus id={i.id} status={i.status} canEdit={canEdit} />
              </li>
            ))}
          </ul>
        ) : <p className="text-muted">ยังไม่มีบันทึกการช่วยเหลือ</p>}
      </Card>
    </div>
  );
}

async function GradesTab({ studentId }: { studentId: string }) {
  const sb = await supabaseServer();
  const [{ data: g }, { data: a }, { data: k }] = await Promise.all([
    sb.from("grade_results").select("year, term, grade, total, subjects(code, name, hours_per_year)").eq("student_id", studentId),
    sb.from("student_assessments").select("year, term, kind, result").eq("student_id", studentId),
    sb.from("kg_development").select("year, term, levels").eq("student_id", studentId),
  ]);
  const dev = (k ?? []) as { year: number; term: number; levels: Record<string, number | null> }[];
  const rows = (g ?? []) as unknown as { year: number; term: number; grade: string; total: number | null; subjects: { code: string; name: string; hours_per_year: number | null } }[];
  const assess = (a ?? []) as { year: number; term: number; kind: AssessmentKind; result: string | null }[];
  if (!rows.length && !assess.length && !dev.length) return <Card className="text-muted">ยังไม่มีผลการเรียน (นำเข้าจาก ปพ.5 ที่เมนูผลการเรียน) หรือท่านไม่มีสิทธิ์ดูผลการเรียนของนักเรียนคนนี้</Card>;
  const order = (t: number) => (t === 0 ? 3 : t);
  const periods = [...new Set([...rows, ...assess, ...dev].map((r) => `${r.year}-${r.term}`))]
    .map((k) => k.split("-").map(Number) as [number, number])
    .sort((x, y) => y[0] - x[0] || order(y[1]) - order(x[1]));
  return (
    <div className="flex flex-col gap-3">
      {periods.map(([year, term]) => {
        const list = rows.filter((r) => r.year === year && r.term === term).sort((x, y) => x.subjects.code.localeCompare(y.subjects.code, "th"));
        const value = gpa(list.map((r) => ({ grade: r.grade, hours: r.subjects.hours_per_year })));
        const as = assess.filter((r) => r.year === year && r.term === term);
        const d = dev.find((r) => r.year === year && r.term === term);
        return (
          <Card key={`${year}-${term}`}>
            <SectionTitle action={value !== null ? <span className="rounded-full bg-violet-100 px-3 py-1 font-bold text-violet-800">GPA {value.toFixed(2)}</span> : undefined}>
              {TERM_LABEL[term]} ปีการศึกษา {year}
            </SectionTitle>
            {list.length > 0 && (
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>รหัส</th><th>รายวิชา</th><th className="text-center">ชั่วโมง</th><th className="text-center">คะแนน</th><th className="text-center">เกรด</th></tr></thead>
                  <tbody>{list.map((r) => (
                    <tr key={r.subjects.code}>
                      <td>{r.subjects.code}</td><td>{r.subjects.name}</td><td className="text-center">{r.subjects.hours_per_year ?? "-"}</td>
                      <td className="text-center">{r.total ?? "-"}</td>
                      <td className={`text-center font-bold ${["0", "ร", "มส"].includes(r.grade) ? "text-red-700" : ""}`}>{r.grade}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            {d && (
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                {KG_DOMAINS.map((x) => {
                  const v = d.levels[x.key];
                  return (
                    <div key={x.key} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2">
                      <dt className="text-muted">พัฒนาการ{x.label}</dt>
                      <dd>{v ? <span className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: KG_LEVELS[v].bg, color: KG_LEVELS[v].fg }}>{KG_LEVELS[v].label}</span> : "-"}</dd>
                    </div>
                  );
                })}
              </dl>
            )}
            {as.length > 0 && (
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                {as.map((x) => (
                  <div key={x.kind} className="flex justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2">
                    <dt className="text-muted">{ASSESSMENT_LABELS[x.kind]}</dt>
                    <dd className={`font-bold ${x.result === "ไม่ผ่าน" ? "text-red-700" : ""}`}>{x.result ?? "-"}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Card>
        );
      })}
    </div>
  );
}
