"use client";

import { DashboardSidebar } from "@/components/dashboard/Sidebar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f5f5f7] flex">
      <DashboardSidebar />
      <main className="flex-1 w-full min-w-0 lg:ml-64 pt-[4.5rem] lg:pt-7 px-4 sm:px-6 lg:px-12 xl:px-16 pb-10 sm:pb-14 lg:pb-16 min-h-screen">
        {children}
      </main>
    </div>
  );
}
