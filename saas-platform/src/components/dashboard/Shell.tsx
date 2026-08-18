"use client";

import { ReactNode } from "react";

export function DashboardShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <header className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-10">
        <div>
          <h1 className="text-3xl sm:text-4xl font-serif font-bold dark:text-stone-100 tracking-tight">
            {title}
          </h1>
          {subtitle && (
            <p className="text-stone-500 dark:text-stone-400 mt-2 text-base sm:text-lg">
              {subtitle}
            </p>
          )}
        </div>
        {actions && <div className="flex flex-wrap gap-3">{actions}</div>}
      </header>
      {children}
    </>
  );
}

export function DashboardCard({
  title,
  subtitle,
  actions,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-white dark:bg-stone-900 rounded-[2rem] border border-stone-200 dark:border-stone-800 overflow-hidden shadow-lg ${className}`}
    >
      {(title || actions) && (
        <div className="p-6 sm:p-8 border-b border-stone-100 dark:border-stone-800 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 bg-stone-50/40 dark:bg-stone-800/20">
          <div>
            {title && (
              <h3 className="text-xl sm:text-2xl font-serif font-bold dark:text-white">{title}</h3>
            )}
            {subtitle && <p className="text-sm text-stone-500 mt-1">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  icon: Icon,
  color,
  delay = 0,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  color: string;
  delay?: number;
}) {
  return (
    <div
      className="bg-white dark:bg-stone-900 p-6 sm:p-8 rounded-[2rem] border border-stone-200 dark:border-stone-800 shadow-lg relative overflow-hidden group animate-fade-in"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="absolute -right-4 -top-4 opacity-[0.04] group-hover:opacity-[0.08] transition-opacity">
        <Icon size={100} />
      </div>
      <div className={`p-3 rounded-2xl bg-stone-50 dark:bg-stone-800/50 ${color} shadow-inner mb-4 inline-flex`}>
        <Icon size={22} />
      </div>
      <h4 className="text-stone-500 dark:text-stone-400 text-[10px] font-black uppercase tracking-[0.2em]">
        {label}
      </h4>
      <p className="text-3xl sm:text-4xl font-black dark:text-white mt-2 tracking-tighter">{value}</p>
    </div>
  );
}
