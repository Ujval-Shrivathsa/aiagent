import { NextResponse } from 'next/server';
import { callLog } from '@/voice/call-capture/logger';

function wsHostFromRequest(req: Request): string {
  const fromEnv = (process.env.APP_URL || process.env.VOICE_SERVER_URL || '')
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
  const fromHeader = (req.headers.get('host') || '').replace(/\/$/, '');
  return fromEnv || fromHeader;
}

export async function POST(req: Request) {
  const wsHost = wsHostFromRequest(req);
  callLog('CALL', 'CALL ANSWERED  inbound');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-mulaw;rate=8000" extraHeaders="isOutbound=false">
    wss://${wsHost}/media-stream?isOutbound=false
  </Stream>
</Response>`;

  return new NextResponse(xml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}

export async function GET() {
  return new NextResponse('Plivo inbound answer endpoint', { status: 200 });
}
