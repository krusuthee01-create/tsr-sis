"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash } from "@phosphor-icons/react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Button, Card } from "@/components/ui";
import { useToast } from "@/components/toast";

export type Metric = { section: string; key: string; label: string; value: number | null; base: number; unit: string; target: number | null };
export type NationalRow = { id: number; year: number; test: string; subject: string; school_avg: number | null; province_avg: number | null; national_avg: number | null; students: number | null };

/** ตารางตัวชี้วัด SAR พร้อมแก้ไขค่าเป้าหมาย */
export function TargetsEditor({ year, sections, metrics, prev, editable }: { year: number; sections: string[]; metrics: Metric[]; prev: Record<string, number | null>; editable: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [t, setT] = useState<Record<string, string>>(() => Object.fromEntries(metrics.map((m) => [m.key, m.target?.toString() ?? ""])));
  const [busy, setBusy] = useState(false);
  const dirty = metrics.some((m) => (m.target?.toString() ?? "") !== t[m.key]);

  async function save() {
    const rows = metrics.filter((m) => t[m.key].trim() !== "").map((m) => ({ year, key: m.key, target: Number(t[m.key]) }));
    if (rows.some((r) => !Number.isFinite(r.target) || r.target < 0)) return toast("ค่าเป้าหมายต้องเป็นตัวเลข", "error");
    setBusy(true);
    const sb = supabaseBrowser();
    const cleared = metrics.filter((m) => m.target !== null && t[m.key].trim() === "").map((m) => m.key);
    const { error } = rows.length ? await sb.from("sar_targets").upsert(rows) : { error: null };
    if (!error && cleared.length) await sb.from("sar_targets").delete().eq("year", year).in("key", cleared);
    setBusy(false);
    if (error) return toast(error.message, "error");
    toast("บันทึกค่าเป้าหมายแล้ว");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {sections.map((s) => (
        <Card key={s} className="p-0 md:p-0">
          <p className="border-b border-line px-4 py-3 font-semibold">{s}</p>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>ตัวชี้วัด</th><th className="text-center">ผล</th><th className="text-center">เป้าหมาย</th><th className="text-center">ปีก่อน</th></tr></thead>
              <tbody>
                {metrics.filter((m) => m.section === s).map((m) => {
                  const target = t[m.key].trim() === "" ? null : Number(t[m.key]);
                  const met = m.value === null || target === null ? null : Number(m.value) >= target;
                  return (
                    <tr key={m.key}>
                      <td>{m.label}<span className="block text-xs text-muted">ฐาน {m.base.toLocaleString("th-TH")} {m.key.startsWith("grade") || m.key === "below1" || m.key === "gpa" ? "รายการ" : m.key === "attendance" ? "ครั้ง" : "คน"}</span></td>
                      <td className="whitespace-nowrap text-center">
                        <span className={`rounded-full px-2.5 py-1 font-bold ${met === null ? "" : met ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                          {m.value ?? "-"}{m.value !== null && m.unit === "%" ? "%" : ""}
                        </span>
                        {met !== null && <span className="ml-1 text-xs">{met ? "บรรลุ" : "ไม่บรรลุ"}</span>}
                      </td>
                      <td className="text-center">
                        {editable
                          ? <input aria-label={`ค่าเป้าหมาย ${m.label}`} inputMode="decimal" className="field-input mx-auto min-h-10 w-20 text-center" value={t[m.key]} onChange={(e) => setT({ ...t, [m.key]: e.target.value })} />
                          : (m.target ?? "-")}
                      </td>
                      <td className="text-center text-muted">{prev[m.key] ?? "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
      {editable && dirty && <div className="no-print"><Button onClick={save} disabled={busy}>{busy ? "กำลังบันทึก…" : "บันทึกค่าเป้าหมาย"}</Button></div>}
    </div>
  );
}

const SUBJECTS: Record<string, string[]> = {
  RT: ["การอ่านออกเสียง", "การอ่านรู้เรื่อง", "รวม 2 สมรรถนะ"],
  NT: ["ด้านภาษาไทย", "ด้านคณิตศาสตร์", "รวม 2 ด้าน"],
  "O-NET": ["ภาษาไทย", "คณิตศาสตร์", "วิทยาศาสตร์", "ภาษาอังกฤษ"],
};

/** ผลสอบระดับชาติ: กรอกค่าเฉลี่ยระดับโรงเรียน จังหวัด และประเทศ */
export function NationalTests({ year, rows, editable }: { year: number; rows: NationalRow[]; editable: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [test, setTest] = useState("O-NET");
  const cur = rows.filter((r) => r.year === year);
  const [f, setF] = useState<Record<string, Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const val = (subject: string, k: keyof NationalRow) => f[subject]?.[k] ?? cur.find((r) => r.test === test && r.subject === subject)?.[k]?.toString() ?? "";
  const set = (subject: string, k: string, v: string) => setF((x) => ({ ...x, [subject]: { ...x[subject], [k]: v } }));
  const n = (s: string) => (s.trim() === "" ? null : Number(s));

  async function save() {
    const list = SUBJECTS[test].map((subject) => ({ year, test, subject, school_avg: n(val(subject, "school_avg")), province_avg: n(val(subject, "province_avg")),
      national_avg: n(val(subject, "national_avg")), students: n(val(subject, "students")) })).filter((r) => r.school_avg !== null);
    if (list.some((r) => [r.school_avg, r.province_avg, r.national_avg].some((x) => x !== null && (!Number.isFinite(x) || x < 0 || x > 100))))
      return toast("คะแนนเฉลี่ยต้องเป็นตัวเลข 0–100", "error");
    setBusy(true);
    const { error } = await supabaseBrowser().from("national_tests").upsert(list, { onConflict: "year,test,subject" });
    setBusy(false);
    if (error) return toast(error.message, "error");
    setF({});
    toast(`บันทึกผล ${test} แล้ว`);
    router.refresh();
  }

  const prevOf = (t: string, s: string) => rows.find((r) => r.year === year - 1 && r.test === t && r.subject === s)?.school_avg;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2" role="tablist">
        {Object.keys(SUBJECTS).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={test === k} onClick={() => { setTest(k); setF({}); }}
            className={`min-h-10 rounded-xl px-4 text-sm font-bold ${test === k ? "bg-violet-700 text-white" : "bg-slate-100"}`}>{k}</button>
        ))}
      </div>
      <div className="table-wrap">
        <table className="data-table text-center">
          <thead><tr><th className="text-left">{test === "RT" ? "สมรรถนะ" : "วิชา/ด้าน"}</th><th>โรงเรียน</th><th>จังหวัด</th><th>ประเทศ</th><th>ผู้เข้าสอบ</th><th>ปีก่อน (โรงเรียน)</th></tr></thead>
          <tbody>
            {SUBJECTS[test].map((s) => (
              <tr key={s}>
                <td className="text-left font-semibold">{s}</td>
                {(["school_avg", "province_avg", "national_avg", "students"] as const).map((k) => (
                  <td key={k}>{editable
                    ? <input aria-label={`${test} ${s} ${k}`} inputMode="decimal" className="field-input mx-auto min-h-10 w-20 text-center" value={val(s, k)} onChange={(e) => set(s, k, e.target.value)} />
                    : val(s, k) || "-"}</td>
                ))}
                <td className="text-muted">{prevOf(test, s) ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={save} disabled={busy}>{busy ? "กำลังบันทึก…" : `บันทึกผล ${test} ปี ${year}`}</Button>
          {cur.some((r) => r.test === test) && (
            <button type="button" className="flex items-center gap-1 text-sm text-red-700" onClick={async () => {
              if (!confirm(`ลบผล ${test} ปี ${year} ทั้งหมด?`)) return;
              await supabaseBrowser().from("national_tests").delete().eq("year", year).eq("test", test);
              router.refresh();
            }}><Trash size={16} />ลบผล {test} ปีนี้</button>
          )}
        </div>
      )}
    </div>
  );
}
