"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Mic,
  PhoneCall,
  Menu,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { STATUS_BADGE_STYLES, normalizeLeadStatus } from "@/lib/lead-status";

const NAV = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Overview", exact: true },
  { href: "/dashboard/recordings", icon: Mic, label: "Recordings" },
];

function SidebarNav({
  interestedCount,
  callingCount,
  onNavigate,
}: {
  interestedCount: number;
  callingCount: number;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  return (
    <>
      <Link
        href="/dashboard"
        onClick={onNavigate}
        className="mb-8 lg:mb-10 flex items-center gap-3 group"
      >
        <div className="w-10 h-10 gold-gradient rounded-xl flex items-center justify-center font-bold text-white text-xl shadow-lg group-hover:scale-105 transition-transform">
          P
        </div>
        <span className="text-2xl font-serif font-bold tracking-tight dark:text-white">
          Priya<span className="text-gold">.</span>
        </span>
      </Link>

      <nav className="flex-1 space-y-1.5">
        {NAV.map((item) => {
          const active = isActive(item.href, item.exact);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all text-sm font-semibold min-h-[48px] ${
                active
                  ? "bg-stone-100 dark:bg-stone-800 text-gold shadow-sm"
                  : "text-stone-500 hover:text-stone-900 dark:hover:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-800/50"
              }`}
            >
              <item.icon size={18} />
              {item.label}
              {item.href === "/dashboard" && interestedCount > 0 && (
                <span className="ml-auto bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 text-[10px] font-black px-2 py-0.5 rounded-full">
                  {interestedCount}
                </span>
              )}
              {item.href === "/dashboard/recordings" && callingCount > 0 && (
                <span className="ml-auto bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400 text-[10px] font-black px-2 py-0.5 rounded-full animate-pulse">
                  live
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto pt-6 border-t border-stone-100 dark:border-stone-800 space-y-3">
        <div className="px-4 py-3 rounded-2xl bg-stone-50 dark:bg-stone-800/50 text-xs text-stone-500">
          <div className="flex items-center gap-2 mb-1">
            <PhoneCall size={14} className="text-gold" />
            <span className="font-bold uppercase tracking-wider text-[10px]">Voice Agent</span>
          </div>
          Plivo · Gemini Live
        </div>
      </div>
    </>
  );
}

export function DashboardSidebar({
  interestedCount = 0,
  callingCount = 0,
}: {
  interestedCount?: number;
  callingCount?: number;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      {/* Mobile top bar */}
      <header className="lg:hidden fixed top-0 inset-x-0 z-40 h-14 bg-white/95 dark:bg-stone-900/95 backdrop-blur border-b border-stone-200 dark:border-stone-800 flex items-center px-4 gap-3">
        <button
          type="button"
          aria-label="Open menu"
          onClick={() => setOpen(true)}
          className="p-2.5 -ml-1 rounded-xl hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-700 dark:text-stone-200"
        >
          <Menu size={22} />
        </button>
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="w-8 h-8 gold-gradient rounded-lg flex items-center justify-center font-bold text-white text-sm">
            P
          </div>
          <span className="text-lg font-serif font-bold dark:text-white">
            Priya<span className="text-gold">.</span>
          </span>
        </Link>
      </header>

      {/* Mobile drawer overlay */}
      {open && (
        <button
          type="button"
          aria-label="Close menu"
          className="lg:hidden fixed inset-0 z-40 bg-stone-900/50 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={`lg:hidden fixed top-0 left-0 z-50 h-full w-[min(18rem,85vw)] bg-white dark:bg-stone-900 border-r border-stone-200 dark:border-stone-800 p-5 flex flex-col transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
          className="absolute top-4 right-4 p-2 rounded-xl hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-500"
        >
          <X size={20} />
        </button>
        <SidebarNav
          interestedCount={interestedCount}
          callingCount={callingCount}
          onNavigate={() => setOpen(false)}
        />
      </aside>

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-64 bg-white dark:bg-stone-900 border-r border-stone-200 dark:border-stone-800 p-6 flex-col fixed h-full z-20">
        <SidebarNav interestedCount={interestedCount} callingCount={callingCount} />
      </aside>
    </>
  );
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const s = (status || "pending").toLowerCase();
  const normalized = s === "unknown" ? "unknown" : normalizeLeadStatus(s);
  const cls = STATUS_BADGE_STYLES[s] || STATUS_BADGE_STYLES[normalized] || STATUS_BADGE_STYLES.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold tracking-tight whitespace-nowrap ${cls}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70 shrink-0" />
      {label || normalized}
    </span>
  );
}
