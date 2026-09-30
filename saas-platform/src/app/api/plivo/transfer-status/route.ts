import { NextResponse } from 'next/server';
import { callLog } from '@/voice/call-capture/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Plivo posts here when the sales-team <Dial> from transfer-answer finishes
 * (answered / busy / no-answer). Marks the lead INTERESTED (warm transfer
 * happened) and disconnects the remaining leg.
 */
export async function POST(req: Request) {
  let dialStatus = '';
  try {
    const fd = await req.formData();
    dialStatus = String(fd.get('DialStatus') || fd.get('dialStatus') || '');
  } catch {
    // query params fallback
    const url = new URL(req.url);
    dialStatus = url.searchParams.get('DialStatus') || '';
  }

  callLog('CALL', `SALES-TEAM TRANSFER result=${dialStatus || 'unknown'}`);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Hangup />
</Response>`;
  return new NextResponse(xml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}
