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
      <header className="flex flex-col gap-4 mb-8 sm:mb-12">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight text-neutral-900">
            {title}
          </h1>
          {subtitle && (
            <p className="text-neutral-500 mt-1.5 sm:mt-2 text-sm sm:text-base max-w-2xl">
              {subtitle}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex flex-col sm:flex-row flex-wrap gap-2 sm:gap-3 w-full sm:w-auto">
            {actions}
          </div>
        )}
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
      className={`bg-white rounded-xl border border-neutral-200 overflow-hidden ${className}`}
    >
      {(title || actions) && (
        <div className="p-4 sm:p-5 lg:p-6 border-b border-neutral-100 flex flex-col gap-4">
          <div className="min-w-0">
            {title && (
              <h3 className="text-lg sm:text-xl font-semibold tracking-tight text-neutral-900">
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="text-sm text-neutral-500 mt-1">{subtitle}</p>
            )}
          </div>
          {actions && <div className="w-full min-w-0">{actions}</div>}
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
  delay = 0,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  delay?: number;
}) {
  return (
    <div
      className="bg-neutral-900 text-white p-5 sm:p-6 lg:p-7 rounded-xl animate-fade-in"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="text-white/60 mb-3">
        <Icon size={18} strokeWidth={1.75} />
      </div>
      <h4 className="text-white/60 text-xs font-medium">{label}</h4>
      <p className="text-2xl sm:text-3xl font-semibold text-white mt-1 tracking-tight">
        {value}
      </p>
    </div>
  );
}
