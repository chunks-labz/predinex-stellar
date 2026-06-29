import { describe, expect, it } from 'vitest';
import { DELETE, GET, POST } from '../../app/api/push-subscriptions/route';

function request(method: string, body?: unknown, wallet = 'GABC123') {
  return new Request('http://localhost/api/push-subscriptions', {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-predinex-wallet-address': wallet,
    },
    body: body ? JSON.stringify(body) : undefined,
  }) as never;
}

const validBody = {
  userId: 'GABC123',
  subscription: {
    endpoint: 'https://push.example.test/subscription/1',
    expirationTime: null,
    keys: {
      p256dh: 'p256dh-key-with-enough-length',
      auth: 'auth-key-with-enough-length',
    },
  },
  preferences: {
    poolSettled: true,
    poolExpiring24h: true,
    claimAvailable: false,
    disputeFiled: true,
  },
};

describe('/api/push-subscriptions', () => {
  it('rejects mismatched wallet identity', async () => {
    const response = await POST(request('POST', validBody, 'GOTHER'));

    expect(response.status).toBe(401);
  });

  it('validates subscription shape', async () => {
    const response = await POST(
      request('POST', {
        ...validBody,
        subscription: { ...validBody.subscription, endpoint: 'http://not-secure.test' },
      }),
    );

    expect(response.status).toBe(400);
  });

  it('stores subscriptions idempotently per user endpoint', async () => {
    const first = await POST(request('POST', validBody));
    const second = await POST(
      request('POST', {
        ...validBody,
        preferences: { ...validBody.preferences, claimAvailable: true },
      }),
    );
    const stored = await GET(request('GET'));
    const json = await stored.json();

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(json.subscriptions).toHaveLength(1);
    expect(json.subscriptions[0].preferences.claimAvailable).toBe(true);
  });

  it('deletes subscriptions for the wallet', async () => {
    await POST(request('POST', validBody));
    const response = await DELETE(request('DELETE', { userId: 'GABC123' }));
    const stored = await GET(request('GET'));
    const json = await stored.json();

    expect(response.status).toBe(200);
    expect(json.subscriptions).toEqual([]);
  });
});
