import { NextResponse } from 'next/server';
import { prisma, getDatabaseConfigError } from '@/lib/prisma';
import { comparePassword, signToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const configError = getDatabaseConfigError();
    if (configError) {
      return NextResponse.json({ error: configError }, { status: 503 });
    }

    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user || !(await comparePassword(password, user.password))) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const token = signToken({ userId: user.id, email: user.email });

    const response = NextResponse.json({ success: true, user: { email: user.email } });
    response.cookies.set('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 86400,
    });

    return response;
  } catch (error: any) {
    console.error("[API/AUTH/LOGIN] Error:", error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}
