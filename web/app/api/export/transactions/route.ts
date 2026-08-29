/**
 * #722 — Transaction history export endpoint.
 *
 * GET /api/export/transactions?address=<wallet>&format=csv|json
 *
 * Abuse posture
 * -------------
 * Rate-limited to 10 requests/hour per wallet address.  The `address` param
 * is required so every caller is bucketed individually — no shared anonymous
 * pool for this endpoint since it leaks personal transaction history.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, rateLimitHeaders, parseLimitParam } from '@/app/lib/rate-limit';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// Rate-limit constants for this route.
// ---------------------------------------------------------------------------
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const address = searchParams.get('address');
  if (!address) {
    return NextResponse.json({ error: 'address is required' }, { status: 400 });
  }

  // Validate `limit` param if present.
  const _limit = parseLimitParam(searchParams.get('limit'), 20, 100);

  // Rate limit keyed by wallet address.
  const rl = checkRateLimit(`export-txns:${address}`, {
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

  // TODO: Fetch real transaction data from Soroban RPC or an indexer.
  // The endpoint currently returns 501 until on-chain data fetching is wired up.
  return NextResponse.json(
    { error: 'Not implemented: real on-chain transaction export is not yet available.' },
    { status: 501, headers: rlHdrs },
  );
}
