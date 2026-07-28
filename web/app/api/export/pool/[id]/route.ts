/**
 * #722 — Pool data + participants export endpoint.
 *
 * GET /api/export/pool/:id?format=csv|json&address=<wallet>
 *
 * Returns pool metadata and (when `participants=true`) a list of all bettor
 * addresses with their stake breakdown.  Rate-limited to 10 requests/hour
 * per wallet address (identified via the `address` query param).
 */
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// In-memory rate limiter: max 10 exports per hour per address.
// ---------------------------------------------------------------------------
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

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

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const poolId = parseInt(id, 10);
  if (!poolId || isNaN(poolId)) {
    return NextResponse.json({ error: 'Invalid pool ID' }, { status: 400 });
  }

  const address = req.nextUrl.searchParams.get('address') ?? 'anonymous';

  // Rate limit keyed by wallet address.
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

  // TODO: Fetch real pool data from Soroban RPC or an indexer.
  // The endpoint currently returns 501 until on-chain data fetching is wired up.
  return NextResponse.json(
    { error: 'Not implemented: real on-chain pool data export is not yet available.' },
    { status: 501, headers: rlHeaders },
  );
}
