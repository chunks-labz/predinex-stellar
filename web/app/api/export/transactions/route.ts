/**
 * #722 — Transaction history export endpoint.
 *
 * GET /api/export/transactions?address=<wallet>&format=csv|json
 *
 * Abuse posture
 * -------------
 * #1177 closed two holes in this route:
 *
 * 1. **Authentication.** The caller must present its wallet identity in the
 *    `x-predinex-wallet-address` header — the same convention already used by
 *    `/api/push-subscriptions` — and that identity must match the `address`
 *    being exported. A request can therefore only ever export the caller's own
 *    history; enumerating someone else's is a 401, not a 200.
 * 2. **Rate-limit bucketing.** The counter used to be keyed on the *target*
 *    address, so a caller walking a list of addresses got a brand-new bucket
 *    per entry and history enumeration was effectively unthrottled. A
 *    client-IP bucket is now checked first — the caller cannot vary its own IP
 *    per request — with the per-wallet bucket layered on top of it.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  checkRateLimit,
  rateLimitHeaders,
  parseLimitParam,
  clientIpFromHeaders,
} from '@/app/lib/rate-limit';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// Rate-limit constants for this route.
// ---------------------------------------------------------------------------
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
// Per-IP cap. Slightly looser than the per-wallet cap so that a few wallets
// behind one NAT'd connection keep working, while address enumeration still
// runs out of budget quickly.
const IP_RATE_LIMIT_MAX = 30;

const WALLET_HEADER = 'x-predinex-wallet-address';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const address = searchParams.get('address');
  if (!address) {
    return NextResponse.json({ error: 'address is required' }, { status: 400 });
  }

  // #1177 — Authenticate the caller and bind it to the requested address.
  const caller = req.headers.get(WALLET_HEADER)?.trim();
  if (!caller) {
    return NextResponse.json(
      { error: `Authentication required: send the ${WALLET_HEADER} header.` },
      { status: 401 },
    );
  }
  if (caller !== address.trim()) {
    return NextResponse.json(
      { error: 'Address does not match the authenticated wallet.' },
      { status: 401 },
    );
  }

  // Validate `limit` param if present.
  const _limit = parseLimitParam(searchParams.get('limit'), 20, 100);

  // #1177 — Per-IP bucket, checked before any wallet bucket: the IP is the one
  // identifier an enumerating caller cannot rotate per request.
  const clientIp = clientIpFromHeaders(req.headers);
  const ipRl = checkRateLimit(`export-txns:ip:${clientIp}`, {
    max: IP_RATE_LIMIT_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });
  if (!ipRl.allowed) {
    return NextResponse.json(
      {
        error: `Export rate limit exceeded. Maximum ${IP_RATE_LIMIT_MAX} exports per hour from this network address.`,
      },
      { status: 429, headers: rateLimitHeaders(ipRl) },
    );
  }

  // Per-wallet bucket, keyed by the authenticated caller.
  const rl = checkRateLimit(`export-txns:wallet:${caller}`, {
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
