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
import { poolToExportRecord } from '@/app/lib/activity-export';

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
// CSV helpers
// ---------------------------------------------------------------------------
function esc(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

type Row = Record<string, string | number | null | undefined>;

function toCsv(rows: Row[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  return [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => esc(r[h])).join(',')),
  ].join('\n');
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

  const { searchParams } = req.nextUrl;
  const format = (searchParams.get('format') ?? 'csv') as 'csv' | 'json';
  const address = searchParams.get('address') ?? 'anonymous';
  const includeParticipants = searchParams.get('participants') === 'true';

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

  // In production, fetch real pool data from the Soroban RPC.
  // For now use a typed mock that mirrors the on-chain Pool shape.
  const mockPool = {
    id: poolId,
    title: `Pool #${poolId}`,
    description: 'Mock pool for export',
    outcomeA: 'Yes',
    outcomeB: 'No',
    totalA: 5_000_000,
    totalB: 3_000_000,
    settled: false,
    status: 'active',
    creator: 'GCREATOR...',
    expiry: 100_000,
    participant_count: 12,
  };

  const mockParticipants: Row[] = includeParticipants
    ? [
        { address: 'GABC...', amount_a_stx: 1, amount_b_stx: 0, total_stx: 1 },
        { address: 'GDEF...', amount_a_stx: 0, amount_b_stx: 0.5, total_stx: 0.5 },
      ]
    : [];

  const date = new Date().toISOString().slice(0, 10);
  const filename = `predinex-pool-${poolId}-${date}.${format}`;

  if (format === 'json') {
    const payload = {
      pool: poolToExportRecord(mockPool, poolId),
      ...(includeParticipants ? { participants: mockParticipants } : {}),
    };
    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        ...rlHeaders,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  }

  // CSV: pool summary row, then optional participants section.
  const poolRecord = poolToExportRecord(mockPool, poolId);
  const poolRow: Row = poolRecord as unknown as Row;
  let csv = toCsv([poolRow]);

  if (includeParticipants && mockParticipants.length > 0) {
    csv += '\n\n# Participants\n' + toCsv(mockParticipants);
  }

  return new NextResponse(csv, {
    status: 200,
    headers: {
      ...rlHeaders,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
