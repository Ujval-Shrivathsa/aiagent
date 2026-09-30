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
        className="mb-8 lg:mb-12 flex items-center gap-3 group"
      >
        <div className="w-8 h-8 rounded-lg bg-neutral-900 flex items-center justify-center font-semibold text-white text-base">
          P
        </div>
        <span className="text-xl font-semibold tracking-tight text-neutral-900">
          Priya
        </span>
      </Link>

      <nav className="flex-1 space-y-1">
        {NAV.map((item) => {
          const active = isActive(item.href, item.exact);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors text-sm font-medium min-h-[44px] ${
                active
                  ? "bg-neutral-100 text-neutral-900"
                  : "text-neutral-500 hover:text-neutral-900 hover:bg-neutral-50"
              }`}
            >
              <item.icon size={17} strokeWidth={1.75} />
              {item.label}
              {item.href === "/dashboard" && interestedCount > 0 && (
                <span className="ml-auto text-xs font-medium text-neutral-400 tabular-nums">
                  {interestedCount}
                </span>
              )}
              {item.href === "/dashboard/recordings" && callingCount > 0 && (
                <span className="ml-auto text-xs font-medium text-neutral-900 tabular-nums">
                  {callingCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto pt-6 border-t border-neutral-100">
        <div className="px-1 text-xs text-neutral-400">
          <div className="flex items-center gap-2 mb-1">
            <PhoneCall size={13} strokeWidth={1.75} />
            <span className="font-medium uppercase tracking-wider text-[10px] text-neutral-500">
              Voice Agent
            </span>
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
      <header className="lg:hidden fixed top-0 inset-x-0 z-40 h-14 bg-white/95 backdrop-blur border-b border-neutral-200 flex items-center px-4 gap-3">
        <button
          type="button"
          aria-label="Open menu"
          onClick={() => setOpen(true)}
          className="p-2.5 -ml-1 rounded-lg hover:bg-neutral-100 text-neutral-700"
        >
          <Menu size={22} strokeWidth={1.75} />
        </button>
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-neutral-900 flex items-center justify-center font-semibold text-white text-sm">
            P
          </div>
          <span className="text-lg font-semibold tracking-tight text-neutral-900">
            Priya
          </span>
        </Link>
      </header>

      {/* Mobile drawer overlay */}
      {open && (
        <button
          type="button"
          aria-label="Close menu"
          className="lg:hidden fixed inset-0 z-40 bg-neutral-900/40"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={`lg:hidden fixed top-0 left-0 z-50 h-full w-[min(18rem,85vw)] bg-white border-r border-neutral-200 p-6 flex flex-col transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
          className="absolute top-5 right-4 p-2 rounded-lg hover:bg-neutral-100 text-neutral-500"
        >
          <X size={20} strokeWidth={1.75} />
        </button>
        <SidebarNav
          interestedCount={interestedCount}
          callingCount={callingCount}
          onNavigate={() => setOpen(false)}
        />
      </aside>

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-64 bg-white border-r border-neutral-200 p-6 flex-col fixed h-full z-20">
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
    <span
      className={`inline-flex items-center gap-1.5 rounded-full text-xs font-medium whitespace-nowrap ${cls}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />
      {label || normalized}
    </span>
  );
}
