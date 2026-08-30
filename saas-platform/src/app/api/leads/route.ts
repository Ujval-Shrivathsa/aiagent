import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  isLeadStatus,
  isCallStatus,
  isOutcomeStatus,
  LEAD_STATUS,
  normalizeLeadStatus,
  serializeLeadStatusFields,
  dualFieldsForTransition,
} from '@/lib/lead-status';
import { transitionLeadById, setDualStatusById } from '@/lib/lead-status-transitions';

export const dynamic = "force-dynamic";
// We'll use a simple verify middleware later, for now we assume session is handled by cookies
// In a real app, you'd verify the auth_token here.

export async function POST(req: Request) {
  try {
    const { name, phone, campaignId } = await req.json();

    if (!name || !phone || !campaignId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // SQLite retry logic for POST
    let retries = 5;
    let lead;
    while (retries > 0) {
      try {
        // Ensure campaign exists before adding a lead
        await prisma.campaign.upsert({
          where: { id: campaignId },
          update: {},
          create: {
            id: campaignId,
            name: "My First Campaign",
            user: { connect: { email: "avacadonujval@gmail.com" } } 
          }
        }).catch(async () => {
             const firstUser = await prisma.user.findFirst();
             if(firstUser) {
                 await prisma.campaign.upsert({
                    where: { id: campaignId },
                    update: {},
                    create: { id: campaignId, name: "My First Campaign", userId: firstUser.id }
                 });
             }
        });

        lead = await prisma.lead.create({
          data: {
            name,
            phone,
            campaignId,
            status: LEAD_STATUS.PENDING,
            callStatus: LEAD_STATUS.PENDING,
            outcomeStatus: 'unknown',
          },
        });
        break;
      } catch (e: any) {
        if (e.code === 'P1008' || e.code === 'P2010' || e.message?.includes('busy') || e.message?.includes('locked')) {
          retries--;
          if (retries === 0) throw e;
          await new Promise(r => setTimeout(r, 500));
          continue;
        }
        throw e;
      }
    }

    return NextResponse.json({ success: true, lead: serializeLeadStatusFields(lead as any) });
  } catch (error: any) {
    console.error("[API/LEADS] Error:", error);
    return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const campaignId = searchParams.get('campaignId');
    const includeInterested = searchParams.get('includeInterested') === 'true';

    if (id) {
      const lead = await prisma.lead.findUnique({ where: { id } });
      if (!lead) {
        return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });
      }
      return NextResponse.json({
        success: true,
        lead: serializeLeadStatusFields(lead as any),
      });
    }

    if (!campaignId) {
      return NextResponse.json({ error: 'Missing campaignId' }, { status: 400 });
    }

    // SQLite retry logic for GET
    let retries = 5;
    let leads;
    let interestedLeads: Awaited<ReturnType<typeof prisma.lead.findMany>> = [];
    while (retries > 0) {
      try {
        leads = await prisma.lead.findMany({
          where: { campaignId },
          orderBy: { createdAt: 'desc' },
        });

        if (includeInterested) {
          interestedLeads = leads.filter((l) => {
            const serialized = serializeLeadStatusFields(l as any);
            return (
              l.interested === true ||
              serialized.outcome_status === LEAD_STATUS.INTERESTED ||
              serialized.outcome_status === LEAD_STATUS.FOLLOW_UP ||
              serialized.outcome_status === LEAD_STATUS.VISIT_SCHEDULED
            );
          });
        }
        break;
      } catch (e: any) {
        if (e.code === 'P1008' || e.code === 'P2010' || e.message?.includes('busy') || e.message?.includes('locked')) {
          retries--;
          if (retries === 0) {
            console.error("[API/LEADS] GET: SQLite timed out after 5 retries.");
            throw e;
          }
          console.log(`[API/LEADS] GET busy, retrying... (${retries} left)`);
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }
        throw e;
      }
    }

    const serializedLeads = (leads || []).map((l) => serializeLeadStatusFields(l as any));
    const serializedInterested = interestedLeads.map((l) => serializeLeadStatusFields(l as any));

    return NextResponse.json({ 
      success: true, 
      leads: serializedLeads, 
      interestedLeads: includeInterested ? serializedInterested : undefined 
    });
  } catch (error: any) {
    console.error("[API/LEADS] GET Error:", error);
    return NextResponse.json({ 
      success: false, 
      error: 'Internal server error', 
      details: error.message,
      code: error.code 
    }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Missing lead id' }, { status: 400 });
    }

    // SQLite can be busy, simple retry
    let retries = 5;
    while (retries > 0) {
      try {
        await prisma.lead.delete({
          where: { id }
        });
        break;
      } catch (e: any) {
        if (e.code === 'P1008' || e.code === 'P2010' || e.message?.includes('busy') || e.message?.includes('locked')) {
          retries--;
          if (retries === 0) throw e;
          console.log(`[API/LEADS] DELETE busy, retrying... (${retries} left)`);
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }
        throw e;
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[API/LEADS] Delete Error:", error);
    return NextResponse.json({ success: false, error: 'Internal server error', details: error.message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const {
      id,
      interested,
      status,
      call_status,
      outcome_status,
      callStatus,
      outcomeStatus,
    } = body;

    if (!id) {
      return NextResponse.json({ error: 'Missing lead id' }, { status: 400 });
    }

    const nextCall = call_status ?? callStatus;
    const nextOutcome = outcome_status ?? outcomeStatus;

    if (status !== undefined && !isLeadStatus(String(status))) {
      return NextResponse.json({ error: `Invalid status: ${status}` }, { status: 400 });
    }
    if (nextCall !== undefined && !isCallStatus(String(nextCall))) {
      return NextResponse.json({ error: `Invalid call_status: ${nextCall}` }, { status: 400 });
    }
    if (nextOutcome !== undefined && !isOutcomeStatus(String(nextOutcome))) {
      return NextResponse.json({ error: `Invalid outcome_status: ${nextOutcome}` }, { status: 400 });
    }

    // SQLite retry logic for PATCH
    let retries = 5;
    while (retries > 0) {
      try {
        if (nextCall !== undefined || nextOutcome !== undefined) {
          await setDualStatusById(id, {
            callStatus: nextCall,
            outcomeStatus: nextOutcome,
          });
          if (interested !== undefined) {
            await prisma.lead.update({ where: { id }, data: { interested } });
          }
        } else if (status !== undefined) {
          const dual = dualFieldsForTransition(normalizeLeadStatus(status));
          const r = await transitionLeadById(id, normalizeLeadStatus(status), {
            ...(interested !== undefined ? { interested } : {}),
            callStatus: dual.callStatus,
            outcomeStatus: dual.outcomeStatus,
          });
          if (!r.ok && r.count === 0) {
            await prisma.lead.update({
              where: { id },
              data: {
                status: normalizeLeadStatus(status),
                callStatus: dual.callStatus,
                outcomeStatus: dual.outcomeStatus,
                ...(interested !== undefined ? { interested } : {}),
              },
            });
          }
        } else {
          const data: Record<string, unknown> = {};
          if (interested !== undefined) data.interested = interested;
          await prisma.lead.update({ where: { id }, data });
        }
        break;
      } catch (e: any) {
        if (e.code === 'P1008' || e.code === 'P2010' || e.message?.includes('busy') || e.message?.includes('locked')) {
          retries--;
          if (retries === 0) throw e;
          console.log(`[API/LEADS] PATCH busy, retrying... (${retries} left)`);
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }
        throw e;
      }
    }

    const updated = await prisma.lead.findUnique({ where: { id } });
    return NextResponse.json({
      success: true,
      lead: updated ? serializeLeadStatusFields(updated as any) : undefined,
    });
  } catch (error: any) {
    console.error("[API/LEADS] PATCH Error:", error);
    return NextResponse.json({ success: false, error: 'Internal server error', details: error.message }, { status: 500 });
  }
}
