"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Mic,
  LogOut,
  PhoneCall,
} from "lucide-react";

const NAV = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Overview", exact: true },
  { href: "/dashboard/recordings", icon: Mic, label: "Recordings" },
];

export function DashboardSidebar({
  interestedCount = 0,
  callingCount = 0,
}: {
  interestedCount?: number;
  callingCount?: number;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  return (
    <aside className="w-64 bg-white dark:bg-stone-900 border-r border-stone-200 dark:border-stone-800 p-6 flex flex-col fixed h-full z-20">
      <Link href="/dashboard" className="mb-10 flex items-center gap-3 group">
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
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all text-sm font-semibold ${
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
        <button
          type="button"
          onClick={() => router.push("/auth/login")}
          className="w-full flex items-center gap-3 px-4 py-3 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-2xl transition-all text-sm font-semibold"
        >
          <LogOut size={18} />
          Logout
        </button>
      </div>
    </aside>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const s = (status || "pending").toLowerCase();
  const styles: Record<string, string> = {
    calling: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 animate-pulse",
    "visit scheduled": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    "scheduled visit": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    "follow up": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    "not interested": "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    "not - interested": "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    "call ended": "bg-stone-200 text-stone-700 dark:bg-stone-700 dark:text-stone-300",
    "call completed": "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    completed: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    failed: "bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400",
    answered: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
    pending: "bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400",
  };
  const cls = styles[s] || styles.pending;
  return (
    <span className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest whitespace-nowrap ${cls}`}>
      {status || "pending"}
    </span>
  );
}
