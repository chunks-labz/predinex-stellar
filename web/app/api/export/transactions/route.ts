import { NextRequest, NextResponse } from 'next/server';
import {
  checkRateLimit,
  rateLimitHeaders,
  parseLimitParam,
  clientIpFromHeaders,
} from '@/app/lib/rate-limit';
import { resolveExportWindow, filterActivitiesForExport, toExportRecords } from '@/app/lib/activity-export';
import type { ActivityItem } from '@/app/lib/market-types';
import { stroopsToUnits } from '@/app/lib/formatting';
import { predinexReadApi } from '@/app/lib/adapters/predinex-read-api';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// Rate-limit constants for this route.
// ---------------------------------------------------------------------------
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const IP_RATE_LIMIT_MAX = 30;

const WALLET_HEADER = 'x-predinex-wallet-address';
const CSV_HEADER = 'Timestamp,Market ID,Market,Outcome,Amount,Status,Transaction ID';

function escapeCsvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function itemsToCsv(items: ActivityItem[]): string {
  if (items.length === 0) {
    return CSV_HEADER;
  }
  const rows = items.map((item) => {
    const timestamp = new Date(item.timestamp * 1000).toISOString();
    const amount = item.amount !== undefined && item.amount !== null ? stroopsToUnits(item.amount).toFixed(2) : '';
    return [
      timestamp,
      item.poolId ?? '',
      escapeCsvCell(item.poolTitle ?? ''),
      item.functionName ?? '',
      amount,
      item.status,
      item.txId,
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
  const allActivities = await predinexReadApi.getUserActivity(address, 1000);
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
