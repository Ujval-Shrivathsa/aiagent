import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  return new NextResponse('Priya Status Link is LIVE! 🚀', {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  });
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const CallStatus = formData.get('CallStatus') as string;
    const To = formData.get('To') as string;
    const CallSid = formData.get('CallSid') as string;

    console.log(`[Dashboard Status Sync] Call: ${CallSid} | To: ${To} | Status: ${CallStatus}`);

    if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(CallStatus)) {
      const status = CallStatus === 'completed' ? 'call ended' : 'failed';
      
      const cleanTo = To.replace(' ', '');
      
      const result = await prisma.lead.updateMany({
        where: { 
          phone: { contains: cleanTo.replace('+', '') },
          status: 'calling' 
        },
        data: { status }
      });
      
      console.log(`[Dashboard Update] Sync success: ${result.count} rows.`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Dashboard Status Error]:", error);
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}
