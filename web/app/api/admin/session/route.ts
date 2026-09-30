import { NextRequest, NextResponse } from 'next/server';
import { verifyWalletProof } from '@/app/lib/wallet-auth';
import {
  ADMIN_AUTH_SCOPE,
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_MS,
  issueAdminSession,
  requireAdminSession,
  resolveAdminRoles,
} from '@/app/lib/admin-session';
import { checkRateLimit, clientIpFromHeaders, rateLimitHeaders } from '@/app/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

/** Return the current admin session, if any. */
export async function GET(request: NextRequest) {
  const session = requireAdminSession(request);
  if (!session) {
    return NextResponse.json({ authorized: false }, { status: 401 });
  }
  return NextResponse.json({ authorized: true, address: session.address, roles: session.roles });
}

/**
 * Exchange a wallet-ownership proof for an admin session. The address must
 * hold an on-chain admin role or be on the server-side allowlist.
 */
export async function POST(request: NextRequest) {
  const rl = checkRateLimit(`admin-session:${clientIpFromHeaders(request.headers)}`, {
    max: RATE_LIMIT_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please slow down.' },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const address = verifyWalletProof(request.headers, ADMIN_AUTH_SCOPE);
  if (!address) {
    return NextResponse.json({ authorized: false, error: 'Missing or invalid wallet signature.' }, { status: 401 });
  }

  const roles = await resolveAdminRoles(address);
  if (roles.length === 0) {
    return NextResponse.json({ authorized: false, error: 'Wallet is not an admin.' }, { status: 403 });
  }

  const token = issueAdminSession(address, roles);
  if (!token) {
    return NextResponse.json({ authorized: false, error: 'Admin sessions are not configured.' }, { status: 503 });
  }

  const response = NextResponse.json({ authorized: true, address, roles });
  response.cookies.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: Math.floor(ADMIN_SESSION_TTL_MS / 1000),
  });
  return response;
}

/** End the admin session. */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(ADMIN_SESSION_COOKIE);
  return response;
}
