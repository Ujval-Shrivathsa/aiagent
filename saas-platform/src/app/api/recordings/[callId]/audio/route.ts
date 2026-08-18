import fs from 'fs';
import { NextResponse } from 'next/server';
import { getAudioFilePath } from '@/lib/recordings';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ callId: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const { callId } = await params;
    const filePath = getAudioFilePath(callId);
    if (!filePath) {
      return NextResponse.json({ success: false, error: 'Audio not found' }, { status: 404 });
    }

    const stat = fs.statSync(filePath);
    const data = fs.readFileSync(filePath);

    return new NextResponse(data, {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': String(stat.size),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
