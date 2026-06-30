import { NextRequest, NextResponse } from 'next/server';
import { resolveExportWindow, filterActivitiesForExport } from '@/app/lib/activity-export';
import type { ActivityItem } from '@/app/lib/stacks-api';

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

// ---------------------------------------------------------------------------

const CSV_HEADER = 'Date,Pool ID,Question,Outcome,Amount,Result,Payout';

function toResult(type: ActivityItem['type']): string {
  if (type === 'winnings-claimed') return 'Win';
  if (type === 'bet-placed') return 'Pending';
  return 'Loss';
}

function toPayout(item: ActivityItem): string {
  if (item.type === 'winnings-claimed' && item.amount !== undefined) {
    return (item.amount / 1_000_000).toFixed(6);
  }
  return '';
}

function escapeCsv(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function itemsToCsv(items: ActivityItem[]): string {
  if (items.length === 0) return CSV_HEADER;
  const rows = items.map((item) => {
    const date = new Date(item.timestamp * 1000).toISOString();
    const amount = item.amount !== undefined ? (item.amount / 1_000_000).toFixed(6) : '';
    return [
      escapeCsv(date),
      escapeCsv(item.poolId ?? ''),
      escapeCsv(item.poolTitle ?? ''),
      escapeCsv(item.functionName ?? ''),
      escapeCsv(amount),
      escapeCsv(toResult(item.type)),
      escapeCsv(toPayout(item)),
    ].join(',');
  });
  return [CSV_HEADER, ...rows].join('\n');
}

// In-memory mock store — replace with on-chain event query when indexer is available.
function getMockActivities(address: string): ActivityItem[] {
  const now = Math.floor(Date.now() / 1000);
  return [
    { txId: 'tx1', type: 'bet-placed', functionName: 'Yes', timestamp: now - 86400, status: 'success', amount: 1_000_000, poolId: 1, poolTitle: 'Will BTC hit $100k?', explorerUrl: '' },
    { txId: 'tx2', type: 'winnings-claimed', functionName: 'Yes', timestamp: now - 43200, status: 'success', amount: 1_900_000, poolId: 1, poolTitle: 'Will BTC hit $100k?', explorerUrl: '' },
    { txId: 'tx3', type: 'bet-placed', functionName: 'No', timestamp: now - 3600, status: 'success', amount: 500_000, poolId: 2, poolTitle: 'ETH merge success?', explorerUrl: '' },
  ].map((a) => ({ ...a, address }) as ActivityItem);
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

  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const pageSize = Math.min(500, Math.max(1, parseInt(searchParams.get('pageSize') ?? '500', 10)));

  const window = resolveExportWindow(from, to);
  const all = getMockActivities(address);
  const filtered = filterActivitiesForExport(all, window);

  // Pagination
  const start = (page - 1) * pageSize;
  const paginated = filtered.slice(start, start + pageSize);

  const csv = itemsToCsv(paginated);
  const filename = `predinex-transactions_${window.from}_${window.to}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      ...rlHeaders,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Total-Count': String(filtered.length),
      'X-Page': String(page),
      'X-Page-Size': String(pageSize),
    },
  });
}
