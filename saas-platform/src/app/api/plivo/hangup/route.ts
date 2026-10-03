import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

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
export async function GET() {
  return new NextResponse(
    '<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Hangup />\n</Response>',
    { status: 200, headers: { 'Content-Type': 'text/xml' } },
  );
}

export async function POST() {
  return GET();
}