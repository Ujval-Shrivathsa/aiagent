/**
 * Call-wide outbound speech deduplication.
 * Suppresses duplicate model turns without shortening first-time delivery.
 */

const MIN_CHUNK_CHARS = 12;
const MIN_OVERLAP_CHARS = 18;
const DUPLICATE_OVERLAP_RATIO = 0.55;

export function normalizeForDedup(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function splitSpeakableChunks(text: string): string[] {
  const t = String(text || '').trim();
  if (!t) return [];
  const parts = t
    .split(/(?<=[.!?])\s+/)
    .map((p) => normalizeForDedup(p))
    .filter((p) => p.length >= MIN_CHUNK_CHARS);
  const full = normalizeForDedup(t);
  if (full.length >= MIN_CHUNK_CHARS && !parts.includes(full)) {
    parts.push(full);
  }
  return parts;
}

function overlapRatio(a: string, b: string): number {
  if (!a || !b) return 0;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length < MIN_OVERLAP_CHARS) {
    return shorter === longer ? 1 : 0;
  }
  if (shorter === longer) return 1;
  if (longer.includes(shorter)) return shorter.length / longer.length;
  const prefixLen = Math.min(36, shorter.length, longer.length);
  if (prefixLen >= MIN_OVERLAP_CHARS && shorter.slice(0, prefixLen) === longer.slice(0, prefixLen)) {
    return prefixLen / shorter.length;
  }
  return 0;
}

export function isDuplicateOutboundSpeech(
  text: string,
  spoken: ReadonlySet<string>,
): boolean {
  const norm = normalizeForDedup(text);
  if (!norm || norm.length < 14) return false;
  if (spoken.has(norm)) return true;

  for (const prior of spoken) {
    if (prior.length < 14) continue;
    if (overlapRatio(norm, prior) >= DUPLICATE_OVERLAP_RATIO) return true;
  }

  const chunks = splitSpeakableChunks(text);
  if (chunks.length === 0) return false;

  const substantial = chunks.filter((c) => c.length >= MIN_CHUNK_CHARS);
  if (substantial.length === 0) return false;

  const allAlreadySpoken = substantial.every((c) => spoken.has(c));
  if (allAlreadySpoken) return true;

  const longRepeated = substantial.filter((c) => c.length >= 50 && spoken.has(c));
  return longRepeated.length > 0;
}

export function registerOutboundSpeech(text: string, spoken: Set<string>): void {
  const norm = normalizeForDedup(text);
  if (norm.length >= 14) spoken.add(norm);
  for (const chunk of splitSpeakableChunks(text)) {
    spoken.add(chunk);
  }
}

export function allowsRepeatReplay(
  text: string,
  lastPlayedRaw: string,
  repeatReplayPending: boolean,
): boolean {
  if (!repeatReplayPending || !lastPlayedRaw.trim()) return false;
  return overlapRatio(normalizeForDedup(text), normalizeForDedup(lastPlayedRaw)) >= DUPLICATE_OVERLAP_RATIO;
}
