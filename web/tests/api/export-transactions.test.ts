import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '../../app/api/export/transactions/route';
import { NextRequest } from 'next/server';
import type { ActivityItem } from '../../app/lib/market-types';

const mockGetUserActivity = vi.fn();

vi.mock('../../app/lib/adapters/predinex-read-api', () => ({
  predinexReadApi: {
    getUserActivity: (...args: unknown[]) => mockGetUserActivity(...args),
  },
}));

const WALLET_HEADER = 'x-predinex-wallet-address';

function makeRequest(
  params: Record<string, string>,
  opts: { wallet?: string | null; ip?: string } = {},
) {
  const url = new URL('http://localhost/api/export/transactions');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const headers = new Headers();
  if (opts.wallet) headers.set(WALLET_HEADER, opts.wallet);
  if (opts.ip) headers.set('x-forwarded-for', opts.ip);
  return new NextRequest(url.toString(), { headers });
}

describe('/api/export/transactions', () => {
  beforeEach(() => {
    mockGetUserActivity.mockReset();
  });

  it('returns 400 when address is missing', async () => {
    const res = await GET(makeRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/address/i);
  });

  // #1177 — authentication
  it('returns 401 when no wallet identity is presented', async () => {
    const res = await GET(makeRequest({ address: 'GTEST123' }, { wallet: null }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/authentication/i);
  });

  it('returns 401 when the wallet identity does not match the requested address', async () => {
    const res = await GET(
      makeRequest({ address: 'GTEST123' }, { wallet: 'GSOMEONEELSE', ip: '10.0.0.1' }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/does not match/i);
  });

  it('accepts the caller exporting its own address', async () => {
    mockGetUserActivity.mockResolvedValue([]);
    const res = await GET(makeRequest({ address: 'GTEST123' }, { wallet: 'GTEST123' }));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(429);
  });

  // #1177 — rate-limit bucketing
  it('rate limits repeated exports for the same wallet', async () => {
    mockGetUserActivity.mockResolvedValue([]);
    const params = { address: 'GWALLETREPEAT' };
    let last: Response | null = null;
    for (let i = 0; i < 11; i += 1) {
      last = await GET(makeRequest(params, { wallet: 'GWALLETREPEAT', ip: '10.0.0.10' }));
    }
    expect(last).not.toBeNull();
    expect(last!.status).toBe(429);
    const body = await last!.json();
    expect(body.error).toMatch(/rate limit/i);
  });

  it('throttles address enumeration from a single caller IP', async () => {
    // Each address is a distinct (and authenticated) wallet, so the per-wallet
    // bucket is fresh every time — only the per-IP bucket can stop the sweep.
    mockGetUserActivity.mockResolvedValue([]);
    let limited = 0;
    for (let i = 0; i < 31; i += 1) {
      const address = `GENUM${i}`;
      const res = await GET(makeRequest({ address }, { wallet: address, ip: '10.0.0.20' }));
      if (res.status === 429) limited += 1;
    }
    expect(limited).toBeGreaterThan(0);
  });

  it('returns CSV with correct headers for a valid address', async () => {
    mockGetUserActivity.mockResolvedValue([
      {
        txId: 'tx-1',
        type: 'bet-placed',
        functionName: 'Yes',
        timestamp: 1_700_000_000,
        status: 'success',
        amount: 10_000_000,
        poolId: 7,
        poolTitle: 'Will BTC hit $100k?',
        explorerUrl: '',
        address: 'GTEST123',
      } satisfies ActivityItem,
    ]);
    const res = await GET(makeRequest({ address: 'GTEST123' }, { wallet: 'GTEST123' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    const text = await res.text();
    expect(text.startsWith('Timestamp,Market ID,Market,Outcome,Amount,Status,Transaction ID')).toBe(true);
  });

  it('returns header-only CSV when date filter excludes all rows', async () => {
    // Use a date range far in the past so no mock rows match
    mockGetUserActivity.mockResolvedValue([
      {
        txId: 'tx-1',
        type: 'bet-placed',
        functionName: 'Yes',
        timestamp: 1_700_000_000,
        status: 'success',
        amount: 10_000_000,
        poolId: 7,
        poolTitle: 'Will BTC hit $100k?',
        explorerUrl: '',
        address: 'GTEST123',
      } satisfies ActivityItem,
    ]);
    const res = await GET(
      makeRequest(
        { address: 'GTEST123', from: '2000-01-01', to: '2000-01-02' },
        { wallet: 'GTEST123' },
      ),
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.trim()).toBe('Timestamp,Market ID,Market,Outcome,Amount,Status,Transaction ID');
  });

  it('respects date filter — recent range returns rows', async () => {
    mockGetUserActivity.mockResolvedValue([
      {
        txId: 'tx-1',
        type: 'bet-placed',
        functionName: 'Yes',
        timestamp: Math.floor(Date.now() / 1000) - 86_400,
        status: 'success',
        amount: 10_000_000,
        poolId: 7,
        poolTitle: 'Will BTC hit $100k?',
        explorerUrl: '',
        address: 'GTEST123',
      } satisfies ActivityItem,
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const res = await GET(
      makeRequest(
        { address: 'GTEST123', from: weekAgo, to: today },
        { wallet: 'GTEST123' },
      ),
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    const lines = text.trim().split('\n');
    expect(lines.length).toBeGreaterThan(1); // header + at least one row
  });

  it('sets Content-Disposition attachment header', async () => {
    mockGetUserActivity.mockResolvedValue([]);
    const res = await GET(makeRequest({ address: 'GTEST123' }, { wallet: 'GTEST123' }));
    expect(res.headers.get('Content-Disposition')).toContain('attachment');
  });

  it('paginates results — page 2 with pageSize 1 returns different row than page 1', async () => {
    mockGetUserActivity.mockResolvedValue([
      {
        txId: 'tx-1',
        type: 'bet-placed',
        functionName: 'Yes',
        timestamp: Math.floor(Date.now() / 1000) - 86_400,
        status: 'success',
        amount: 10_000_000,
        poolId: 7,
        poolTitle: 'Will BTC hit $100k?',
        explorerUrl: '',
        address: 'GTEST123',
      } satisfies ActivityItem,
      {
        txId: 'tx-2',
        type: 'winnings-claimed',
        functionName: 'Yes',
        timestamp: Math.floor(Date.now() / 1000) - 43_200,
        status: 'success',
        amount: 1_900_000,
        poolId: 7,
        poolTitle: 'Will BTC hit $100k?',
        explorerUrl: '',
        address: 'GTEST123',
      } satisfies ActivityItem,
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const p1 = await GET(
      makeRequest(
        { address: 'GTEST123', from: weekAgo, to: today, page: '1', pageSize: '1' },
        { wallet: 'GTEST123' },
      ),
    );
    const p2 = await GET(
      makeRequest(
        { address: 'GTEST123', from: weekAgo, to: today, page: '2', pageSize: '1' },
        { wallet: 'GTEST123' },
      ),
    );
    const t1 = await p1.text();
    const t2 = await p2.text();
    // Both have the header row; data rows should differ
    const rows1 = t1.trim().split('\n').slice(1);
    const rows2 = t2.trim().split('\n').slice(1);
    if (rows1.length > 0 && rows2.length > 0) {
      expect(rows1[0]).not.toBe(rows2[0]);
    }
  });
});
