"use client";

import type { ComponentType } from "react";
import { Phone, Target } from "lucide-react";
import {
  CALL_STATUS_FILTER_OPTIONS,
  OUTCOME_STATUS_FILTER_OPTIONS,
  labelForCallStatus,
  labelForOutcomeStatus,
  STATUS_BADGE_STYLES,
  normalizeLeadStatus,
  OUTCOME_UNKNOWN,
} from "@/lib/lead-status";

type DualLead = {
  call_status?: string | null;
  outcome_status?: string | null;
  callStatus?: string | null;
  outcomeStatus?: string | null;
  status?: string | null;
};

function resolveCall(lead: DualLead): string {
  return lead.call_status || lead.callStatus || lead.status || "pending";
}

function resolveOutcome(lead: DualLead): string {
  return lead.outcome_status || lead.outcomeStatus || OUTCOME_UNKNOWN;
}

function toneClass(value: string): string {
  const key =
    String(value).toLowerCase() === OUTCOME_UNKNOWN
      ? OUTCOME_UNKNOWN
      : normalizeLeadStatus(value);
  return STATUS_BADGE_STYLES[key] || STATUS_BADGE_STYLES.pending;
}

/** Quiet status pill — grayscale only. */
export function StatusChip({
  value,
  label,
}: {
  value: string;
  label?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full text-xs font-medium whitespace-nowrap ${toneClass(value)}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />
      {label || value}
    </span>
  );
}

/** Compact pair for mobile cards. */
export function DualStatusBadges({ lead }: { lead: DualLead }) {
  const call = resolveCall(lead);
  const outcome = resolveOutcome(lead);
  return (
    <div className="flex flex-col gap-1 items-end shrink-0">
      <StatusChip value={call} label={labelForCallStatus(call)} />
      <StatusChip value={outcome} label={labelForOutcomeStatus(outcome)} />
    </div>
  );
}

export function CallStatusBadge({ lead }: { lead: DualLead }) {
  const call = resolveCall(lead);
  return <StatusChip value={call} label={labelForCallStatus(call)} />;
}

export function OutcomeStatusBadge({ lead }: { lead: DualLead }) {
  const outcome = resolveOutcome(lead);
  return <StatusChip value={outcome} label={labelForOutcomeStatus(outcome)} />;
}

/** Detail modal: two clear status panels. */
export function DualStatusContainers({
  lead,
  editable = false,
  onCallStatusChange,
  onOutcomeStatusChange,
}: {
  lead: DualLead;
  editable?: boolean;
  onCallStatusChange?: (value: string) => void;
  onOutcomeStatusChange?: (value: string) => void;
}) {
  const call = resolveCall(lead);
  const outcome = resolveOutcome(lead);
  const callKey = normalizeLeadStatus(call);
  const outcomeKey =
    String(outcome).toLowerCase() === OUTCOME_UNKNOWN
      ? OUTCOME_UNKNOWN
      : normalizeLeadStatus(outcome);

  const fieldClass =
    "w-full mt-2 py-2.5 px-3 bg-white border border-neutral-200 rounded-lg text-sm text-neutral-900 input-base min-h-[44px]";

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <div className="flex items-center gap-2 text-neutral-500">
          <Phone size={14} strokeWidth={1.75} />
          <span className="section-label">Call status</span>
        </div>
        {editable && onCallStatusChange ? (
          <select
            value={callKey}
            onChange={(e) => onCallStatusChange(e.target.value)}
            className={fieldClass}
          >
            {CALL_STATUS_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ) : (
          <div className="mt-3">
            <StatusChip value={call} label={labelForCallStatus(call)} />
          </div>
        )}
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <div className="flex items-center gap-2 text-neutral-500">
          <Target size={14} strokeWidth={1.75} />
          <span className="section-label">Lead interest</span>
        </div>
        {editable && onOutcomeStatusChange ? (
          <select
            value={outcomeKey}
            onChange={(e) => onOutcomeStatusChange(e.target.value)}
            className={fieldClass}
          >
            {OUTCOME_STATUS_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ) : (
          <div className="mt-3">
            <StatusChip value={outcome} label={labelForOutcomeStatus(outcome)} />
          </div>
        )}
      </div>
    </div>
  );
}

const SELECT_CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23737373' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")";

function FilterField({
  icon: Icon,
  label,
  value,
  onChange,
  allLabel,
  options,
}: {
  icon: ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  label: string;
  value: string;
  onChange: (value: string) => void;
  allLabel: string;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1.5 min-w-0 flex-1 sm:flex-none sm:min-w-[10.5rem]">
      <span className="section-label inline-flex items-center gap-1.5 px-0.5">
        <Icon size={12} strokeWidth={1.75} />
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none py-2.5 pl-3 pr-8 bg-white border border-neutral-200 rounded-lg text-[13px] text-neutral-700 input-base min-h-[42px] w-full cursor-pointer bg-[length:12px] bg-[right_0.75rem_center] bg-no-repeat"
        style={{ backgroundImage: SELECT_CHEVRON }}
      >
        <option value="all">{allLabel}</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Separate, labeled filters — not two anonymous selects. */
export function DualStatusFilters({
  callFilter,
  outcomeFilter,
  onCallFilterChange,
  onOutcomeFilterChange,
}: {
  callFilter: string;
  outcomeFilter: string;
  onCallFilterChange: (value: string) => void;
  onOutcomeFilterChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 w-full sm:w-auto">
      <FilterField
        icon={Phone}
        label="Call status"
        value={callFilter}
        onChange={onCallFilterChange}
        allLabel="Any"
        options={CALL_STATUS_FILTER_OPTIONS}
      />
      <FilterField
        icon={Target}
        label="Lead interest"
        value={outcomeFilter}
        onChange={onOutcomeFilterChange}
        allLabel="Any"
        options={OUTCOME_STATUS_FILTER_OPTIONS}
      />
    </div>
  );
}
