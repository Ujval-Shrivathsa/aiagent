import { NextResponse } from 'next/server';
import { LEAD_STATUS } from '@/lib/lead-status';
import { ensureLeadForCall, outboundCallerId } from '@/lib/lead-upsert';
import { serializeLeadStatusFields } from '@/lib/lead-status';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { phone, name, campaignId, calledFrom, callStatus } = body;

    if (!phone) {
      return NextResponse.json({ error: 'Missing phone' }, { status: 400 });
    }

    const lead = await ensureLeadForCall({
      phone,
      name,
      campaignId,
      calledFrom: calledFrom || outboundCallerId(),
      callStatus: callStatus || LEAD_STATUS.CALLING,
    });

    return NextResponse.json({
      success: true,
      lead: lead ? serializeLeadStatusFields(lead as Record<string, unknown>) : null,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[API/LEADS/ENSURE] Error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
