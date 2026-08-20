"use client";

import { DashboardSidebar } from "@/components/dashboard/Sidebar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950 flex transition-colors">
      <DashboardSidebar />
      <main className="flex-1 w-full min-w-0 lg:ml-64 pt-14 lg:pt-0 px-4 sm:px-6 lg:px-10 xl:px-12 py-5 sm:py-8 lg:py-12 min-h-screen">
        {children}
      </main>
    </div>
  );
}
