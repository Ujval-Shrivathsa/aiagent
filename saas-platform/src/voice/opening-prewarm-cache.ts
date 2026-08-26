/**
 * Cache outbound system instructions when Plivo answer URL fires (callee picked up)
 * so the media-stream handler can skip rebuild latency on connect.
 */
import { resolveCustomerIdentity } from './customer-identity/resolve-identity';
import { buildOutboundSystemInstruction } from './Outbound/callguide';

type CachedOpening = {
  instruction: string;
  at: number;
};

const cache = new Map<string, CachedOpening>();
const TTL_MS = 90_000;

function phoneKey(phoneDigits: string): string {
  return phoneDigits.replace(/\D/g, '').slice(-10);
}

export function cacheOutboundOpeningInstruction(phoneDigits: string, customerName: string): void {
  const key = phoneKey(phoneDigits);
  if (!key) return;
  const name = customerName.trim();
  const blacklisted = ['customer', 'contact', 'lead', 'unknown', 'null', 'undefined', 'unnamed', ''];
  const identity =
    name && !blacklisted.includes(name.toLowerCase())
      ? resolveCustomerIdentity({ rawName: name.replace(/_/g, ' '), source: 'campaign' })
      : null;
  const currentDateStr = new Date().toLocaleDateString('en-IN');
  cache.set(key, {
    instruction: buildOutboundSystemInstruction(currentDateStr, identity, { deferProjectReference: true }),
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
