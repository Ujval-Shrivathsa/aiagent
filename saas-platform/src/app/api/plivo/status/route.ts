import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const callUuid = String(formData.get('CallUUID') || formData.get('CallSid') || '');
    const to = String(formData.get('To') || formData.get('to') || '');
    const hangupCause = String(formData.get('HangupCause') || formData.get('CallStatus') || '');

    console.log(`[Plivo Hangup] Call: ${callUuid} | To: ${to} | Cause: ${hangupCause}`);

    if (to) {
      const cleanTo = to.replace(/\D/g, '');
      await prisma.lead.updateMany({
        where: {
          phone: { contains: cleanTo.slice(-10) },
          status: 'calling',
        },
        data: { status: hangupCause.toLowerCase() === 'completed' ? 'call ended' : 'failed' },
      }).catch(() => {});
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Plivo Hangup] Error:', error);
    return NextResponse.json({ success: true });
  }
}

export async function GET() {
  return new NextResponse('Plivo hangup endpoint', { status: 200 });
}
