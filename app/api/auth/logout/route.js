export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { clearTokenCookie } from '@/lib/auth';

export async function POST() {
  return clearTokenCookie(NextResponse.json({ success: true }));
}
