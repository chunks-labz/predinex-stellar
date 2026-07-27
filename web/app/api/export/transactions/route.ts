import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// #722 — Rate limiter: max 10 exports per hour per address.
// ---------------------------------------------------------------------------
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const rateLimitStore = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(key: string): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(key);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0, resetAt: entry.windowStart + RATE_LIMIT_WINDOW_MS };
  }
  entry.count += 1;
  return { allowed: true, remaining: RATE_LIMIT_MAX - entry.count, resetAt: entry.windowStart + RATE_LIMIT_WINDOW_MS };
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const address = searchParams.get('address');
  if (!address) {
    return NextResponse.json({ error: 'address is required' }, { status: 400 });
  }

  // #722 — Rate limit.
  const rl = checkRateLimit(address);
  const rlHeaders = {
    'X-RateLimit-Limit': String(RATE_LIMIT_MAX),
    'X-RateLimit-Remaining': String(rl.remaining),
    'X-RateLimit-Reset': String(Math.ceil(rl.resetAt / 1000)),
  };
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Export rate limit exceeded. Maximum 10 exports per hour.' },
      { status: 429, headers: rlHeaders },
    );
  }

  // TODO: Fetch real transaction data from Soroban RPC or an indexer.
  // The endpoint currently returns 501 until on-chain data fetching is wired up.
  return NextResponse.json(
    { error: 'Not implemented: real on-chain transaction export is not yet available.' },
    { status: 501, headers: rlHeaders },
  );
}
