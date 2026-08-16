import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { uploadToSupabaseStorage } from '@/lib/supabase';

async function copyTwilioRecordingToSupabase(twilioMp3Url: string, callSid: string): Promise<string | null> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;

  try {
    const auth = Buffer.from(`${sid}:${token}`).toString('base64');
    const res = await fetch(twilioMp3Url, { headers: { Authorization: `Basic ${auth}` } });
    if (!res.ok) {
      console.error(`[Supabase Storage] Twilio fetch failed: ${res.status}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return uploadToSupabaseStorage(`recordings/${callSid}.mp3`, buf, 'audio/mpeg');
  } catch (err: any) {
    console.error('[Supabase Storage] copy failed:', err?.message || err);
    return null;
  }
}

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
      const twilioMp3 = `${recordingUrl}.mp3`;
      let storedUrl = twilioMp3;

      if (callSid) {
        const copied = await copyTwilioRecordingToSupabase(twilioMp3, callSid);
        if (copied) storedUrl = copied;
      }

      const cleanPhone = to.replace(/\D/g, '');
      await prisma.lead.updateMany({
        where: { phone: { contains: cleanPhone.slice(-10) } },
        data: { recordingUrl: storedUrl },
      });
      console.log(`[DB] Recording URL saved for ${to}`);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Recording Callback Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
