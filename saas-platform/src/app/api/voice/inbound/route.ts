import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const host = req.headers.get('host') || process.env.APP_URL?.replace('https://', '') || '';
  const wsHost = host;

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${wsHost}/media-stream">
      <Parameter name="isOutbound" value="false" />
    </Stream>
  </Connect>
</Response>`;

  return new NextResponse(twiml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}

export async function GET() {
  return new NextResponse('Priya Inbound Voice Endpoint LIVE 🚀', {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  });
}
