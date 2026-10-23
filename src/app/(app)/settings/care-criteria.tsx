"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { EQ_DOMAINS, INFORMANTS, SDQ_SCALES } from "@/lib/care";
import { Button, SectionTitle } from "@/components/ui";
import { useToast } from "@/components/toast";

type Cut = Record<string, Record<string, number[]>>;
const RULES = [
  { key: "attendance_risk", label: "มาเรียนต่ำกว่า (%) = เสี่ยง" },
  { key: "attendance_problem", label: "มาเรียนต่ำกว่า (%) = มีปัญหา" },
  { key: "income_per_person_risk", label: "รายได้ต่อคนต่ำกว่า (บาท/เดือน) = เสี่ยง" },
  { key: "income_per_person_problem", label: "รายได้ต่อคนต่ำกว่า (บาท/เดือน) = มีปัญหา" },
  { key: "followup_days", label: "แจ้งเตือนเมื่อไม่มีบันทึกช่วยเหลือเกิน (วัน)" },
];

function NumBox({ value, onChange, label }: { value: number | undefined; onChange: (n: number | undefined) => void; label: string }) {
  return (
    <input aria-label={label} inputMode="numeric" className="field-input min-h-10 w-20 text-center" value={value ?? ""}
      onChange={(e) => { const t = e.target.value.trim(); onChange(t === "" ? undefined : Number(t)); }} />
  );
}

/** เกณฑ์แปลผล SDQ / EQ / การคัดกรอง — บันทึกแล้วระบบแปลผลเดิมใหม่ทั้งหมด */
export function CareCriteria({ sdq, eq, rules }: { sdq: Cut; eq: Cut; rules: Record<string, number> }) {
  const router = useRouter();
  const toast = useToast();
  const [s, setS] = useState<Cut>(sdq);
  const [e, setE] = useState<Cut>(eq);
  const [r, setR] = useState<Record<string, number>>(rules);
  const [busy, setBusy] = useState(false);

  const setCut = (inf: string, key: string, i: number, n: number | undefined) =>
    setS((x) => { const arr = [...(x[inf]?.[key] ?? [])]; arr[i] = n as number; return { ...x, [inf]: { ...x[inf], [key]: arr } }; });
  const setRange = (ver: string, key: string, i: number, n: number | undefined) =>
    setE((x) => { const arr = [...(x[ver]?.[key] ?? [])]; arr[i] = n as number; return { ...x, [ver]: { ...x[ver], [key]: arr } }; });

  async function save() {
    // ตรวจรูปแบบก่อนบันทึก
    for (const [inf, scales] of Object.entries(s)) for (const [k, v] of Object.entries(scales)) {
      const need = k === "prosocial" ? 1 : 2;
      if (v.slice(0, need).some((n) => n === undefined || n === null || !Number.isFinite(n)) || (need === 2 && v[0] >= v[1]))
        return toast(`SDQ ${INFORMANTS[inf]}: ค่าของ "${k}" ไม่ถูกต้อง (ช่องแรกต้องน้อยกว่าช่องที่สอง)`, "error");
    }
    const eqClean: Cut = {};
    for (const [ver, doms] of Object.entries(e)) for (const [k, v] of Object.entries(doms)) {
      const filled = v.filter((n) => n !== undefined && n !== null && Number.isFinite(n));
      if (filled.length === 0) continue;
      if (filled.length !== 2 || v[0] > v[1]) return toast(`EQ ฉบับ ${ver} ปี ด้าน${EQ_DOMAINS.find((d) => d.key === k)?.label}: ใส่ต่ำสุดและสูงสุดให้ครบ`, "error");
      eqClean[ver] = { ...eqClean[ver], [k]: [v[0], v[1]] };
    }
    if (RULES.some((x) => !Number.isFinite(r[x.key]) || r[x.key] < 0)) return toast("กรุณากรอกเกณฑ์การคัดกรองให้ครบ", "error");
    setBusy(true);
    const clean = Object.fromEntries(Object.entries(s).map(([inf, sc]) => [inf, Object.fromEntries(Object.entries(sc).map(([k, v]) => [k, v.slice(0, k === "prosocial" ? 1 : 2)]))]));
    const { data, error } = await supabaseBrowser().rpc("save_care_settings", { p_sdq: clean, p_eq: eqClean, p_rules: r });
    setBusy(false);
    if (error) return toast(error.message, "error");
    toast(`บันทึกเกณฑ์แล้ว · แปลผลใหม่ SDQ ${data?.sdq ?? 0} รายการ EQ ${data?.eq ?? 0} รายการ`);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-5">
      <section>
        <SectionTitle>เกณฑ์แปลผล SDQ</SectionTitle>
        <p className="mb-2 text-sm text-muted">คะแนน ≤ ช่องแรก = ปกติ, ≤ ช่องที่สอง = เสี่ยง, มากกว่านั้น = มีปัญหา · ด้านสัมพันธภาพทางสังคม: คะแนน ≤ ค่าที่กำหนด = ไม่มีจุดแข็ง ค่าเริ่มต้นตามคู่มือกรมสุขภาพจิต ปรับได้ตามที่โรงเรียนใช้</p>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>ด้าน</th>{Object.keys(INFORMANTS).map((k) => <th key={k}>{INFORMANTS[k]}<br /><span className="font-normal">ปกติ ≤ / เสี่ยง ≤</span></th>)}</tr></thead>
            <tbody>
              {[{ key: "total", label: "รวมปัญหา" }, ...SDQ_SCALES].map((sc) => (
                <tr key={sc.key}>
                  <td className="font-semibold">{sc.label}</td>
                  {Object.keys(INFORMANTS).map((inf) => (
                    <td key={inf}>
                      <div className="flex gap-1">
                        <NumBox label={`${INFORMANTS[inf]} ${sc.label} ช่อง 1`} value={s[inf]?.[sc.key]?.[0]} onChange={(n) => setCut(inf, sc.key, 0, n)} />
                        {sc.key !== "prosocial" && <NumBox label={`${INFORMANTS[inf]} ${sc.label} ช่อง 2`} value={s[inf]?.[sc.key]?.[1]} onChange={(n) => setCut(inf, sc.key, 1, n)} />}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <SectionTitle>ช่วงคะแนนปกติ EQ</SectionTitle>
        <p className="mb-2 text-sm text-muted">ใส่ช่วงคะแนนปกติ (ต่ำสุด–สูงสุด) ตามคู่มือแบบประเมิน EQ ที่โรงเรียนใช้ ต่ำกว่าช่วง = ต่ำกว่าปกติ สูงกว่าช่วง = สูงกว่าปกติ เว้นว่างได้ถ้ายังไม่ใช้</p>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>ด้าน</th><th>ฉบับ 3–5 ปี (ต่ำสุด–สูงสุด)</th><th>ฉบับ 6–11 ปี (ต่ำสุด–สูงสุด)</th></tr></thead>
            <tbody>
              {EQ_DOMAINS.map((d) => (
                <tr key={d.key}>
                  <td className="font-semibold">{d.label}</td>
                  {["3-5", "6-11"].map((ver) => (
                    <td key={ver}>
                      <div className="flex items-center gap-1">
                        <NumBox label={`EQ ${ver} ${d.label} ต่ำสุด`} value={e[ver]?.[d.key]?.[0]} onChange={(n) => setRange(ver, d.key, 0, n)} />–
                        <NumBox label={`EQ ${ver} ${d.label} สูงสุด`} value={e[ver]?.[d.key]?.[1]} onChange={(n) => setRange(ver, d.key, 1, n)} />
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <SectionTitle>เกณฑ์ที่ระบบใช้เสนอผลคัดกรอง</SectionTitle>
        <div className="grid gap-2 sm:grid-cols-2">
          {RULES.map((x) => (
            <label key={x.key} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-2.5 text-sm font-semibold">{x.label}
              <NumBox label={x.label} value={r[x.key]} onChange={(n) => setR({ ...r, [x.key]: n as number })} />
            </label>
          ))}
        </div>
      </section>

      <div><Button onClick={save} disabled={busy}>{busy ? "กำลังบันทึก…" : "บันทึกเกณฑ์และแปลผลใหม่"}</Button></div>
    </div>
  );
}
