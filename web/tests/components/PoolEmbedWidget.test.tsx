/**
 * PoolEmbedWidget runs inside an iframe on third-party pages and reports pool
 * and bet data to the embedder via postMessage. These tests pin down that the
 * messages are addressed to a specific origin and are dropped when no origin
 * can be established, rather than broadcast to any embedder with '*'.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { PoolEmbedWidget } from '@/components/PoolEmbedWidget';

const THEME = { primary: '#6366f1', bg: '#ffffff', text: '#111827', fontSize: '14' };

const postMessage = vi.fn();
let referrer = 'https://partner.example/blog/post-1';
let poolIdCounter = 0;

/** Unique per test — the widget rate-limits repeated fetches for the same pool id. */
function nextPoolId(): string {
  poolIdCounter += 1;
  return `pool-${poolIdCounter}`;
}

function poolPayload(id: string) {
  return {
    id,
    title: 'Will it rain?',
    description: 'Weather market',
    outcomes: [
      { id: 0, label: 'Yes', totalStake: 60 },
      { id: 1, label: 'No', totalStake: 40 },
    ],
    status: 'open',
    expiresAt: 1_800_000_000,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  referrer = 'https://partner.example/blog/post-1';

  vi.spyOn(document, 'referrer', 'get').mockImplementation(() => referrer);

  // jsdom makes window.parent === window; the widget only posts when framed.
  Object.defineProperty(window, 'parent', {
    value: { postMessage },
    configurable: true,
    writable: true,
  });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => poolPayload(String(url).split('/').pop()!),
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'parent', { value: window, configurable: true, writable: true });
});

describe('PoolEmbedWidget postMessage target origin', () => {
  it('sends the ready message to the referrer origin', async () => {
    const poolId = nextPoolId();
    render(<PoolEmbedWidget poolId={poolId} theme={THEME} />);

    await waitFor(() => expect(postMessage).toHaveBeenCalled());
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'predinex:pool-embed:ready', poolId }),
      'https://partner.example',
    );
  });

  it('never uses the wildcard target origin', async () => {
    render(<PoolEmbedWidget poolId={nextPoolId()} theme={THEME} />);

    await waitFor(() => expect(postMessage).toHaveBeenCalled());
    for (const [, targetOrigin] of postMessage.mock.calls) {
      expect(targetOrigin).not.toBe('*');
    }
  });

  it('drops messages when the embedding origin cannot be determined', async () => {
    referrer = '';
    render(<PoolEmbedWidget poolId={nextPoolId()} theme={THEME} />);

    await screen.findByText('Will it rain?');
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('sends the bet message to the referrer origin only', async () => {
    const poolId = nextPoolId();
    (window as unknown as { freighter?: unknown }).freighter = {};

    render(<PoolEmbedWidget poolId={poolId} theme={THEME} />);
    await screen.findByText('Will it rain?');

    fireEvent.click(screen.getByRole('button', { name: /Yes/ }));
    fireEvent.change(screen.getByPlaceholderText(/Amount/i), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: /^Bet$/ }));

    expect(postMessage).toHaveBeenCalledWith(
      { type: 'predinex:pool-embed:bet', poolId, outcomeId: 0, amount: '25' },
      'https://partner.example',
    );

    delete (window as unknown as { freighter?: unknown }).freighter;
  });

  it('does not post to itself when loaded outside an iframe', async () => {
    Object.defineProperty(window, 'parent', { value: window, configurable: true, writable: true });
    const spy = vi.spyOn(window, 'postMessage');

    render(<PoolEmbedWidget poolId={nextPoolId()} theme={THEME} />);
    await screen.findByText('Will it rain?');

    expect(spy).not.toHaveBeenCalled();
  });

  it('still renders pool details when messaging is suppressed', async () => {
    referrer = '';
    render(<PoolEmbedWidget poolId={nextPoolId()} theme={THEME} />);

    expect(await screen.findByText('Will it rain?')).toBeInTheDocument();
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.getByText('60%')).toBeInTheDocument();
  });
});
