/**
 * Cache outbound system instructions when Plivo answer URL fires (callee picked up)
 * so the media-stream handler can skip rebuild latency on connect.
 */
import { buildOutboundSystemInstruction } from './kannada-script';

type CachedOpening = {
  instruction: string;
  at: number;
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
  });
}

export function takeCachedOutboundOpeningInstruction(phoneDigits: string): string | null {
  const key = phoneKey(phoneDigits);
  if (!key) return null;
  const hit = cache.get(key);
  cache.delete(key);
  if (!hit || Date.now() - hit.at > TTL_MS) return null;
  return hit.instruction;
}
