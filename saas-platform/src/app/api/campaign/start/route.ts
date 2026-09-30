import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { callLog } from '@/voice/call-capture/logger';
import { LEAD_STATUS, SKIP_DIAL_STATUSES } from '@/lib/lead-status';
import { markCalling, transitionLeadById, releaseCallingLeadsForRedial } from '@/lib/lead-status-transitions';

export const dynamic = 'force-dynamic';

function toE164(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (digits.startsWith('0') && digits.length === 11) return `+91${digits.slice(1)}`;
  return `+${digits}`;
}

function publicVoiceUrl(): string {
  return (process.env.VOICE_SERVER_URL || process.env.APP_URL || '').replace(/\/$/, '');
}

function isUsableVoiceUrl(url: string): boolean {
  if (!/^https:\/\//i.test(url)) return false;
  const host = url.replace(/^https?:\/\//i, '').toLowerCase();
  return !host.startsWith('localhost') && !host.includes('ngrok') && !host.includes('127.0.0.1');
}

async function livePlivoPhoneTails(authId: string, authToken: string): Promise<string[]> {
  try {
    const res = await fetch(`https://api.plivo.com/v1/Account/${authId}/Call/?status=live&limit=20`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${authId}:${authToken}`).toString('base64')}`,
      },
    });
    const body = await res.json().catch(() => ({}));
    const tails = new Set<string>();
    for (const c of body.objects || []) {
      const tail = String(c.to_number || '').replace(/\D/g, '').slice(-10);
      if (tail.length === 10) tails.add(tail);
    }
    return [...tails];
  } catch {
    return [];
  }
}

export async function POST(req: Request) {
  try {
    const { campaignId } = await req.json();
    if (!campaignId) {
      return NextResponse.json({ error: 'Missing campaignId' }, { status: 400 });
    }

    const appUrl = publicVoiceUrl();
    const provider = 'plivo';

    if (!isUsableVoiceUrl(appUrl)) {
      return NextResponse.json({
        error: 'VOICE_SERVER_URL / APP_URL must be the Render HTTPS URL (not localhost or ngrok)',
      }, { status: 500 });
    }

    const liveTails =
      provider === 'plivo' && process.env.PLIVO_AUTH_ID && process.env.PLIVO_AUTH_TOKEN
        ? await livePlivoPhoneTails(process.env.PLIVO_AUTH_ID, process.env.PLIVO_AUTH_TOKEN)
        : [];
    const released = await releaseCallingLeadsForRedial(campaignId, liveTails);
    if (released > 0) {
      callLog('CALL', `Released ${released} stuck calling lead(s) before dial`);
    }

    const leads = await prisma.lead.findMany({
      where: {
        campaignId,
        status: { notIn: [...SKIP_DIAL_STATUSES, 'scheduled visit'] },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (leads.length === 0) {
      return NextResponse.json({
        success: false,
        error:
          'No dialable leads. A call may already be in progress, or add a pending lead first.',
        called: 0,
      }, { status: 400 });
    }

    const results: { id: string; phone: string; ok: boolean; error?: string }[] = [];

    for (const lead of leads) {
      const to = toE164(lead.phone);

      try {
        if (liveTails.includes(to.replace(/\D/g, '').slice(-10))) {
          results.push({ id: lead.id, phone: to, ok: false, error: 'call already in progress' });
          continue;
        }

        const callerFrom = process.env.PLIVO_PHONE_NUMBER;

        {
          const authId = process.env.PLIVO_AUTH_ID;
          const authToken = process.env.PLIVO_AUTH_TOKEN;
          const from = process.env.PLIVO_PHONE_NUMBER;
          if (!authId || !authToken || !from) {
            throw new Error('Plivo is not configured (PLIVO_AUTH_ID, PLIVO_AUTH_TOKEN, PLIVO_PHONE_NUMBER)');
          }
          const answerUrl =
            `${appUrl}/api/plivo/outbound` +
            `?customerName=${encodeURIComponent(lead.name || '')}` +
            `&customerPhone=${encodeURIComponent(to)}`;
          const plivoRes = await fetch(`https://api.plivo.com/v1/Account/${authId}/Call/`, {
            method: 'POST',
            headers: {
              Authorization: `Basic ${Buffer.from(`${authId}:${authToken}`).toString('base64')}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from,
              to,
              answer_url: answerUrl,
              answer_method: 'POST',
              hangup_url: `${appUrl}/api/plivo/status`,
              hangup_method: 'POST',
              ring_url: `${appUrl}/api/plivo/status`,
              ring_method: 'POST',
            }),
          });
          const plivoBody = await plivoRes.json().catch(() => ({}));
          if (!plivoRes.ok) {
            throw new Error(plivoBody?.error || `Plivo call failed (${plivoRes.status})`);
          }
          callLog('CALL', `CALL INITIATED  to=${to}`);
        }

        const marked = await markCalling(lead.id);
        if (!marked.ok && marked.count === 0) {
          await prisma.lead.update({
            where: { id: lead.id },
            data: {
              status: LEAD_STATUS.CALLING,
              callStatus: LEAD_STATUS.CALLING,
              lastCalledAt: new Date(),
              ...(callerFrom ? { calledFrom: callerFrom } : {}),
            },
          });
        } else if (callerFrom) {
          await prisma.lead.update({
            where: { id: lead.id },
            data: { calledFrom: callerFrom, lastCalledAt: new Date() },
          });
        }

        results.push({ id: lead.id, phone: to, ok: true });
      } catch (err: any) {
        const message = err?.message || String(err);
        console.error(`[campaign/start] Failed ${to}: ${message}`);
        await transitionLeadById(lead.id, LEAD_STATUS.FAILED).catch(() => {});
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
