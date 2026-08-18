import { NextResponse } from 'next/server';
import { listRecordings } from '@/lib/recordings';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const phone = searchParams.get('phone') || undefined;
    const recordings = listRecordings({ phone });
    return NextResponse.json({ success: true, recordings, total: recordings.length });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[API/RECORDINGS]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
