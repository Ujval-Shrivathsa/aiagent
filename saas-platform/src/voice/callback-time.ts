/**
 * ============================================================================
 *   CALLBACK TIME — the sales team is reachable 10am–7pm, and that window is
 *   the only thing Priya may promise a caller.
 * ============================================================================
 *   Pure helpers, unit-tested without a live call. The model proposes a time via
 *   the `setCallbackTime` tool; this module is the authority on whether that time
 *   is acceptable, and it is deliberately the SECOND gate — the prompt already
 *   tells the model to refuse out-of-window times, and this catches it if the
 *   model slips. A rejected time is logged and never written, because writing a
 *   promise the sales team cannot keep is worse than recording nothing.
 *
 *   Window: 10:00–19:00 inclusive, local. "7pm" is valid; "7:30pm" is not.
 * ============================================================================
 */

import {
  CALLBACK_WINDOW_START_HOUR,
  CALLBACK_WINDOW_END_HOUR,
  CALLBACK_WINDOW_LABEL,
} from './kannada-script';

const START_MIN = CALLBACK_WINDOW_START_HOUR * 60; // 600 = 10:00
const END_MIN = CALLBACK_WINDOW_END_HOUR * 60; // 1140 = 19:00

export { CALLBACK_WINDOW_LABEL };

export type CallbackDay = 'today' | 'tomorrow';

export type CallbackParse =
  | { ok: true; at: Date; minutesOfDay: number; day: CallbackDay }
  | { ok: false; reason: string };

/**
 * Parse the tool's `timeOfDay` into minutes-of-day.
 *
 * Deliberately forgiving about FORMAT. A flow test showed the model sends "7pm"
 * rather than the "19:00" the description asks for, and a strict parser turned
 * that into a rejected callback — the promise was made out loud and then not
 * saved. Accepting several spellings is strictly safer than losing the booking.
 * It is NOT forgiving about RANGE: an out-of-window time is still refused.
 */
export function parseClockToMinutes(raw: string | undefined | null): { ok: true; minutes: number } | { ok: false; reason: string } {
  const s = String(raw ?? '').trim().toLowerCase().replace(/[.]/g, ':');
  if (!s) return { ok: false, reason: 'empty time' };

  // 24-hour with separator: 19:00 / 19-00
  const h24 = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (h24) {
    const h = Number(h24[1]);
    const m = Number(h24[2]);
    if (h > 23 || m > 59) return { ok: false, reason: `invalid time "${raw}"` };
    return { ok: true, minutes: h * 60 + m };
  }

  // 24-hour compact: 1900
  const compact = /^(\d{2})(\d{2})$/.exec(s);
  if (compact) {
    const h = Number(compact[1]);
    const m = Number(compact[2]);
    if (h > 23 || m > 59) return { ok: false, reason: `invalid time "${raw}"` };
    return { ok: true, minutes: h * 60 + m };
  }

  // 12-hour with meridiem: "7pm", "7 pm", "7:30pm", "7:30 pm"
  const h12 = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/.exec(s);
  if (h12) {
    const h = Number(h12[1]);
    const m = h12[2] ? Number(h12[2]) : 0;
    if (h > 12 || m > 59) return { ok: false, reason: `invalid time "${raw}"` };
    const meridiem = h12[3] || '';
    // pm: 12pm is noon, everything else is h+12. am: 12am is midnight, else h.
    if (/p/.test(meridiem)) return { ok: true, minutes: (h === 12 ? 12 : h + 12) * 60 + m };
    if (/a/.test(meridiem)) return { ok: true, minutes: (h === 12 ? 0 : h) * 60 + m };
    // Bare hour with no meridiem: 1-7 is the common "call me at 7" = evening.
    return { ok: true, minutes: (h >= 1 && h <= 7 ? h + 12 : h) * 60 + m };
  }

  return { ok: false, reason: `unrecognised time "${raw}"` };
}

/**
 * Parse the tool's `day` + `timeOfDay` into a Date.
 * Rejects anything outside 10:00–19:00 rather than silently clamping — clamping
 * would promise the caller a time they did not agree to.
 */
export function parseCallbackTime(
  day: string | undefined,
  timeOfDay: string | undefined,
  now: Date = new Date(),
): CallbackParse {
  const dayNorm = String(day || 'today').trim().toLowerCase();
  if (dayNorm !== 'today' && dayNorm !== 'tomorrow') {
    return { ok: false, reason: `unknown day "${day}" (use today or tomorrow)` };
  }

  const clock = parseClockToMinutes(timeOfDay);
  if (!clock.ok) return { ok: false, reason: `${clock.reason} (use 24-hour HH:MM, e.g. 19:00)` };

  const minutesOfDay = clock.minutes;
  if (minutesOfDay < START_MIN || minutesOfDay > END_MIN) {
    return {
      ok: false,
      reason: `${String(Math.floor(minutesOfDay / 60)).padStart(2, '0')}:${String(minutesOfDay % 60).padStart(2, '0')} is outside ${CALLBACK_WINDOW_LABEL}`,
    };
  }

  const at = new Date(now);
  if (dayNorm === 'tomorrow') at.setDate(at.getDate() + 1);
  at.setHours(Math.floor(minutesOfDay / 60), minutesOfDay % 60, 0, 0);
  return { ok: true, at, minutesOfDay, day: dayNorm };
}

/** True when a Date falls inside the daily callback window. */
export function isWithinCallbackWindow(at: Date): boolean {
  const mins = at.getHours() * 60 + at.getMinutes();
  return mins >= START_MIN && mins <= END_MIN;
}

/**
 * "19:00" → "ಸಂಜೆ 7 ಗಂಟೆಗೆ" — how Priya says the time back. Spoken Kannada keeps the
 * 12-hour clock people actually use on a phone call.
 */
export function spokenTimeLabel(at: Date, day: CallbackDay = 'today'): string {
  const h24 = at.getHours();
  const m = at.getMinutes();
  const isPm = h24 >= 12;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const period = isPm ? 'ಸಂಜೆ' : 'ಬೆಳಗ್ಗೆ';
  const dayWord = day === 'tomorrow' ? 'ನಾಳೆ' : '';
  const time = m === 0 ? `${h12} ಗಂಟೆಗೆ` : `${h12} ಗಂಟೆ ${m} ನಿಮಿಷಕ್ಕೆ`;
  return [dayWord, period, time].filter(Boolean).join(' ');
}

/**
 * Caller asked for a specific time? Detects Kannada and English phrasing so the
 * guard can route to the confirm / refuse nudge instead of the generic close.
 * Returns the raw hour phrase when it looks like a clock time.
 */
const TIME_PHRASE =
  /(\d{1,2})\s*(?:[:.](\d{2})\s*)?(?:o['\u2009]?clock|ಗಂಟೆಗೆ|ಗಂಟೆಗೂ|ಗಂಟೆ|ಟೈಮ್|am|pm|ಬೆಳಗ್ಗೆ|ಸಂಜೆ|ರಾತ್ರಿ|in the (?:morning|evening|night))/i;

export function looksLikeCallbackTimeRequest(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  // Must be a request to be called back, not just any number.
  if (!/(?:ಕರೆ|ಫೋನ್|call|ring|contact)/i.test(t)) return false;
  return TIME_PHRASE.test(t);
}

/**
 * Rough read of the requested clock time in minutes-of-day, for deciding
 * accept-vs-refuse before the model gets involved. Best-effort: the model still
 * proposes the final structured value, and parseCallbackTime() is the authority.
 */
export function requestedMinutesOfDay(text: string): number | null {
  const t = String(text || '').trim();
  const m = /(\d{1,2})\s*(?:[:.](\d{2}))?\s*(am|pm|ಬೆಳಗ್ಗೆ|ಸಂಜೆ|ರಾತ್ರಿ|in the (?:morning|evening|night))?/i.exec(t);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const marker = (m[3] || '').toLowerCase();
  if (hour > 24 || minute > 59) return null;

  const pm = /pm|ಸಂಜೆ|ರಾತ್ರಿ|evening|night/.test(marker);
  const am = /am|ಬೆಳಗ್ಗೆ|morning/.test(marker);
  if (pm && hour < 12) hour += 12;
  if (am && hour === 12) hour = 0;
  // A bare number in a callback request almost always means the 24-hour clock.
  if (!pm && !am && hour >= 1 && hour <= 7) hour += 12;

  const mins = hour * 60 + minute;
  return mins >= 0 && mins < 24 * 60 ? mins : null;
}