import { NextResponse } from 'next/server';

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
  const safeName = customerName.replace(/[^a-zA-Z0-9]/g, '').slice(0, 40);
  const headers = [
    'isOutbound=true',
    phoneDigits ? `customerPhone=${phoneDigits}` : '',
    safeName ? `customerName=${safeName}` : '',
  ].filter(Boolean).join(';');

  const wsHost = wsHostFromRequest(req);
  const streamQuery = new URLSearchParams({
    isOutbound: 'true',
    ...(phoneDigits ? { customerPhone: phoneDigits } : {}),
    ...(customerName ? { customerName } : {}),
  }).toString();
  const streamUrl = `wss://${wsHost}/media-stream?${streamQuery}`;

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
