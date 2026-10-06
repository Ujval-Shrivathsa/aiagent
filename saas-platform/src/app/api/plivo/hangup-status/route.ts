import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { alegFetchStats } from '../hangup/route';
import { aggregateRecent, recentCalls } from '@/voice/call-telemetry';

export const dynamic = 'force-dynamic';

/**
 * WHY THIS EXISTS
 *
 * "The agent never ends the call" was unfixable from inside the app: a hangup
 * request that Plivo rejects, one it accepts but never executes, and one it
 * executes look identical from the server, and the host's logs are not
 * readable. So the facts are published here instead, where a caller can read
 * them:
 *
 *   1. THIS ENDPOINT EXISTING proves the new build is deployed (404 otherwise),
 *      which every other diagnostic silently lacked.
 *   2. `aleg.count` is incremented by Plivo ITSELF, each time it fetches the
 *      <Hangup/> XML. Zero across a completed call means the request never
 *      reached Plivo at all — wrong account, wrong id, or bad credentials. A
 *      non-zero count means Plivo DID execute our XML and the leg survived it,
 *      which is a completely different bug with a different fix.
 *   3. `authIdHash` is a SHA-256 prefix of the Plivo auth id configured HERE.
 *      The auth TOKEN is never exposed. Hashing lets the caller compare this
 *      server's Plivo account against the one actually placing the calls
 *      without publishing the credential itself — a mismatch makes every
 *      hangup a 404 against a call the account does not own.
 *
 * Read-only, and it returns no secret.
 */
export async function GET() {
  const stats = alegFetchStats();
  // What the live agent last did about ending a call. Without this, "the
  // trigger never fired" and "Plivo refused every spelling" looked identical.
  const hangup = (globalThis as any).__plivoHangup || null;
  const authId = process.env.PLIVO_AUTH_ID || '';
  const authIdHash = authId
    ? crypto.createHash('sha256').update(authId).digest('hex').slice(0, 12)
    : '';
  return NextResponse.json({
    build: 'hangup-status/7',
    now: new Date().toISOString(),
    aleg: stats,
    hangup,
    // Per-call conversational evidence: counts and millisecond latencies only.
    // No name, no number, no transcript (see call-telemetry.ts). This is how
    // "was there dead air / did we talk over them / was the goodbye rescued"
    // becomes a measurement instead of an opinion.
    telemetry: {
      aggregate: aggregateRecent(),
      recent: recentCalls().slice(0, 5),
    },
    plivo: {
      authIdConfigured: Boolean(authId),
      authTokenConfigured: Boolean(process.env.PLIVO_AUTH_TOKEN),
      authIdHash,
    },
    publicBase: {
      voiceServerUrlConfigured: Boolean(process.env.VOICE_SERVER_URL),
      appUrlConfigured: Boolean(process.env.APP_URL),
    },
  });
}