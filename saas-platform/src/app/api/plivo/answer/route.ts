import { NextResponse } from 'next/server';
import { callLog } from '@/voice/call-capture/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  // Outbound-only product: nobody should be calling this number in.
  // Politely hang up instead of opening an AI stream.
  callLog('CALL', 'CALL ANSWERED  inbound — hanging up (outbound-only number)');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Hangup />
</Response>`;

  return new NextResponse(xml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}

export async function GET() {
  return new NextResponse('Plivo inbound answer endpoint', { status: 200 });
}
