import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { callLog } from '@/voice/call-capture/logger';

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const callUuid = String(formData.get('CallUUID') || formData.get('CallSid') || '');
    const to = String(formData.get('To') || formData.get('to') || '');
    const from = String(formData.get('From') || formData.get('from') || '');
    const hangupCause = String(formData.get('HangupCause') || '');
    const event = String(formData.get('Event') || formData.get('CallStatus') || formData.get('event') || '');
    const duration = String(formData.get('Duration') || formData.get('BillDuration') || '');

    const ev = event.toLowerCase();
    if (ev.includes('ring')) {
      callLog('CALL', `CALL RINGING  uuid=${callUuid} to=${to}`);
    } else if (ev.includes('answer') || ev.includes('startapp')) {
      callLog('CALL', `CALL ANSWERED  uuid=${callUuid} to=${to}`);
    } else if (hangupCause || ev.includes('hangup') || ev.includes('complete')) {
      callLog('CALL', `CALL ENDED (plivo)  uuid=${callUuid} to=${to} cause=${hangupCause || event} duration=${duration || 'n/a'}`);
    } else {
      callLog('CALL', `CALL EVENT  event=${event || 'unknown'} uuid=${callUuid} from=${from} to=${to}`);
    }

    if (to) {
      const cleanTo = to.replace(/\D/g, '');
      await prisma.lead.updateMany({
        where: {
          phone: { contains: cleanTo.slice(-10) },
          status: 'calling',
        },
        data: { status: hangupCause.toLowerCase() === 'completed' || hangupCause === 'NORMAL_CLEARING' ? 'call ended' : 'failed' },
      }).catch(() => {});
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    callLog('ERROR', `PLIVO WEBHOOK ERROR: ${error instanceof Error ? error.message : String(error)}`);
    return NextResponse.json({ success: true });
  }
}

export async function GET() {
  return new NextResponse('Plivo hangup endpoint', { status: 200 });
}
