import { describe, it, expect } from 'vitest';
import { GET } from '../../app/api/export/pool/[id]/route';
import { NextRequest } from 'next/server';

function makeRequest(
  poolId: string,
  params: Record<string, string> = {},
  opts: { ip?: string } = {},
) {
  const url = new URL(`http://localhost/api/export/pool/${poolId}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const headers = new Headers();
  if (opts.ip) headers.set('x-forwarded-for', opts.ip);
  return new NextRequest(url.toString(), { headers });
}

describe('/api/export/pool/[id]', () => {
  it('returns 400 when pool ID is invalid', async () => {
    const res = await GET(makeRequest('invalid'), { params: Promise.resolve({ id: 'invalid' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid pool id/i);
  });

  it('returns CSV with pool details by default', async () => {
    const res = await GET(makeRequest('1'), { params: Promise.resolve({ id: '1' }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    expect(res.headers.get('Content-Disposition')).toContain('attachment');
    const text = await res.text();
    expect(text).toContain('pool_id');
    expect(text).toContain('Pool #1');
  });

  it('returns JSON when format=json is specified', async () => {
    const res = await GET(
      makeRequest('1', { format: 'json' }),
      { params: Promise.resolve({ id: '1' }) },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    const body = await res.json();
    expect(body.pool).toBeDefined();
    expect(body.pool.id).toBe(1);
  });

  it('includes participants section when participants=true', async () => {
    const res = await GET(
      makeRequest('1', { participants: 'true' }),
      { params: Promise.resolve({ id: '1' }) },
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('# Participants');
    expect(text).toContain('GABC1234567890');
  });

  it('rate limits excessive exports from same IP', async () => {
    let limited = 0;
    for (let i = 0; i < 35; i += 1) {
      const res = await GET(
        makeRequest('1', { address: `GWALLET_${i}` }, { ip: '10.5.5.5' }),
        { params: Promise.resolve({ id: '1' }) },
      );
      if (res.status === 429) limited += 1;
    }
    expect(limited).toBeGreaterThan(0);
  });
});
