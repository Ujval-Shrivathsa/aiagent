/**
 * Cache outbound system instructions when Plivo answer URL fires (callee picked up)
 * so the media-stream handler can skip rebuild latency on connect.
 *
 * Entries are stamped with VOICE_BEHAVIOR_VERSION so a restart/deploy with updated
 * greeting / silence / name rules never serves a stale prompt from a previous build.
 */
import { buildOutboundSystemInstruction, VOICE_BEHAVIOR_VERSION } from './kannada-script';

type CachedOpening = {
  instruction: string;
  at: number;
  version: string;
};

const cache = new Map<string, CachedOpening>();
const TTL_MS = 90_000;

function phoneKey(phoneDigits: string): string {
  return phoneDigits.replace(/\D/g, '').slice(-10);
}

export function cacheOutboundOpeningInstruction(phoneDigits: string, _customerName: string): void {
  const key = phoneKey(phoneDigits);
  if (!key) return;
  const currentDateStr = new Date().toLocaleDateString('en-IN');
  cache.set(key, {
    instruction: buildOutboundSystemInstruction(currentDateStr, undefined, { deferProjectReference: true }),
    at: Date.now(),
    version: VOICE_BEHAVIOR_VERSION,
  });
}

export function takeCachedOutboundOpeningInstruction(phoneDigits: string): string | null {
  const key = phoneKey(phoneDigits);
  if (!key) return null;
  const hit = cache.get(key);
  cache.delete(key);
  if (!hit || Date.now() - hit.at > TTL_MS) return null;
  if (hit.version !== VOICE_BEHAVIOR_VERSION) {
    console.log(
      `[OPENING-CACHE] Dropped stale prewarm (cached=${hit.version} live=${VOICE_BEHAVIOR_VERSION})`,
    );
    return null;
  }
  return hit.instruction;
}

/** Clear in-memory opening prompts so restarts pick up the current voice rules. */
export function clearOutboundOpeningInstructionCache(): number {
  const n = cache.size;
  cache.clear();
  return n;
}
