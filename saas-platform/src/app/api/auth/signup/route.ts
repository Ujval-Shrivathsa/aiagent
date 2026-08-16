import { NextResponse } from 'next/server';
import { prisma, getDatabaseConfigError } from '@/lib/prisma';
import { hashPassword, signToken } from '@/lib/auth';

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

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json({ error: 'User already exists' }, { status: 400 });
    }

    const hashedPassword = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
      },
    });

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
    console.error("[API/AUTH/SIGNUP] Error:", error);
    const message = error?.message || 'Internal server error';
    const setupHint = /sqlite|P1001|P1013|does not exist|P2021/i.test(message)
      ? ' Set DATABASE_URL to the Supabase Postgres URI, then redeploy so prisma db push can create tables.'
      : '';
    return NextResponse.json({ error: message + setupHint }, { status: 500 });
  }
}
