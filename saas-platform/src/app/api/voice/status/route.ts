import { NextResponse } from 'next/server';
import { applyProviderTerminalStatus, markAnsweredByPhone } from '@/lib/lead-status-transitions';
import { LEAD_STATUS } from '@/lib/lead-status';

export async function GET() {
  return new NextResponse('Priya Status Link is LIVE! 🚀', {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  });
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const CallStatus = String(formData.get('CallStatus') || '');
    const To = String(formData.get('To') || '');
    const CallSid = String(formData.get('CallSid') || '');
    const CallDuration = formData.get('CallDuration') ?? formData.get('Duration');
    const durationSec = CallDuration != null && CallDuration !== '' ? Number(CallDuration) : null;

    console.log(`[Dashboard Status Sync] Call: ${CallSid} | To: ${To} | Status: ${CallStatus}`);

    if (!To) {
      return NextResponse.json({ success: true });
    }

    const status = CallStatus.toLowerCase();

    if (status === 'ringing' || status === 'initiated' || status === 'queued') {
      // Keep / ensure calling — campaign start already sets this.
      return NextResponse.json({ success: true });
    }

    if (status === 'in-progress' || status === 'answered') {
      const r = await markAnsweredByPhone(To);
      console.log(`[Dashboard Update] → ${LEAD_STATUS.ANSWERED} rows=${r.count}`);
      return NextResponse.json({ success: true });
    }

    if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(status)) {
      const r = await applyProviderTerminalStatus(To, {
        providerStatus: CallStatus,
        durationSec: Number.isFinite(durationSec as number) ? (durationSec as number) : null,
        wasAnswered: status === 'completed' && durationSec != null && durationSec > 0,
      });
      console.log(`[Dashboard Update] → ${r.mapped} rows=${r.count} (idempotent)`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Dashboard Status Error]:', error);
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}
