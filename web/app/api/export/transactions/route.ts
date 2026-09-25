import { NextRequest, NextResponse } from 'next/server';
import {
  checkRateLimit,
  rateLimitHeaders,
  parseLimitParam,
  clientIpFromHeaders,
} from '@/app/lib/rate-limit';
import { resolveExportWindow, filterActivitiesForExport, toExportRecords } from '@/app/lib/activity-export';
import type { ActivityItem } from '@/app/lib/market-types';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// Rate-limit constants for this route.
// ---------------------------------------------------------------------------
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const IP_RATE_LIMIT_MAX = 30;

const WALLET_HEADER = 'x-predinex-wallet-address';
const CSV_HEADER = 'Date,Pool ID,Question,Outcome,Amount,Result,Payout';

function toResult(type: ActivityItem['type']): string {
  if (type === 'winnings-claimed') return 'Won';
  if (type === 'bet-placed') return 'Pending';
  return type;
}

function getMockActivities(address: string): ActivityItem[] {
  const now = Math.floor(Date.now() / 1000);
  return [
    {
      txId: 'tx1',
      type: 'bet-placed',
      functionName: 'Yes',
      timestamp: now - 86400,
      status: 'success',
      amount: 1_000_000,
      poolId: 1,
      poolTitle: 'Will BTC hit $100k?',
      explorerUrl: '',
      address,
    },
    {
      txId: 'tx2',
      type: 'winnings-claimed',
      functionName: 'Yes',
      timestamp: now - 43200,
      status: 'success',
      amount: 1_900_000,
      poolId: 1,
      poolTitle: 'Will BTC hit $100k?',
      explorerUrl: '',
      address,
    },
    {
      txId: 'tx3',
      type: 'bet-placed',
      functionName: 'No',
      timestamp: now - 3600,
      status: 'success',
      amount: 500_000,
      poolId: 2,
      poolTitle: 'ETH merge success?',
      explorerUrl: '',
      address,
    },
  ];
}

function itemsToCsv(items: ActivityItem[]): string {
  if (items.length === 0) {
    return CSV_HEADER;
  }
  const rows = items.map((item) => {
    const date = new Date(item.timestamp * 1000).toISOString().slice(0, 10);
    const amount = item.amount !== undefined && item.amount !== null ? (item.amount / 1_000_000).toFixed(2) : '';
    const payout = item.type === 'winnings-claimed' && item.amount !== undefined && item.amount !== null ? (item.amount / 1_000_000).toFixed(2) : '';
    const rawTitle = item.poolTitle ?? '';
    const title = `"${rawTitle.replace(/"/g, '""')}"`;
    return [
      date,
      item.poolId ?? '',
      title,
      item.functionName ?? '',
      amount,
      toResult(item.type),
      payout,
    ].join(',');
  });
  return [CSV_HEADER, ...rows].join('\n');
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const address = searchParams.get('address');
  if (!address) {
    return NextResponse.json({ error: 'address is required' }, { status: 400 });
  }

  // Authenticate the caller and bind it to the requested address.
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

  // Per-IP bucket, checked before wallet bucket
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

  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const format = (searchParams.get('format') ?? 'csv').toLowerCase();
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const pageSize = parseLimitParam(searchParams.get('pageSize') ?? searchParams.get('limit'), 20, 100);

  const window = resolveExportWindow(from, to);
  const allActivities = getMockActivities(address);
  const filtered = filterActivitiesForExport(allActivities, window);

  const start = (page - 1) * pageSize;
  const paginated = filtered.slice(start, start + pageSize);

  if (format === 'json') {
    const filename = `predinex-transactions_${window.from}_${window.to}.json`;
    return new NextResponse(JSON.stringify(toExportRecords(paginated), null, 2), {
      status: 200,
      headers: {
        ...rlHdrs,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Total-Count': String(filtered.length),
      },
    });
  }

  const csv = itemsToCsv(paginated);
  const filename = `predinex-transactions_${window.from}_${window.to}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      ...rlHdrs,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Total-Count': String(filtered.length),
    },
  });
}
