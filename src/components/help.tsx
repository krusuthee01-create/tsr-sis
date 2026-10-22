"use client";

import Link from "next/link";
import { useRef } from "react";
import { Question, X, BookOpen } from "@phosphor-icons/react";
import { helpFor, type HelpTopic } from "@/lib/help";

export function HelpTopicBody({ topic }: { topic: HelpTopic }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[0.9375rem] text-muted">{topic.summary}</p>
      <p className="text-sm"><span className="font-semibold">ใช้โดย:</span> {topic.who}</p>
      <ol className="flex flex-col gap-2.5">
        {topic.steps.map((s, i) => (
          <li key={i} className="flex gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sm font-bold text-sky-900">{i + 1}</span>
            <span className="pt-0.5">{s}</span>
          </li>
        ))}
      </ol>
      {topic.tips && topic.tips.length > 0 && (
        <div className="rounded-2xl bg-amber-50 p-4 text-amber-950">
          <p className="mb-2 font-semibold">ข้อแนะนำ</p>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[0.9375rem]">
            {topic.tips.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

/** ปุ่ม "?" มุมบนของทุกหน้า เปิดคำอธิบายของหน้านั้น */
export function HelpButton({ topic, tone = "light" }: { topic: string; tone?: "light" | "dark" }) {
  const ref = useRef<HTMLDialogElement>(null);
  const t = helpFor(topic);
  if (!t) return null;
  return (
    <>
      <button type="button" aria-label={`วิธีใช้: ${t.title}`} onClick={() => ref.current?.showModal()}
        className={`no-print flex size-11 shrink-0 items-center justify-center rounded-xl text-lg font-bold ${tone === "dark" ? "bg-lotus text-white hover:bg-lotus-600" : "bg-white/90 text-navy-700 hover:bg-white"}`}>
        <Question size={24} weight="bold" />
      </button>
      <dialog ref={ref} className="m-auto w-[min(36rem,calc(100vw-2rem))] rounded-3xl p-0 shadow-2xl backdrop:bg-slate-900/40"
        onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}>
        <div className="flex max-h-[85dvh] flex-col">
          <div className="flex items-center gap-3 border-b border-line px-5 py-4">
            <span className="flex size-10 items-center justify-center rounded-xl bg-lotus/15 text-lotus-600"><Question size={24} weight="duotone" /></span>
            <h2 className="flex-1 text-lg font-semibold">วิธีใช้: {t.title}</h2>
            <button type="button" aria-label="ปิด" onClick={() => ref.current?.close()} className="rounded-lg p-2 hover:bg-slate-100"><X size={20} /></button>
          </div>
          <div className="overflow-y-auto px-5 py-4"><HelpTopicBody topic={t} /></div>
          <div className="border-t border-line px-5 py-3">
            <Link href={`/manual#${t.key}`} onClick={() => ref.current?.close()} className="inline-flex items-center gap-2 font-semibold text-navy-700 hover:underline">
              <BookOpen size={20} weight="duotone" /> เปิดคู่มือทั้งหมด
            </Link>
          </div>
        </div>
      </dialog>
    </>
  );
}
