"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { CheckCircle, WarningCircle, Info, X } from "@phosphor-icons/react";

type Tone = "success" | "error" | "info";
type Toast = { id: number; tone: Tone; text: string };

const ToastContext = createContext<(text: string, tone?: Tone) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

const STYLE: Record<Tone, string> = {
  success: "bg-green-50 text-green-900 border-green-300",
  error: "bg-red-50 text-red-900 border-red-300",
  info: "bg-sky-50 text-sky-900 border-sky-300",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Tone = "success") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 8000 : 4000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="no-print fixed inset-x-0 top-16 z-50 flex flex-col items-center gap-2 px-4 md:top-auto md:bottom-6" aria-live="polite">
        {toasts.map((t) => {
          const Icon = t.tone === "success" ? CheckCircle : t.tone === "error" ? WarningCircle : Info;
          return (
            <div key={t.id} role={t.tone === "error" ? "alert" : "status"}
              className={`flex w-full max-w-md items-start gap-3 rounded-2xl border px-4 py-3 shadow-lg ${STYLE[t.tone]}`}>
              <Icon size={22} weight="duotone" className="mt-0.5 shrink-0" />
              <span className="flex-1 text-[0.9375rem] font-medium">{t.text}</span>
              <button type="button" aria-label="ปิดข้อความ" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}
                className="-m-1 rounded-lg p-1 opacity-70 hover:opacity-100">
                <X size={18} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
