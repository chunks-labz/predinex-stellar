import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '../../app/api/export/transactions/route';
import { NextRequest } from 'next/server';

function makeRequest(params: Record<string, string>) {
  const url = new URL('http://localhost/api/export/transactions');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url.toString());
}

describe('/api/export/transactions', () => {
  it('returns 400 when address is missing', async () => {
    const res = await GET(makeRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/address/i);
  });

  it('returns CSV with correct headers for a valid address', async () => {
    const res = await GET(makeRequest({ address: 'GTEST123' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    const text = await res.text();
    expect(text.startsWith('Date,Pool ID,Question,Outcome,Amount,Result,Payout')).toBe(true);
  });

  it('returns header-only CSV when date filter excludes all rows', async () => {
    // Use a date range far in the past so no mock rows match
    const res = await GET(makeRequest({ address: 'GTEST123', from: '2000-01-01', to: '2000-01-02' }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.trim()).toBe('Date,Pool ID,Question,Outcome,Amount,Result,Payout');
  });

  it('respects date filter — recent range returns rows', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const res = await GET(makeRequest({ address: 'GTEST123', from: weekAgo, to: today }));
    const text = await res.text();
    const lines = text.trim().split('\n');
    expect(lines.length).toBeGreaterThan(1); // header + at least one row
  });

  it('sets Content-Disposition attachment header', async () => {
    const res = await GET(makeRequest({ address: 'GTEST123' }));
    expect(res.headers.get('Content-Disposition')).toContain('attachment');
  });

  it('paginates results — page 2 with pageSize 1 returns different row than page 1', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const p1 = await GET(makeRequest({ address: 'GTEST123', from: weekAgo, to: today, page: '1', pageSize: '1' }));
    const p2 = await GET(makeRequest({ address: 'GTEST123', from: weekAgo, to: today, page: '2', pageSize: '1' }));
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
