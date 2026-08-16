import { NextResponse } from 'next/server';

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function POST(req: Request) {
  const host = req.headers.get('host') || process.env.APP_URL?.replace('https://', '') || '';
  const wsHost = host;
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
    // Query params only (e.g. GET-style or JSON webhook)
  }

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${wsHost}/media-stream">
      <Parameter name="isOutbound" value="true" />
      <Parameter name="customerName" value="${xmlEscape(customerName)}" />
      <Parameter name="customerPhone" value="${xmlEscape(customerPhone)}" />
    </Stream>
  </Connect>
</Response>`;

  return new NextResponse(twiml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}

export async function GET() {
  return new NextResponse('Priya Outbound Voice Endpoint LIVE', {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  });
}
