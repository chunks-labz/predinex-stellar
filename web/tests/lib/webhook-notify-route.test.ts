import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The route reads runtime config and the server-only secret. Neither is mocked
// at module scope because the route is imported per-test with the env in place.
vi.mock('../../app/lib/runtime-config', () => ({
  getRuntimeConfig: vi.fn(),
  __resetRuntimeConfigForTests: vi.fn(),
}));

import { getRuntimeConfig } from '../../app/lib/runtime-config';
import { POST, __resetWebhookDedupeForTests } from '../../app/api/webhooks/notify/route';

const DESTINATION = 'https://receiver.example/hooks/predinex';

function enableWebhooks() {
  vi.mocked(getRuntimeConfig).mockReturnValue({
    webhook: { url: DESTINATION, enabled: true },
  } as unknown as ReturnType<typeof getRuntimeConfig>);
}

function eventBody(overrides: Record<string, unknown> = {}) {
  return {
    event: 'bet_placed',
    eventId: 'evt_place_bet_abc123',
    timestamp: '2026-05-29T21:33:20.000Z',
    poolId: 7,
    user: 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ',
    data: { outcome: 'A', amount: 25 },
    ...overrides,
  };
}

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/webhooks/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Hex HMAC-SHA256 of `message` under `secret`, computed independently of the route. */
async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('POST /api/webhooks/notify', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const SECRET = 'super-secret-signing-key';

  beforeEach(() => {
    // The dedupe set is module-level; reset it so tests stay order-independent.
    __resetWebhookDedupeForTests();
    process.env.WEBHOOK_SECRET = SECRET;
    enableWebhooks();
    fetchSpy = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    delete process.env.WEBHOOK_SECRET;
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it('signs the forwarded body with the server-side secret', async () => {
    const response = await POST(postRequest(eventBody()));

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [destination, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(destination).toBe(DESTINATION);

    const headers = init.headers as Record<string, string>;
    const body = init.body as string;

    // The signature must verify against the exact bytes sent, and against the
    // server secret — never a NEXT_PUBLIC_ value visible to the browser.
    const expected = await hmacHex(SECRET, body);
    expect(headers['X-Predinex-Signature']).toBe(`sha256=${expected}`);
    expect(headers['X-Predinex-Event']).toBe('bet_placed');
    expect(headers['X-Predinex-Event-Id']).toBe('evt_place_bet_abc123');
  });

  it('never forwards the signing secret to the client', async () => {
    const response = await POST(postRequest(eventBody()));
    const text = await response.text();
    expect(text).not.toContain(SECRET);
  });

  it('refuses to deliver when no server secret is configured', async () => {
    delete process.env.WEBHOOK_SECRET;

    const response = await POST(postRequest(eventBody()));

    expect(response.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('deduplicates repeated event IDs so polling cannot fan out copies', async () => {
    const first = await POST(postRequest(eventBody()));
    const second = await POST(postRequest(eventBody()));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ delivered: false, deduplicated: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('delivers distinct event IDs separately', async () => {
    await POST(postRequest(eventBody({ eventId: 'evt_a' })));
    await POST(postRequest(eventBody({ eventId: 'evt_b' })));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('releases the dedupe claim when delivery fails, so a retry can succeed', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('', { status: 500 }));

    const failed = await POST(postRequest(eventBody({ eventId: 'evt_retry' })));
    expect(failed.status).toBe(502);

    const retried = await POST(postRequest(eventBody({ eventId: 'evt_retry' })));
    expect(retried.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('rejects unknown event types', async () => {
    const response = await POST(postRequest(eventBody({ event: 'evil_event' })));

    expect(response.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects payloads with a missing or malformed event ID', async () => {
    const empty = await POST(postRequest(eventBody({ eventId: '' })));
    const wrongType = await POST(postRequest(eventBody({ eventId: 123 })));

    const missingBody = eventBody() as Record<string, unknown>;
    delete missingBody.eventId;
    const missing = await POST(postRequest(missingBody));

    expect(empty.status).toBe(400);
    expect(wrongType.status).toBe(400);
    expect(missing.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a non-object data field rather than passing it through', async () => {
    const response = await POST(postRequest(eventBody({ data: [1, 2, 3] })));

    expect(response.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('accepts a valid event with no data field', async () => {
    const response = await POST(
      postRequest({
        event: 'pool_settled',
        eventId: 'evt_s',
        timestamp: '2026-05-29T21:33:20.000Z',
      })
    );

    expect(response.status).toBe(200);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).data).toEqual({});
  });

  it('is a no-op when webhooks are disabled', async () => {
    vi.mocked(getRuntimeConfig).mockReturnValue({
      webhook: { url: DESTINATION, enabled: false },
    } as unknown as ReturnType<typeof getRuntimeConfig>);

    const response = await POST(postRequest(eventBody()));

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ delivered: false, reason: 'webhooks_disabled' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is a no-op when no webhook URL is configured', async () => {
    vi.mocked(getRuntimeConfig).mockReturnValue({} as unknown as ReturnType<
      typeof getRuntimeConfig
    >);

    const response = await POST(postRequest(eventBody()));

    expect(response.status).toBe(202);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON bodies', async () => {
    const response = await POST(
      new Request('http://localhost/api/webhooks/notify', { method: 'POST', body: 'not json' })
    );

    expect(response.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
