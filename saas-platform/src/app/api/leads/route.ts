import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

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
        }).catch(async (e) => {
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

    return NextResponse.json({ success: true, lead });
  } catch (error: any) {
    console.error("[API/LEADS] Error:", error);
    return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const campaignId = searchParams.get('campaignId');
    const includeInterested = searchParams.get('includeInterested') === 'true';

    if (!campaignId) {
      return NextResponse.json({ error: 'Missing campaignId' }, { status: 400 });
    }

    // SQLite retry logic for GET
    let retries = 5;
    let leads;
    let interestedLeads = [];
    while (retries > 0) {
      try {
        leads = await prisma.lead.findMany({
          where: { campaignId },
          orderBy: { createdAt: 'desc' },
        });

        if (includeInterested) {
          interestedLeads = leads.filter(l => l.interested);
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

    return NextResponse.json({ 
      success: true, 
      leads, 
      interestedLeads: includeInterested ? interestedLeads : undefined 
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
    const { id, interested, status } = await req.json();

    if (!id) {
      return NextResponse.json({ error: 'Missing lead id' }, { status: 400 });
    }

    // SQLite retry logic for PATCH
    let retries = 5;
    while (retries > 0) {
      try {
        const data: any = {};
        if (interested !== undefined) data.interested = interested;
        if (status !== undefined) data.status = status;

        await prisma.lead.update({
          where: { id },
          data,
        });
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

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[API/LEADS] PATCH Error:", error);
    return NextResponse.json({ success: false, error: 'Internal server error', details: error.message }, { status: 500 });
  }
}
