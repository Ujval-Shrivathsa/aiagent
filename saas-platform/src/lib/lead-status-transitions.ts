import { prisma } from '@/lib/prisma';
import {
  LEAD_STATUS,
  LeadStatus,
  canTransition,
  normalizeLeadStatus,
  sourcesForTransition,
  statusFromProviderHangup,
  ProviderHangupHint,
  OUTCOME_STATUSES,
  dualFieldsForTransition,
  composeLegacyStatus,
  isCallStatus,
  isOutcomeStatus,
  OUTCOME_UNKNOWN,
} from '@/lib/lead-status';

function phoneTail(phone: string): string {
  return phone.replace(/\D/g, '').slice(-10);
}

export type TransitionResult = {
  ok: boolean;
  count: number;
  fromAllowed: LeadStatus[];
  to: LeadStatus;
  reason?: string;
};

/**
 * Idempotent status update: only rows whose current status may move to `to`
 * (including already-at-`to`) are updated. Duplicate webhooks are safe.
 * Also keeps callStatus + outcomeStatus in sync with the legacy `status` field.
 */
export async function transitionLeadsByPhone(
  phone: string,
  toRaw: string,
  data: Record<string, unknown> = {}
): Promise<TransitionResult> {
  const to = normalizeLeadStatus(toRaw);
  const tail = phoneTail(phone);
  if (!tail) {
    return { ok: false, count: 0, fromAllowed: [], to, reason: 'empty phone' };
  }
  const fromAllowed = sourcesForTransition(to);
  const dual = dualFieldsForTransition(to);
  const result = await prisma.lead.updateMany({
    where: {
      phone: { contains: tail },
      status: { in: [...fromAllowed, ...legacyVariants(fromAllowed)] },
    },
    data: {
      ...data,
      status: to,
      callStatus: dual.callStatus,
      outcomeStatus: dual.outcomeStatus,
    },
  });
  return { ok: true, count: result.count, fromAllowed, to };
}

export async function transitionLeadById(
  id: string,
  toRaw: string,
  data: Record<string, unknown> = {}
): Promise<TransitionResult> {
  const to = normalizeLeadStatus(toRaw);
  const fromAllowed = sourcesForTransition(to);
  const dual = dualFieldsForTransition(to);
  const result = await prisma.lead.updateMany({
    where: {
      id,
      status: { in: [...fromAllowed, ...legacyVariants(fromAllowed)] },
    },
    data: {
      ...data,
      status: to,
      callStatus: dual.callStatus,
      outcomeStatus: dual.outcomeStatus,
    },
  });
  return { ok: result.count > 0, count: result.count, fromAllowed, to };
}

/** Include legacy spellings that normalize to the same logical status. */
function legacyVariants(statuses: LeadStatus[]): string[] {
  const extra: string[] = [];
  for (const s of statuses) {
    if (s === LEAD_STATUS.NOT_INTERESTED) extra.push('not - interested');
    if (s === LEAD_STATUS.VISIT_SCHEDULED) extra.push('scheduled visit');
    if (s === LEAD_STATUS.CALL_COMPLETED) extra.push('completed');
  }
  return extra;
}

export async function markCalling(leadId: string): Promise<TransitionResult> {
  return transitionLeadById(leadId, LEAD_STATUS.CALLING);
}

export async function markAnsweredByPhone(phone: string): Promise<TransitionResult> {
  return transitionLeadsByPhone(phone, LEAD_STATUS.ANSWERED);
}

export async function markCallCompletedByPhone(phone: string): Promise<TransitionResult> {
  return transitionLeadsByPhone(phone, LEAD_STATUS.CALL_COMPLETED);
}

export async function markOutcomeByPhone(
  phone: string,
  outcome: LeadStatus,
  data: Record<string, unknown> = {}
): Promise<TransitionResult> {
  const to = normalizeLeadStatus(outcome);
  if (!(OUTCOME_STATUSES as readonly string[]).includes(to)) {
    return { ok: false, count: 0, fromAllowed: [], to, reason: 'not an outcome status' };
  }
  return transitionLeadsByPhone(phone, to, data);
}

/**
 * Admin / UI: set call status and outcome independently, then sync legacy `status`.
 */
export async function setDualStatusById(
  id: string,
  opts: { callStatus?: string; outcomeStatus?: string }
): Promise<{ ok: boolean; callStatus: string; outcomeStatus: string; status: string }> {
  const current = await prisma.lead.findUnique({ where: { id } });
  if (!current) {
    return { ok: false, callStatus: 'pending', outcomeStatus: OUTCOME_UNKNOWN, status: 'pending' };
  }

  let callStatus = current.callStatus || LEAD_STATUS.PENDING;
  let outcomeStatus = current.outcomeStatus || OUTCOME_UNKNOWN;

  if (opts.callStatus != null && isCallStatus(opts.callStatus)) {
    callStatus = normalizeLeadStatus(opts.callStatus);
  }
  if (opts.outcomeStatus != null && isOutcomeStatus(opts.outcomeStatus)) {
    const raw = String(opts.outcomeStatus).trim().toLowerCase();
    outcomeStatus = raw === OUTCOME_UNKNOWN ? OUTCOME_UNKNOWN : normalizeLeadStatus(raw);
  }

  const status = composeLegacyStatus(callStatus, outcomeStatus);
  await prisma.lead.update({
    where: { id },
    data: {
      callStatus,
      outcomeStatus,
      status,
      ...(outcomeStatus === LEAD_STATUS.INTERESTED
        ? { interested: true }
        : outcomeStatus === LEAD_STATUS.NOT_INTERESTED
          ? { interested: false }
          : {}),
    },
  });
  return { ok: true, callStatus, outcomeStatus, status };
}

/**
 * Provider hangup / status callback. Chooses not answered vs failed vs call ended,
 * and only updates rows that may legally transition there.
 */
export async function applyProviderTerminalStatus(
  phone: string,
  hint: ProviderHangupHint
): Promise<TransitionResult & { mapped: LeadStatus }> {
  const mapped = statusFromProviderHangup(hint);

  // If mapped to call ended but lead is still only `calling` and duration is 0,
  // prefer not answered (never connected).
  let to = mapped;
  if (to === LEAD_STATUS.CALL_ENDED && hint.wasAnswered !== true) {
    const duration = hint.durationSec;
    if (duration === 0 || duration == null) {
      // Only rewrite when we can confirm they were still ringing:
      // statusFromProviderHangup already returns NOT_ANSWERED for no-answer;
      // for NORMAL_CLEARING with 0 duration, use not answered.
      if (duration === 0) to = LEAD_STATUS.NOT_ANSWERED;
    }
  }

  const result = await transitionLeadsByPhone(phone, to);
  return { ...result, mapped: to };
}

export function assertCanTransition(from: string, to: string): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid lead status transition: ${from} → ${to}`);
  }
}

export { LEAD_STATUS, canTransition, normalizeLeadStatus, statusFromProviderHangup };
