import { NextResponse } from 'next/server';
import { getRecording } from '@/lib/recordings';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ callId: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const { callId } = await params;
    const recording = getRecording(callId);
    if (!recording) {
      return NextResponse.json({ success: false, error: 'Recording not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, recording });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
