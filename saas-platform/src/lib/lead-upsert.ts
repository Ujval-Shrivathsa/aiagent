import { prisma } from '@/lib/prisma';
import { LEAD_STATUS, OUTCOME_UNKNOWN } from '@/lib/lead-status';

export const DEFAULT_CAMPAIGN_ID = 'default-campaign';

export function normalizePhoneE164(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (digits.startsWith('0') && digits.length === 11) return `+91${digits.slice(1)}`;
  return digits ? `+${digits}` : '';
}

export function phoneTail(phone: string): string {
  return phone.replace(/\D/g, '').slice(-10);
}

async function ensureCampaign(campaignId: string): Promise<void> {
  try {
    await prisma.campaign.upsert({
      where: { id: campaignId },
      update: {},
      create: {
        id: campaignId,
        name: 'My First Campaign',
        user: { connect: { email: 'avacadonujval@gmail.com' } },
      },
    });
  } catch {
    const firstUser = await prisma.user.findFirst();
    if (firstUser) {
      await prisma.campaign.upsert({
        where: { id: campaignId },
        update: {},
        create: { id: campaignId, name: 'My First Campaign', userId: firstUser.id },
      });
    }
  }
}

export type EnsureLeadOptions = {
  phone: string;
  name?: string;
  campaignId?: string;
  calledFrom?: string;
  callStatus?: string;
  data?: Record<string, unknown>;
};

/**
 * Find or create a lead for an outbound/test call so summaries and statuses persist.
 */
export async function ensureLeadForCall(opts: EnsureLeadOptions) {
  const campaignId = opts.campaignId || DEFAULT_CAMPAIGN_ID;
  const e164 = normalizePhoneE164(opts.phone);
  const tail = phoneTail(e164);
  if (!tail) return null;

  await ensureCampaign(campaignId);

  const existing = await prisma.lead.findFirst({
    where: { phone: { contains: tail }, campaignId },
    orderBy: { createdAt: 'desc' },
  });

  const now = new Date();
  const name =
    opts.name?.trim() &&
    !['customer', 'contact', 'lead', 'unknown'].includes(opts.name.trim().toLowerCase())
      ? opts.name.trim()
      : undefined;

  const patch: Record<string, unknown> = {
    lastCalledAt: now,
    ...(opts.calledFrom ? { calledFrom: opts.calledFrom } : {}),
    ...(name ? { name } : {}),
    ...opts.data,
  };

  if (existing) {
    return prisma.lead.update({
      where: { id: existing.id },
      data: patch,
    });
  }

  return prisma.lead.create({
    data: {
      name: name || 'Unknown',
      phone: e164,
      campaignId,
      status: opts.callStatus || LEAD_STATUS.CALLING,
      callStatus: opts.callStatus || LEAD_STATUS.CALLING,
      outcomeStatus: OUTCOME_UNKNOWN,
      calledFrom: opts.calledFrom || null,
      lastCalledAt: now,
      ...opts.data,
    },
  });
}

export function outboundCallerId(): string | undefined {
  return process.env.PLIVO_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined;
}
