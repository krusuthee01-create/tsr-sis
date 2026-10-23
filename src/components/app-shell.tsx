"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  House, CheckSquare, Chalkboard, Student, DoorOpen, IdentificationBadge, ChartBar,
  ClockCounterClockwise, GearSix, BookOpen, List, X, SignOut, SidebarSimple, Sparkle, Scales,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { navFor, isActive, BOTTOM_NAV, type NavItem } from "./nav-items";
import { FontSizeControl } from "./font-size";
import { SyncBar } from "./sync-bar";
import { Tour } from "./tour";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Profile } from "@/lib/supabase/server";
import { ROLES } from "@/lib/domain";

const ICONS: Record<NavItem["icon"], Icon> = {
  home: House, check: CheckSquare, subject: Chalkboard, students: Student, rooms: DoorOpen,
  staff: IdentificationBadge, reports: ChartBar, audit: ClockCounterClockwise, settings: GearSix, manual: BookOpen, nutrition: Scales,
};

export function AppShell({ profile, schoolName, children }: { profile: Profile; schoolName: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const items = navFor(profile.roles);
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("tsr-sidebar") === "collapsed");
    } catch {}
  }, []);
  useEffect(() => setMenuOpen(false), [pathname]);

  function toggleSidebar() {
    setCollapsed((c) => {
      try { localStorage.setItem("tsr-sidebar", c ? "open" : "collapsed"); } catch {}
      return !c;
    });
  }

  const name = `${profile.prefix ?? ""}${profile.first_name} ${profile.last_name}`.trim();

  return (
    <div className="flex min-h-dvh">
      {/* เมนูด้านข้าง: iPad แนวนอนและคอมพิวเตอร์ */}
      <aside className={`no-print sticky top-0 hidden h-dvh shrink-0 flex-col gap-1 overflow-y-auto bg-navy-700 px-3 py-4 text-white lg:flex ${collapsed ? "w-[4.75rem]" : "w-64"}`}>
        <div className="mb-3 flex items-center gap-3 px-1.5">
          <Image src="/icons/logo.png" alt="ตราโรงเรียน" width={44} height={44} className="size-11 rounded-full bg-white p-0.5" priority />
          {!collapsed && (
            <div className="min-w-0 leading-tight">
              <p className="font-display font-semibold">TSR-SIS</p>
              <p className="truncate text-xs text-sky-200">{schoolName}</p>
            </div>
          )}
        </div>
        {items.map((item) => <SideLink key={item.href} item={item} active={isActive(pathname, item.href)} collapsed={collapsed} />)}
        <div className="mt-auto flex flex-col gap-2 pt-4">
          {!collapsed && <UserBox name={name} roles={profile.roles} />}
          <button type="button" onClick={toggleSidebar} className="flex min-h-11 items-center gap-3 rounded-xl px-3.5 text-sm text-sky-100 hover:bg-white/10"
            aria-label={collapsed ? "ขยายเมนู" : "ย่อเมนู"}>
            <SidebarSimple size={22} weight="duotone" />{!collapsed && "ย่อเมนู"}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-white/95 px-3 py-2 backdrop-blur md:px-5">
          <Link href="/" className="flex items-center gap-2 lg:hidden" aria-label="หน้าแรก">
            <Image src="/icons/logo.png" alt="" width={36} height={36} className="size-9 rounded-full" />
            <span className="font-display font-semibold text-navy-700">TSR-SIS</span>
          </Link>
          <div className="flex-1" />
          <SyncBar />
          <FontSizeControl initial={profile.font_scale} />
          <UserMenu name={name} />
        </header>

        <main className="flex-1 px-3 pb-28 pt-3 md:px-6 md:pt-5 lg:pb-10">{children}</main>
      </div>

      {/* แถบเมนูล่าง: มือถือ และ iPad แนวตั้ง */}
      <nav aria-label="เมนูหลัก" className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
        {BOTTOM_NAV.map((href) => {
          const item = items.find((i) => i.href === href);
          if (!item) return null;
          const Ico = ICONS[item.icon];
          const active = isActive(pathname, href);
          return (
            <Link key={href} href={href} aria-current={active ? "page" : undefined}
              className={`flex min-h-16 flex-col items-center justify-center gap-0.5 text-xs ${active ? "font-bold text-navy-700" : "text-muted"}`}>
              <Ico size={26} weight={active ? "duotone" : "regular"} />
              {item.label.split(" /")[0]}
            </Link>
          );
        })}
        <button type="button" onClick={() => setMenuOpen(true)} className="flex min-h-16 flex-col items-center justify-center gap-0.5 text-xs text-muted" aria-expanded={menuOpen}>
          <List size={26} />เมนู
        </button>
      </nav>

      {menuOpen && (
        <div className="no-print fixed inset-0 z-40 flex flex-col bg-navy-700 text-white lg:hidden" role="dialog" aria-modal="true" aria-label="เมนูทั้งหมด">
          <div className="flex items-center gap-3 px-4 py-3">
            <Image src="/icons/logo.png" alt="" width={40} height={40} className="size-10 rounded-full bg-white p-0.5" />
            <p className="flex-1 font-display text-lg font-semibold">เมนูทั้งหมด</p>
            <button type="button" onClick={() => setMenuOpen(false)} aria-label="ปิดเมนู" className="rounded-xl bg-white/15 p-2.5"><X size={24} /></button>
          </div>
          <div className="grid flex-1 auto-rows-min grid-cols-2 gap-3 overflow-y-auto px-4 pb-6 sm:grid-cols-3">
            {items.map((item) => {
              const Ico = ICONS[item.icon];
              return (
                <Link key={item.href} href={item.href} className="flex min-h-24 flex-col justify-between rounded-2xl bg-white/10 p-3.5 hover:bg-white/15">
                  <Ico size={30} weight="duotone" color={item.color} />
                  <span className="font-semibold leading-snug">{item.label}</span>
                </Link>
              );
            })}
          </div>
          <div className="px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"><UserBox name={name} roles={profile.roles} /></div>
        </div>
      )}

      {!profile.tour_done && <Tour />}
    </div>
  );
}

function SideLink({ item, active, collapsed }: { item: NavItem; active: boolean; collapsed: boolean }) {
  const Ico = ICONS[item.icon];
  return (
    <Link href={item.href} aria-current={active ? "page" : undefined} title={collapsed ? item.label : undefined}
      className={`flex min-h-11 items-center gap-3 rounded-xl px-3.5 text-[0.9375rem] font-semibold ${active ? "bg-white text-navy-700" : "text-sky-50 hover:bg-white/10"}`}>
      <Ico size={22} weight="duotone" color={active ? undefined : item.color} className="shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );
}

function UserBox({ name, roles }: { name: string; roles: string[] }) {
  return (
    <div className="rounded-2xl bg-white/10 px-3 py-2.5 text-sm">
      <p className="truncate font-semibold">{name}</p>
      <p className="truncate text-xs text-sky-200">{roles.length ? roles.map((r) => ROLES[r]?.split(" /")[0]).join(" · ") : "ครู"}</p>
    </div>
  );
}

function UserMenu({ name }: { name: string }) {
  const router = useRouter();
  const ref = useRef<HTMLDetailsElement>(null);

  async function logout() {
    await supabaseBrowser().auth.signOut();
    router.replace("/login");
    router.refresh();
  }
  async function replayTour() {
    await supabaseBrowser().rpc("update_my_prefs", { p_tour_done: false });
    ref.current?.removeAttribute("open");
    router.refresh();
  }

  return (
    <details ref={ref} className="relative">
      <summary className="flex size-11 cursor-pointer list-none items-center justify-center rounded-xl bg-navy-700 font-display font-semibold text-white [&::-webkit-details-marker]:hidden" aria-label="เมนูของฉัน">
        {name.replace(/^(นาย|นางสาว|นาง|ครู)/, "").slice(0, 1)}
      </summary>
      <div className="absolute right-0 top-13 z-40 w-64 rounded-2xl border border-line bg-white p-2 shadow-xl">
        <p className="truncate px-3 py-2 text-sm font-semibold">{name}</p>
        <button type="button" onClick={replayTour} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-slate-50">
          <Sparkle size={20} weight="duotone" /> ดูทัวร์อีกครั้ง
        </button>
        <Link href="/manual" className="flex min-h-11 items-center gap-3 rounded-xl px-3 hover:bg-slate-50"><BookOpen size={20} weight="duotone" /> คู่มือการใช้งาน</Link>
        <button type="button" onClick={logout} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-red-700 hover:bg-red-50">
          <SignOut size={20} weight="duotone" /> ออกจากระบบ
        </button>
      </div>
    </details>
  );
}
