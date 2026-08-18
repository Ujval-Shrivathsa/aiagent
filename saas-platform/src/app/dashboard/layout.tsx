"use client";

import { DashboardSidebar } from "@/components/dashboard/Sidebar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950 flex transition-colors">
      <DashboardSidebar />
      <main className="flex-1 ml-64 p-6 sm:p-8 lg:p-12 min-h-screen">{children}</main>
    </div>
  );
}
