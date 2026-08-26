import { NextResponse } from 'next/server';
import { callLog } from '@/voice/call-capture/logger';
import { cacheOutboundOpeningInstruction } from '@/voice/opening-prewarm-cache';

function wsHostFromRequest(req: Request): string {
  const fromEnv = (process.env.APP_URL || process.env.VOICE_SERVER_URL || '')
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
  const fromHeader = (req.headers.get('host') || '').replace(/\/$/, '');
  return fromEnv || fromHeader;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  let customerName = url.searchParams.get('customerName') || '';
  let customerPhone = url.searchParams.get('customerPhone') || '';

  try {
    const formData = await req.formData();
    if (!customerPhone) {
      customerPhone = String(formData.get('To') || formData.get('to') || '');
    }
    if (!customerName) {
      customerName = String(formData.get('customerName') || '');
    }
  } catch {
    // query params only
  }

  const phoneDigits = customerPhone.replace(/\D/g, '');
  // Keep the real name for Stream headers (spaces → underscore so Plivo parses ok).
  const headerName = customerName.trim().replace(/\s+/g, '_').slice(0, 60);
  const headers = [
    'isOutbound=true',
    phoneDigits ? `customerPhone=${phoneDigits}` : '',
    headerName ? `customerName=${headerName}` : '',
  ].filter(Boolean).join(';');

  const wsHost = wsHostFromRequest(req);
  const streamQuery = new URLSearchParams({
    isOutbound: 'true',
    ...(phoneDigits ? { customerPhone: phoneDigits } : {}),
    ...(customerName.trim() ? { customerName: customerName.trim() } : {}),
  }).toString();
  if (phoneDigits) {
    try {
      cacheOutboundOpeningInstruction(phoneDigits, headerName.replace(/_/g, ' ') || customerName.trim());
    } catch (e) {
      console.warn('[plivo/outbound] Opening instruction pre-cache failed:', e);
    }
  }
  const streamUrl = `wss://${wsHost}/media-stream?${streamQuery}`;
  callLog('CALL', `CALL ANSWERED  outbound to=+${phoneDigits || customerPhone}`);

  // Answer URL fires only when the callee picks up → calling → answered.
  if (phoneDigits) {
    try {
      const { markAnsweredByPhone } = await import('@/lib/lead-status-transitions');
      await markAnsweredByPhone(phoneDigits);
    } catch (e) {
      console.error('[plivo/outbound] Failed to mark answered:', e);
    }
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-mulaw;rate=8000" extraHeaders="${xmlEscape(headers)}">
    ${xmlEscape(streamUrl)}
  </Stream>
</Response>`;

  return new NextResponse(xml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}

export async function GET() {
  return new NextResponse('Plivo outbound answer endpoint', { status: 200 });
}
