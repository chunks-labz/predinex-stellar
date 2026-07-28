import React, { useState, useEffect, useCallback } from 'react';
import type { PredinexWidgetProps, WidgetPool } from './types';
import { buildCSSVars, pct } from './utils';
import { WIDGET_CSS } from './styles';

let styleInjected = false;
function injectStyles(): void {
  if (styleInjected || typeof document === 'undefined') return;
  const el = document.createElement('style');
  el.textContent = WIDGET_CSS;
  document.head.appendChild(el);
  styleInjected = true;
}

// ── default no-op fetchers (consumers must supply real ones or use the
//    script-tag build which bundles a Soroban RPC implementation) ────────────

async function defaultFetchPool(contractId: string, poolId: number): Promise<WidgetPool> {
  const url = `https://soroban-testnet.stellar.org`; // placeholder
  throw new Error(
    `No fetchPool provided. Supply a fetchPool prop or use the bundled script tag build. (contractId=${contractId}, poolId=${poolId}, rpc=${url})`
  );
}

async function defaultPlaceBet(
  _contractId: string,
  _poolId: number,
  _outcome: number,
  _amount: number
): Promise<string> {
  throw new Error('No placeBet provided. Connect a Freighter/Albedo signer via the placeBet prop.');
}

// ── PoolCard ──────────────────────────────────────────────────────────────────

interface PoolCardProps {
  pool: WidgetPool;
  onBet?: PredinexWidgetProps['onBet'];
  placeBet: (contractId: string, poolId: number, outcome: number, amount: number) => Promise<string>;
  contractId: string;
}

function PoolCard({ pool, onBet, placeBet, contractId }: PoolCardProps) {
  const [selected, setSelected] = useState<0 | 1 | null>(null);
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle');
  const [message, setMessage] = useState('');

  const isSettled = pool.status === 'settled';
  const isBettable = pool.status === 'open';

  const handleBet = useCallback(async () => {
    if (selected === null) return;
    const amt = parseFloat(amount);
    if (!amount || isNaN(amt) || amt <= 0) {
      setStatus('err');
      setMessage('Enter a valid amount.');
      return;
    }
    setStatus('loading');
    setMessage('');
    try {
      const txId = await placeBet(contractId, pool.id, selected, amt);
      setStatus('ok');
      setMessage(`Bet placed! Tx: ${txId.slice(0, 16)}…`);
      onBet?.(pool.id, selected, amt);
    } catch (e: unknown) {
      setStatus('err');
      setMessage(e instanceof Error ? e.message : 'Bet failed.');
    }
  }, [selected, amount, contractId, pool.id, placeBet, onBet]);

  const winnerLabel =
    isSettled && pool.winningOutcome !== undefined
      ? pool.winningOutcome === 0
        ? pool.outcomeA
        : pool.outcomeB
      : null;

  return (
    <div>
      <span className="pdx-status">{pool.status.toUpperCase()}</span>
      <h2 className="pdx-title">{pool.title}</h2>
      <p className="pdx-desc">{pool.description}</p>

      {/* Odds bar */}
      <div className="pdx-bar-wrap" role="progressbar" aria-valuenow={parseInt(pct(pool.totalA, pool.totalB))} aria-valuemin={0} aria-valuemax={100}>
        <div className="pdx-bar" style={{ width: pct(pool.totalA, pool.totalB) }} />
      </div>
      <div className="pdx-odds">
        <span>{pool.outcomeA} {pct(pool.totalA, pool.totalB)}</span>
        <span>{pool.outcomeB} {pct(pool.totalB, pool.totalA)}</span>
      </div>

      <p className="pdx-vol">
        Volume: {(pool.totalA + pool.totalB).toLocaleString()} XLM
      </p>

      {winnerLabel && (
        <p className="pdx-winner" role="status">🏆 Winner: {winnerLabel}</p>
      )}

      {isBettable && (
        <>
          <div className="pdx-outcomes" role="group" aria-label="Choose outcome">
            {([pool.outcomeA, pool.outcomeB] as const).map((label, i) => (
              <button
                key={i}
                className={`pdx-outcome-btn${selected === i ? ' active' : ''}`}
                onClick={() => setSelected(i as 0 | 1)}
                aria-pressed={selected === i}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="pdx-input-row">
            <input
              className="pdx-input"
              type="number"
              min="0.0000001"
              step="any"
              placeholder="Amount (XLM)"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-label="Bet amount in XLM"
            />
            <button
              className="pdx-bet-btn"
              onClick={handleBet}
              disabled={selected === null || status === 'loading'}
              aria-busy={status === 'loading'}
            >
              {status === 'loading' ? '…' : 'Bet'}
            </button>
          </div>
          {status === 'err' && <p className="pdx-error" role="alert">{message}</p>}
          {status === 'ok'  && <p className="pdx-success" role="status">{message}</p>}
        </>
      )}
    </div>
  );
}

// ── PredinexWidget (root) ─────────────────────────────────────────────────────

export function PredinexWidget({
  contractId,
  poolId,
  theme,
  onBet,
  fetchPool = defaultFetchPool,
  placeBet = defaultPlaceBet,
}: PredinexWidgetProps) {
  injectStyles();

  const [pool, setPool] = useState<WidgetPool | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (poolId === undefined) return;
    let cancelled = false;
    fetchPool(contractId, poolId)
      .then((p) => { if (!cancelled) setPool(p); })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load pool.');
      });
    return () => { cancelled = true; };
  }, [contractId, poolId, fetchPool]);

  return (
    <div className="pdx-widget" style={buildCSSVars(theme)}>
      {error && <p className="pdx-error" role="alert">{error}</p>}
      {!error && !pool && poolId !== undefined && (
        <p className="pdx-loading" role="status">Loading pool…</p>
      )}
      {pool && (
        <PoolCard
          pool={pool}
          onBet={onBet}
          placeBet={placeBet}
          contractId={contractId}
        />
      )}
      {poolId === undefined && !error && (
        <p className="pdx-muted" style={{ color: 'var(--pdx-muted)', fontSize: '0.85rem' }}>
          Provide a <code>poolId</code> prop to display a pool.
        </p>
      )}
    </div>
  );
}
