import { NextResponse } from 'next/server';
import { callLog } from '@/voice/call-capture/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Live-call transfer destination for the INTERESTED handoff.
 * When logic.ts hits the sales-team handoff step, it re-points the customer
 * leg (A-leg) at this URL via Plivo's transfer API. The AI <Stream> is
 * replaced by a <Dial> that bridges the caller to PLIVO_TRANSFER_NUMBER.
 */
export async function POST(req: Request) {
  const transferTo = (process.env.PLIVO_TRANSFER_NUMBER || '').replace(/\D/g, '');
  const callerId = process.env.PLIVO_PHONE_NUMBER || '';

  if (!transferTo) {
    callLog('CALL', 'TRANSFER skipped — PLIVO_TRANSFER_NUMBER not set');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Hangup />
</Response>`;
    return new NextResponse(xml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  }

  callLog('CALL', `SALES-TEAM TRANSFER dialing=${transferTo}`);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${callerId}" timeout="30" action="/api/plivo/transfer-status" method="POST">
    <Number>${transferTo}</Number>
  </Dial>
</Response>`;

  return new NextResponse(xml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}

export async function GET() {
  return new NextResponse('Plivo sales-team transfer endpoint', { status: 200 });
}
