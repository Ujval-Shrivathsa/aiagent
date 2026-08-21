import { NextResponse } from 'next/server';
import { callLog } from '@/voice/call-capture/logger';
import { applyProviderTerminalStatus, markAnsweredByPhone } from '@/lib/lead-status-transitions';
import { LEAD_STATUS } from '@/lib/lead-status';

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const callUuid = String(formData.get('CallUUID') || formData.get('CallSid') || '');
    const to = String(formData.get('To') || formData.get('to') || '');
    const from = String(formData.get('From') || formData.get('from') || '');
    const hangupCause = String(formData.get('HangupCause') || '');
    const event = String(formData.get('Event') || formData.get('CallStatus') || formData.get('event') || '');
    const durationRaw = String(formData.get('Duration') || formData.get('BillDuration') || '');
    const durationSec = durationRaw ? Number(durationRaw) : null;

    const ev = event.toLowerCase();
    if (ev.includes('ring')) {
      callLog('CALL', `CALL RINGING  uuid=${callUuid} to=${to}`);
      // Stay on `calling` — initiated but not answered yet.
    } else if (ev.includes('answer') || ev.includes('startapp')) {
      callLog('CALL', `CALL ANSWERED  uuid=${callUuid} to=${to}`);
      if (to) {
        const r = await markAnsweredByPhone(to);
        callLog('CALL', `STATUS → ${LEAD_STATUS.ANSWERED} updated=${r.count}`);
      }
    } else if (hangupCause || ev.includes('hangup') || ev.includes('complete')) {
      callLog(
        'CALL',
        `CALL ENDED (plivo)  uuid=${callUuid} to=${to} cause=${hangupCause || event} duration=${durationRaw || 'n/a'}`
      );
      if (to) {
        const r = await applyProviderTerminalStatus(to, {
          providerStatus: event,
          hangupCause,
          durationSec: Number.isFinite(durationSec as number) ? (durationSec as number) : null,
          // Plivo hangup without a prior answer event: treat 0-duration as unanswered.
          wasAnswered: durationSec != null && durationSec > 0 ? true : false,
        });
        callLog('CALL', `STATUS → ${r.mapped} updated=${r.count} (idempotent)`);
      }
    } else {
      callLog('CALL', `CALL EVENT  event=${event || 'unknown'} uuid=${callUuid} from=${from} to=${to}`);
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
