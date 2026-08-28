/**
 * #722 — Pool data + participants export endpoint.
 *
 * GET /api/export/pool/:id?format=csv|json&address=<wallet>
 *
 * Returns pool metadata and (when `participants=true`) a list of all bettor
 * addresses with their stake breakdown.
 *
 * Abuse posture
 * -------------
 * Rate-limited to 10 requests/hour per wallet address (identified via the
 * `address` query param) to prevent runaway scraping of pool data. Unknown
 * or absent addresses share an "anonymous" bucket — intentionally tighter
 * than authenticated wallets to discourage unauthenticated bulk access.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, rateLimitHeaders, parseLimitParam } from '@/app/lib/rate-limit';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// Rate-limit constants for this route.
// ---------------------------------------------------------------------------
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

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

  // Validate `limit` param if present (not yet used but guarded against abuse).
  const _limit = parseLimitParam(req.nextUrl.searchParams.get('limit'), 20, 100);

  // Rate limit keyed by wallet address.
  const rl = checkRateLimit(`export-pool:${address}`, {
    max: RATE_LIMIT_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });
  const rlHdrs = rateLimitHeaders(rl);

  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Export rate limit exceeded. Maximum 10 exports per hour.' },
      { status: 429, headers: rlHdrs },
    );
  }

  // TODO: Fetch real pool data from Soroban RPC or an indexer.
  // The endpoint currently returns 501 until on-chain data fetching is wired up.
  return NextResponse.json(
    { error: 'Not implemented: real on-chain pool data export is not yet available.' },
    { status: 501, headers: rlHdrs },
  );
}
