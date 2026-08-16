import { NextResponse } from 'next/server';
import twilio from 'twilio';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

function toE164(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (digits.startsWith('0') && digits.length === 11) return `+91${digits.slice(1)}`;
  return `+${digits}`;
}

const SKIP_STATUSES = ['calling', 'visit scheduled', 'scheduled visit'];

export async function POST(req: Request) {
  try {
    const { campaignId } = await req.json();
    if (!campaignId) {
      return NextResponse.json({ error: 'Missing campaignId' }, { status: 400 });
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER_FALLBACK;
    const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');

    if (!accountSid || !authToken || !from) {
      return NextResponse.json({ error: 'Twilio is not configured on the server' }, { status: 500 });
    }
    if (!appUrl || appUrl.includes('localhost')) {
      return NextResponse.json({
        error: 'APP_URL must be your public ngrok URL so Twilio can reach the outbound agent',
      }, { status: 500 });
    }

    const leads = await prisma.lead.findMany({
      where: {
        campaignId,
        status: { notIn: SKIP_STATUSES },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (leads.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No dialable leads. Add a lead, or wait until a call in progress finishes.',
        called: 0,
      }, { status: 400 });
    }

    const client = twilio(accountSid, authToken);
    const results: { id: string; phone: string; ok: boolean; error?: string }[] = [];

    for (const lead of leads) {
      const to = toE164(lead.phone);
      const url =
        `${appUrl}/api/voice/outbound` +
        `?customerName=${encodeURIComponent(lead.name || '')}` +
        `&customerPhone=${encodeURIComponent(to)}`;

      try {
        await prisma.lead.update({
          where: { id: lead.id },
          data: { status: 'calling' },
        });

        await client.calls.create({
          to,
          from,
          url,
          statusCallback: `${appUrl}/api/voice/status`,
          statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
          record: true,
        });

        results.push({ id: lead.id, phone: to, ok: true });
      } catch (err: any) {
        const message = err?.message || String(err);
        console.error(`[campaign/start] Failed ${to}: ${message}`);
        await prisma.lead.update({
          where: { id: lead.id },
          data: { status: 'failed' },
        }).catch(() => {});
        results.push({ id: lead.id, phone: to, ok: false, error: message });
      }
    }

    const called = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok);

    return NextResponse.json({
      success: called > 0,
      called,
      failed: failed.length,
      results,
      error: called === 0 ? (failed[0]?.error || 'All calls failed') : undefined,
    }, { status: called > 0 ? 200 : 502 });
  } catch (error: any) {
    console.error('[campaign/start]', error);
    return NextResponse.json({ error: error.message || 'Failed to start campaign' }, { status: 500 });
  }
}
