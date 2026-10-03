import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Every time Plivo fetches this endpoint it is PROOF that a hangup request
 * reached Plivo and Plivo went and executed our XML. The failure we have been
 * chasing is invisible from inside the app — a rejected request and an accepted
 * request both look like success from here — so the fetch itself is the signal,
 * and it can be read from outside without access to the host's logs.
 */
export function noteAlegFetch(source: string) {
  const g = globalThis as any;
  g.__plivoAlegFetches = (g.__plivoAlegFetches || 0) + 1;
  g.__plivoAlegLastAt = Date.now();
  g.__plivoAlegLastSource = source;
}

export function alegFetchStats() {
  const g = globalThis as any;
  return {
    count: Number(g.__plivoAlegFetches || 0),
    lastAt: Number(g.__plivoAlegLastAt || 0),
    lastSource: String(g.__plivoAlegLastSource || ''),
  };
}

/**
 * The XML Plivo fetches to actually terminate a call leg.
 *
 * Plivo's Hangup API does NOT accept `{status:"hangup"}` — that form is
 * rejected with `400 "aleg_url must be present"`. It requires `aleg_url`, a URL
 * whose response body is executed as Plivo XML; the only instruction that ends
 * the call is <Hangup/>.
 *
 * This endpoint therefore has to exist, be publicly reachable, and return the
 * <Hangup/> element, or the agent can never end a call. It is fetched by Plivo,
 * not by the browser, so it is deliberately unauthenticated.
 */
const HANGUP_XML = '<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Hangup />\n</Response>';

function hangupXml() {
  return new NextResponse(HANGUP_XML, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}

export async function GET() {
  noteAlegFetch('GET');
  return hangupXml();
}

export async function POST() {
  noteAlegFetch('POST');
  return hangupXml();
}