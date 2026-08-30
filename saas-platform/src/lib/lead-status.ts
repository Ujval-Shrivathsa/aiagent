/**
 * Lead call lifecycle statuses and idempotent transitions.
 *
 * Flow (happy path):
 *   pending → calling → answered → call completed → interested | follow up | visit scheduled | not interested
 *
 * Unanswered: pending → calling → not answered
 * Technical:  pending → calling → failed
 * Provider hangup while active: calling | answered → call ended
 *
 * Legacy aliases are normalized on read so old DB rows keep working.
 */

export const LEAD_STATUS = {
  PENDING: 'pending',
  CALLING: 'calling',
  ANSWERED: 'answered',
  CALL_COMPLETED: 'call completed',
  INTERESTED: 'interested',
  FOLLOW_UP: 'follow up',
  VISIT_SCHEDULED: 'visit scheduled',
  NOT_INTERESTED: 'not interested',
  NOT_ANSWERED: 'not answered',
  CALL_ENDED: 'call ended',
  FAILED: 'failed',
} as const;

export type LeadStatus = (typeof LEAD_STATUS)[keyof typeof LEAD_STATUS];

const ALL = Object.values(LEAD_STATUS);

/** Older strings still present in DB / UI. */
const LEGACY_ALIASES: Record<string, LeadStatus> = {
  'not - interested': LEAD_STATUS.NOT_INTERESTED,
  'scheduled visit': LEAD_STATUS.VISIT_SCHEDULED,
  completed: LEAD_STATUS.CALL_COMPLETED,
  'call complete': LEAD_STATUS.CALL_COMPLETED,
  idle: LEAD_STATUS.PENDING,
};

export function normalizeLeadStatus(raw: string | null | undefined): LeadStatus {
  const s = String(raw || LEAD_STATUS.PENDING).trim().toLowerCase();
  if ((ALL as string[]).includes(s)) return s as LeadStatus;
  return LEGACY_ALIASES[s] || LEAD_STATUS.PENDING;
}

export function isLeadStatus(value: string): value is LeadStatus {
  const s = String(value || '').trim().toLowerCase();
  if ((ALL as string[]).includes(s)) return true;
  return Object.prototype.hasOwnProperty.call(LEGACY_ALIASES, s);
}

/** Outcomes that mean the customer’s commercial result is known. */
export const OUTCOME_STATUSES = [
  LEAD_STATUS.INTERESTED,
  LEAD_STATUS.FOLLOW_UP,
  LEAD_STATUS.VISIT_SCHEDULED,
  LEAD_STATUS.NOT_INTERESTED,
] as const;

/** Phone-call lifecycle only (not customer intent). */
export const CALL_STATUSES = [
  LEAD_STATUS.PENDING,
  LEAD_STATUS.CALLING,
  LEAD_STATUS.ANSWERED,
  LEAD_STATUS.NOT_ANSWERED,
  LEAD_STATUS.CALL_COMPLETED,
  LEAD_STATUS.CALL_ENDED,
  LEAD_STATUS.FAILED,
] as const;

/** Explicit “no outcome yet” for the Customer Outcome container. */
export const OUTCOME_UNKNOWN = 'unknown' as const;
export type OutcomeStatus = (typeof OUTCOME_STATUSES)[number] | typeof OUTCOME_UNKNOWN;
export type CallStatus = (typeof CALL_STATUSES)[number];

export function isCallStatus(value: string): value is CallStatus {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === OUTCOME_UNKNOWN) return false;
  if ((OUTCOME_STATUSES as readonly string[]).includes(raw)) return false;
  const n = normalizeLeadStatus(raw);
  return (CALL_STATUSES as readonly string[]).includes(n);
}

export function isOutcomeStatus(value: string): value is OutcomeStatus {
  const s = String(value || '').trim().toLowerCase();
  if (s === OUTCOME_UNKNOWN) return true;
  const n = normalizeLeadStatus(s);
  return (OUTCOME_STATUSES as readonly string[]).includes(n);
}

/**
 * Split a legacy single `status` (or explicit dual fields) into call + outcome.
 * Used by the API so the UI never has to derive one from the other.
 */
export function splitLeadStatusFields(input: {
  status?: string | null;
  callStatus?: string | null;
  outcomeStatus?: string | null;
  interested?: boolean | null;
}): { call_status: CallStatus; outcome_status: OutcomeStatus } {
  const explicitCall = input.callStatus?.trim();
  const explicitOutcome = input.outcomeStatus?.trim().toLowerCase();

  if (explicitCall && isCallStatus(explicitCall)) {
    let outcome: OutcomeStatus = OUTCOME_UNKNOWN;
    if (explicitOutcome && isOutcomeStatus(explicitOutcome)) {
      outcome = explicitOutcome === OUTCOME_UNKNOWN
        ? OUTCOME_UNKNOWN
        : (normalizeLeadStatus(explicitOutcome) as OutcomeStatus);
    } else if (input.interested === true) {
      outcome = LEAD_STATUS.INTERESTED;
    } else if (input.interested === false) {
      outcome = LEAD_STATUS.NOT_INTERESTED;
    }
    return {
      call_status: normalizeLeadStatus(explicitCall) as CallStatus,
      outcome_status: outcome,
    };
  }

  const s = normalizeLeadStatus(input.status);
  if ((OUTCOME_STATUSES as readonly string[]).includes(s)) {
    return {
      call_status: LEAD_STATUS.CALL_COMPLETED,
      outcome_status: s as OutcomeStatus,
    };
  }
  if (input.interested === true && s === LEAD_STATUS.CALL_COMPLETED) {
    return { call_status: LEAD_STATUS.CALL_COMPLETED, outcome_status: LEAD_STATUS.INTERESTED };
  }
  if (input.interested === false && s === LEAD_STATUS.CALL_COMPLETED) {
    return { call_status: LEAD_STATUS.CALL_COMPLETED, outcome_status: LEAD_STATUS.NOT_INTERESTED };
  }
  return {
    call_status: (CALL_STATUSES as readonly string[]).includes(s)
      ? (s as CallStatus)
      : LEAD_STATUS.PENDING,
    outcome_status: OUTCOME_UNKNOWN,
  };
}

/** Compose legacy `status` from dual fields (for dial skip / transitions). */
export function composeLegacyStatus(
  callStatus: string,
  outcomeStatus: string,
): LeadStatus {
  const outcome = String(outcomeStatus || '').trim().toLowerCase();
  if (outcome && outcome !== OUTCOME_UNKNOWN && isOutcomeStatus(outcome)) {
    return normalizeLeadStatus(outcome);
  }
  return normalizeLeadStatus(callStatus);
}

/** Prisma write payload when transitioning the legacy `status` value. */
export function dualFieldsForTransition(toRaw: string): {
  callStatus: CallStatus;
  outcomeStatus: OutcomeStatus;
} {
  const to = normalizeLeadStatus(toRaw);
  if ((OUTCOME_STATUSES as readonly string[]).includes(to)) {
    return {
      callStatus: LEAD_STATUS.CALL_COMPLETED,
      outcomeStatus: to as OutcomeStatus,
    };
  }
  // Redial / early lifecycle: clear commercial outcome
  return {
    callStatus: (CALL_STATUSES as readonly string[]).includes(to)
      ? (to as CallStatus)
      : LEAD_STATUS.PENDING,
    outcomeStatus: OUTCOME_UNKNOWN,
  };
}

export const CALL_STATUS_LABELS: Record<CallStatus, string> = {
  [LEAD_STATUS.PENDING]: 'Pending',
  [LEAD_STATUS.CALLING]: 'Calling',
  [LEAD_STATUS.ANSWERED]: 'Answered',
  [LEAD_STATUS.NOT_ANSWERED]: 'Not Answered',
  [LEAD_STATUS.CALL_COMPLETED]: 'Call Completed',
  [LEAD_STATUS.CALL_ENDED]: 'Call Ended',
  [LEAD_STATUS.FAILED]: 'Failed',
};

export const OUTCOME_STATUS_LABELS: Record<OutcomeStatus, string> = {
  [OUTCOME_UNKNOWN]: 'Unknown',
  [LEAD_STATUS.INTERESTED]: 'Looking for Lead',
  [LEAD_STATUS.FOLLOW_UP]: 'Looking for Lead',
  [LEAD_STATUS.VISIT_SCHEDULED]: 'Looking for Lead',
  [LEAD_STATUS.NOT_INTERESTED]: 'Not Looking for Lead',
};

export function labelForCallStatus(value: string | null | undefined): string {
  const s = normalizeLeadStatus(value);
  return CALL_STATUS_LABELS[s as CallStatus] || CALL_STATUS_LABELS[LEAD_STATUS.PENDING];
}

export function labelForOutcomeStatus(value: string | null | undefined): string {
  const raw = String(value || OUTCOME_UNKNOWN).trim().toLowerCase();
  if (raw === OUTCOME_UNKNOWN) return OUTCOME_STATUS_LABELS[OUTCOME_UNKNOWN];
  const s = normalizeLeadStatus(raw);
  return OUTCOME_STATUS_LABELS[s as OutcomeStatus] || OUTCOME_STATUS_LABELS[OUTCOME_UNKNOWN];
}

/** Do not auto-dial these again mid-campaign. */
export const SKIP_DIAL_STATUSES: readonly LeadStatus[] = [
  LEAD_STATUS.CALLING,
  LEAD_STATUS.ANSWERED,
  LEAD_STATUS.VISIT_SCHEDULED,
];

/** Webhooks must never clobber these. */
export const TERMINAL_OUTCOME_STATUSES: readonly LeadStatus[] = [
  ...OUTCOME_STATUSES,
  LEAD_STATUS.CALL_COMPLETED,
];

/**
 * Allowed directed edges. Self-transitions are always allowed (idempotent no-op).
 * Missing edge ⇒ transition rejected.
 */
const ALLOWED: Record<LeadStatus, readonly LeadStatus[]> = {
  [LEAD_STATUS.PENDING]: [LEAD_STATUS.CALLING, LEAD_STATUS.FAILED],
  [LEAD_STATUS.CALLING]: [
    LEAD_STATUS.ANSWERED,
    LEAD_STATUS.NOT_ANSWERED,
    LEAD_STATUS.FAILED,
    LEAD_STATUS.CALL_ENDED,
  ],
  [LEAD_STATUS.ANSWERED]: [
    LEAD_STATUS.CALL_COMPLETED,
    LEAD_STATUS.INTERESTED,
    LEAD_STATUS.FOLLOW_UP,
    LEAD_STATUS.VISIT_SCHEDULED,
    LEAD_STATUS.NOT_INTERESTED,
    LEAD_STATUS.CALL_ENDED,
    LEAD_STATUS.FAILED,
  ],
  [LEAD_STATUS.CALL_COMPLETED]: [
    LEAD_STATUS.INTERESTED,
    LEAD_STATUS.FOLLOW_UP,
    LEAD_STATUS.VISIT_SCHEDULED,
    LEAD_STATUS.NOT_INTERESTED,
  ],
  [LEAD_STATUS.INTERESTED]: [
    LEAD_STATUS.FOLLOW_UP,
    LEAD_STATUS.VISIT_SCHEDULED,
    LEAD_STATUS.NOT_INTERESTED,
    LEAD_STATUS.CALLING, // redial
  ],
  [LEAD_STATUS.FOLLOW_UP]: [
    LEAD_STATUS.VISIT_SCHEDULED,
    LEAD_STATUS.NOT_INTERESTED,
    LEAD_STATUS.INTERESTED,
    LEAD_STATUS.CALLING,
  ],
  [LEAD_STATUS.VISIT_SCHEDULED]: [
    LEAD_STATUS.FOLLOW_UP, // reschedule path
    LEAD_STATUS.CALLING,
  ],
  [LEAD_STATUS.NOT_INTERESTED]: [LEAD_STATUS.CALLING],
  [LEAD_STATUS.NOT_ANSWERED]: [LEAD_STATUS.CALLING, LEAD_STATUS.FAILED],
  [LEAD_STATUS.CALL_ENDED]: [
    LEAD_STATUS.CALL_COMPLETED,
    LEAD_STATUS.INTERESTED,
    LEAD_STATUS.FOLLOW_UP,
    LEAD_STATUS.VISIT_SCHEDULED,
    LEAD_STATUS.NOT_INTERESTED,
    LEAD_STATUS.CALLING,
  ],
  [LEAD_STATUS.FAILED]: [LEAD_STATUS.CALLING, LEAD_STATUS.PENDING],
};

export function canTransition(fromRaw: string, toRaw: string): boolean {
  const from = normalizeLeadStatus(fromRaw);
  const to = normalizeLeadStatus(toRaw);
  if (from === to) return true;
  return (ALLOWED[from] || []).includes(to);
}

/** Statuses that may legally move to `to` (for Prisma `status: { in: ... }`). */
export function sourcesForTransition(toRaw: string): LeadStatus[] {
  const to = normalizeLeadStatus(toRaw);
  const sources: LeadStatus[] = [to]; // idempotent re-apply
  for (const from of ALL) {
    if (from !== to && canTransition(from, to)) sources.push(from);
  }
  return sources;
}

export type ProviderHangupHint = {
  /** Twilio CallStatus or Plivo Event / HangupCause text */
  providerStatus?: string | null;
  hangupCause?: string | null;
  /** Billable / talk duration in seconds when known */
  durationSec?: number | null;
  /** True when we know the media stream / answer URL already ran */
  wasAnswered?: boolean;
};

/**
 * Map provider hangup / terminal callback → desired lead status.
 * Does not apply the transition; caller uses {@link sourcesForTransition}.
 */
export function statusFromProviderHangup(hint: ProviderHangupHint): LeadStatus {
  const status = String(hint.providerStatus || '').toLowerCase();
  const cause = String(hint.hangupCause || '').toLowerCase();
  const combined = `${status} ${cause}`;
  const duration = hint.durationSec ?? null;

  if (
    /no[\s_-]*answer|no_answer|unanswered|timeout|originator_cancel/.test(combined) ||
    status === 'no-answer'
  ) {
    return LEAD_STATUS.NOT_ANSWERED;
  }

  if (
    /busy|rejected|call_rejected|user_busy/.test(combined) ||
    status === 'busy'
  ) {
    // Ringing but party didn’t take the call — treat as not answered per lifecycle.
    return LEAD_STATUS.NOT_ANSWERED;
  }

  if (
    /failed|cancel|canceled|cancelled|congest|network|sip|error|destination/.test(combined) ||
    status === 'failed' ||
    status === 'canceled'
  ) {
    return LEAD_STATUS.FAILED;
  }

  // Normal clearing / completed with never-answered → not answered
  if (!hint.wasAnswered && (duration === 0 || duration === null)) {
    if (/normal_clearing|completed|hangup|hang_up/.test(combined) || !combined.trim()) {
      // If duration is explicitly 0 → unanswered. If unknown, prefer call ended
      // only when we know they were answered; otherwise not answered when still ringing path.
      if (duration === 0) return LEAD_STATUS.NOT_ANSWERED;
    }
  }

  if (hint.wasAnswered === false && duration === 0) {
    return LEAD_STATUS.NOT_ANSWERED;
  }

  // Normal completed hangup after an active call
  if (
    /completed|normal_clearing|normal clearing|hangup|hang_up/.test(combined) ||
    status === 'completed'
  ) {
    return LEAD_STATUS.CALL_ENDED;
  }

  return LEAD_STATUS.FAILED;
}

/**
 * After conversation tools finish, promote `call completed` → outcome when known.
 */
export function outcomeFromFlags(opts: {
  interested: boolean | null | undefined;
  explicitNotInterested?: boolean;
  followUp?: boolean;
  visitScheduled?: boolean;
}): LeadStatus | null {
  if (opts.visitScheduled) return LEAD_STATUS.VISIT_SCHEDULED;
  if (opts.followUp) return LEAD_STATUS.FOLLOW_UP;
  if (opts.explicitNotInterested || opts.interested === false) return LEAD_STATUS.NOT_INTERESTED;
  if (opts.interested === true) return LEAD_STATUS.INTERESTED;
  return null;
}

/** @deprecated Prefer CALL_STATUS_FILTER_OPTIONS + OUTCOME_STATUS_FILTER_OPTIONS */
export const LEAD_STATUS_FILTER_OPTIONS: { value: LeadStatus; label: string }[] = [
  { value: LEAD_STATUS.PENDING, label: 'Pending' },
  { value: LEAD_STATUS.CALLING, label: 'Calling' },
  { value: LEAD_STATUS.ANSWERED, label: 'Answered' },
  { value: LEAD_STATUS.NOT_ANSWERED, label: 'Not Answered' },
  { value: LEAD_STATUS.CALL_COMPLETED, label: 'Call Completed' },
  { value: LEAD_STATUS.CALL_ENDED, label: 'Call Ended' },
  { value: LEAD_STATUS.FAILED, label: 'Failed' },
  { value: LEAD_STATUS.INTERESTED, label: 'Interested' },
  { value: LEAD_STATUS.FOLLOW_UP, label: 'Follow Up' },
  { value: LEAD_STATUS.VISIT_SCHEDULED, label: 'Visit Scheduled' },
  { value: LEAD_STATUS.NOT_INTERESTED, label: 'Not Interested' },
];

export const CALL_STATUS_FILTER_OPTIONS: { value: CallStatus; label: string }[] =
  CALL_STATUSES.map((value) => ({ value, label: CALL_STATUS_LABELS[value] }));

export const OUTCOME_STATUS_FILTER_OPTIONS: { value: OutcomeStatus; label: string }[] = [
  { value: OUTCOME_UNKNOWN, label: OUTCOME_STATUS_LABELS[OUTCOME_UNKNOWN] },
  ...OUTCOME_STATUSES.map((value) => ({
    value: value as OutcomeStatus,
    label: OUTCOME_STATUS_LABELS[value],
  })),
];

export const STATUS_BADGE_STYLES: Record<string, string> = {
  [LEAD_STATUS.PENDING]: 'bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400',
  [LEAD_STATUS.CALLING]: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 animate-pulse',
  [LEAD_STATUS.ANSWERED]: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  [LEAD_STATUS.CALL_COMPLETED]: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  [LEAD_STATUS.INTERESTED]: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  [LEAD_STATUS.FOLLOW_UP]: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  [LEAD_STATUS.VISIT_SCHEDULED]: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  [LEAD_STATUS.NOT_INTERESTED]: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  [LEAD_STATUS.NOT_ANSWERED]: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  [LEAD_STATUS.CALL_ENDED]: 'bg-stone-200 text-stone-700 dark:bg-stone-700 dark:text-stone-300',
  [LEAD_STATUS.FAILED]: 'bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400',
  [OUTCOME_UNKNOWN]: 'bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400',
  // legacy keys
  'not - interested': 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  'scheduled visit': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  completed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
};

/** Attach canonical dual status fields for API / UI consumers. */
export function serializeLeadStatusFields<T extends Record<string, unknown>>(lead: T) {
  const split = splitLeadStatusFields({
    status: lead.status as string | null | undefined,
    callStatus: (lead.callStatus ?? lead.call_status) as string | null | undefined,
    outcomeStatus: (lead.outcomeStatus ?? lead.outcome_status) as string | null | undefined,
    interested: lead.interested as boolean | null | undefined,
  });
  return {
    ...lead,
    call_status: split.call_status,
    outcome_status: split.outcome_status,
    callStatus: split.call_status,
    outcomeStatus: split.outcome_status,
  };
}
