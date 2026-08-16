import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  return new NextResponse('Priya Recording Endpoint LIVE 🎧', {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  });
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const callSid = formData.get('CallSid') as string;
    const recordingUrl = formData.get('RecordingUrl') as string;
    const to = formData.get('To') as string;

    console.log(`[Twilio Recording] CallSid: ${callSid}, RecordingUrl: ${recordingUrl}, To: ${to}`);

    if (recordingUrl && to) {
      const cleanPhone = to.replace(/\D/g, '');
      await prisma.lead.updateMany({
        where: { phone: { contains: cleanPhone.slice(-10) } },
        data: { recordingUrl: `${recordingUrl}.mp3` } // Appending .mp3 for direct playback
      });
      console.log(`[DB] Recording URL saved for ${to}`);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Recording Callback Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
