import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, rateLimitHeaders, clientIpFromHeaders } from '@/app/lib/rate-limit';
import { poolToCSV, poolToJSON, buildPoolExportFilename } from '@/app/lib/activity-export';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// Rate-limit constants for this route.
// ---------------------------------------------------------------------------
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const IP_RATE_LIMIT_MAX = 30;

type ParticipantRow = Record<string, string | number | null | undefined>;

function esc(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function participantsToCsv(rows: ParticipantRow[]): string {
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
  const format = (searchParams.get('format') ?? 'csv').toLowerCase() as 'csv' | 'json';
  const address = searchParams.get('address') ?? 'anonymous';
  const includeParticipants = searchParams.get('participants') === 'true';

  // Per-IP rate limit check
  const clientIp = clientIpFromHeaders(req.headers);
  const ipRl = checkRateLimit(`export-pool:ip:${clientIp}`, {
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

  const mockPool = {
    id: poolId,
    title: `Pool #${poolId}`,
    description: `Details for prediction pool ${poolId}`,
    outcomeA: 'Yes',
    outcomeB: 'No',
    totalA: 5_000_000,
    totalB: 3_000_000,
    settled: false,
    status: 'active',
    creator: 'GCREATOR1234567890',
    expiry: 100_000,
    participant_count: 12,
  };

  const mockParticipants: ParticipantRow[] = includeParticipants
    ? [
        { address: 'GABC1234567890', amount_a_stx: 1, amount_b_stx: 0, total_stx: 1 },
        { address: 'GDEF1234567890', amount_a_stx: 0, amount_b_stx: 0.5, total_stx: 0.5 },
      ]
    : [];

  const filename = buildPoolExportFilename(poolId, format === 'json' ? 'json' : 'csv');

  if (format === 'json') {
    const payload = {
      pool: mockPool,
      ...(includeParticipants ? { participants: mockParticipants } : {}),
    };
    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        ...rlHdrs,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  }

  let csv = poolToCSV(mockPool, poolId);
  if (includeParticipants && mockParticipants.length > 0) {
    csv += '\n\n# Participants\n' + participantsToCsv(mockParticipants);
  }

  return new NextResponse(csv, {
    status: 200,
    headers: {
      ...rlHdrs,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

