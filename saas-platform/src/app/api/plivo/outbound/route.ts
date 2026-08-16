import { NextResponse } from 'next/server';

function wsHostFromRequest(req: Request): string {
  const fromEnv = (process.env.APP_URL || process.env.VOICE_SERVER_URL || '')
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
  const fromHeader = (req.headers.get('host') || '').replace(/\/$/, '');
  return fromEnv || fromHeader;
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

  const headers = [
    'isOutbound=true',
    `customerPhone=${encodeURIComponent(customerPhone)}`,
    `customerName=${encodeURIComponent(customerName)}`,
  ].join(',');

  const wsHost = wsHostFromRequest(req);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-mulaw;rate=8000" extraHeaders="${headers}">
    wss://${wsHost}/media-stream
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
