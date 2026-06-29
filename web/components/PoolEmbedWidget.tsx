// web/components/PoolEmbedWidget.tsx
// Renders pool details for the embed widget.
// Supports read-only mode for disconnected visitors and
// full interaction for Freighter-connected users.
'use client';
import { useEffect, useState, useCallback, CSSProperties } from 'react';

interface Outcome {
  id: number;
  label: string;
  totalStake: number;
}

interface PoolDetail {
  id: string;
  title: string;
  description: string;
  outcomes: Outcome[];
  status: 'open' | 'settled' | 'voided';
  expiresAt: number;
}

interface Theme {
  primary: string;
  bg: string;
  text: string;
  fontSize: string;
}

interface Props {
  poolId: string;
  theme: Theme;
}

// Simple in-memory rate limiter (5 requests per 10-second window per client session)
const REQUEST_WINDOW_MS = 10_000;
const MAX_REQUESTS = 5;
const requestLog: number[] = [];

function isRateLimited(): boolean {
  const now = Date.now();
  while (requestLog.length > 0 && now - requestLog[0] > REQUEST_WINDOW_MS) {
    requestLog.shift();
  }
  if (requestLog.length >= MAX_REQUESTS) return true;
  requestLog.push(now);
  return false;
}

async function fetchPoolDetail(poolId: string): Promise<PoolDetail> {
  if (isRateLimited()) throw new Error('Rate limit exceeded. Please wait before refreshing.');
  const res = await fetch(`/api/pools/${poolId}`);
  if (!res.ok) throw new Error(`Failed to fetch pool: ${res.status}`);
  return res.json();
}

function oddsPercent(outcome: Outcome, outcomes: Outcome[]): number {
  const total = outcomes.reduce((s, o) => s + o.totalStake, 0);
  if (total === 0) return Math.round(100 / outcomes.length);
  return Math.round((outcome.totalStake / total) * 100);
}

export function PoolEmbedWidget({ poolId, theme }: Props) {
  const [pool, setPool] = useState<PoolDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [betAmount, setBetAmount] = useState<string>('');
  const [selectedOutcome, setSelectedOutcome] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);

  // Detect Freighter wallet availability
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).freighter) {
      setConnected(true);
    }
  }, []);

  // Load pool data
  const load = useCallback(async () => {
    try {
      const data = await fetchPoolDetail(poolId);
      setPool(data);
      setError(null);
    } catch (e: any) {
      setError(e.message ?? 'Unknown error');
    }
  }, [poolId]);

  useEffect(() => {
    load();
  }, [load]);

  // Notify parent page via postMessage when ready or on resize
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const msg = {
      type: 'predinex:pool-embed:ready',
      poolId,
      height: document.body.scrollHeight,
    };
    window.parent.postMessage(msg, '*');
  }, [poolId, pool]);

  const handleBet = async () => {
    if (!connected || selectedOutcome === null || !betAmount) return;
    try {
      // Dispatch bet via Freighter – integration point with existing transaction helpers
      window.parent.postMessage({ type: 'predinex:pool-embed:bet', poolId, outcomeId: selectedOutcome, amount: betAmount }, '*');
    } catch (e: any) {
      setError(e.message);
    }
  };

  const cssVars: CSSProperties = {
    '--embed-primary': theme.primary,
    '--embed-bg': theme.bg,
    '--embed-text': theme.text,
    '--embed-font-size': `${theme.fontSize}px`,
  } as CSSProperties;

  if (error) {
    return (
      <div style={{ ...cssVars, padding: 16, background: 'var(--embed-bg)', color: 'var(--embed-text)', fontSize: 'var(--embed-font-size)' }}>
        <p>⚠ {error}</p>
      </div>
    );
  }

  if (!pool) {
    return (
      <div style={{ ...cssVars, padding: 16, textAlign: 'center', background: 'var(--embed-bg)', color: 'var(--embed-text)', fontSize: 'var(--embed-font-size)' }}>
        Loading…
      </div>
    );
  }

  return (
    <div style={{
      ...cssVars,
      fontFamily: 'system-ui, sans-serif',
      fontSize: 'var(--embed-font-size)',
      background: 'var(--embed-bg)',
      color: 'var(--embed-text)',
      padding: 16,
      borderRadius: 12,
      boxSizing: 'border-box',
      width: '100%',
      maxWidth: 420,
      margin: '0 auto',
    }}>
      <h2 style={{ fontSize: '1.1em', fontWeight: 700, marginBottom: 4 }}>{pool.title}</h2>
      <p style={{ fontSize: '0.875em', opacity: 0.7, marginBottom: 12 }}>{pool.description}</p>

      {/* Outcomes */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
        {pool.outcomes.map((outcome) => {
          const pct = oddsPercent(outcome, pool.outcomes);
          const isSelected = selectedOutcome === outcome.id;
          return (
            <button
              key={outcome.id}
              onClick={() => connected && pool.status === 'open' && setSelectedOutcome(outcome.id)}
              style={{
                background: isSelected ? 'var(--embed-primary)' : 'rgba(0,0,0,0.05)',
                color: isSelected ? '#fff' : 'var(--embed-text)',
                border: `1px solid ${isSelected ? 'var(--embed-primary)' : 'rgba(0,0,0,0.1)'}`,
                borderRadius: 8,
                padding: '8px 12px',
                cursor: connected && pool.status === 'open' ? 'pointer' : 'default',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                textAlign: 'left',
              }}
            >
              <span>{outcome.label}</span>
              <span style={{ fontWeight: 600, fontSize: '0.9em' }}>{pct}%</span>
            </button>
          );
        })}
      </div>

      {/* Bet input – only shown when connected and pool is open */}
      {connected && pool.status === 'open' ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="number"
            min="0"
            placeholder="Amount (XLM)"
            value={betAmount}
            onChange={(e) => setBetAmount(e.target.value)}
            style={{
              flex: 1,
              padding: '6px 10px',
              borderRadius: 8,
              border: '1px solid rgba(0,0,0,0.15)',
              fontSize: 'inherit',
              color: 'var(--embed-text)',
              background: 'var(--embed-bg)',
            }}
          />
          <button
            onClick={handleBet}
            disabled={selectedOutcome === null || !betAmount}
            style={{
              background: 'var(--embed-primary)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '6px 14px',
              fontWeight: 600,
              cursor: selectedOutcome !== null && betAmount ? 'pointer' : 'not-allowed',
              opacity: selectedOutcome !== null && betAmount ? 1 : 0.5,
            }}
          >
            Bet
          </button>
        </div>
      ) : (
        !connected && pool.status === 'open' && (
          <p style={{ fontSize: '0.8em', opacity: 0.6, textAlign: 'center' }}>
            Connect Freighter on{' '}
            <a href="https://predinex.app" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--embed-primary)' }}>predinex.app</a>
            {' '}to place a bet.
          </p>
        )
      )}

      <p style={{ fontSize: '0.75em', opacity: 0.4, marginTop: 12, textAlign: 'right' }}>
        Status: {pool.status} · Powered by Predinex
      </p>
    </div>
  );
}
