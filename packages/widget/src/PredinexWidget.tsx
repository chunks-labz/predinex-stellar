import React, { useState, useEffect, useCallback, useRef } from 'react';
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

function formatAmount(amount: number): string {
  return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function estimatePayout(pool: WidgetPool, outcome: 0 | 1, amount: number): number {
  const totalPool = pool.totalA + pool.totalB;
  const selectedPool = outcome === 0 ? pool.totalA : pool.totalB;
  const postBetPool = totalPool + amount;
  const postBetSelected = selectedPool + amount;

  if (postBetSelected <= 0) return amount;
  return (amount / postBetSelected) * postBetPool;
}

function PoolCard({ pool, onBet, placeBet, contractId }: PoolCardProps) {
  const [selected, setSelected] = useState<0 | 1 | null>(null);
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle');
  const [message, setMessage] = useState('');
  const [isConfirming, setIsConfirming] = useState(false);

  const isSettled = pool.status === 'settled';
  const isBettable = pool.status === 'open';

  const parsedAmount = parseFloat(amount);
  const hasValidAmount = amount !== '' && !Number.isNaN(parsedAmount) && parsedAmount > 0;
  const expectedPayout = selected === null || !hasValidAmount ? 0 : estimatePayout(pool, selected, parsedAmount);

  const handleOpenConfirm = useCallback(() => {
    if (selected === null) return;
    if (!hasValidAmount) {
      setStatus('err');
      setMessage('Enter a valid amount.');
      return;
    }
    setStatus('idle');
    setMessage('');
    setIsConfirming(true);
  }, [selected, hasValidAmount]);

  const handleCancelConfirm = useCallback(() => {
    setIsConfirming(false);
  }, []);

  const handleBet = useCallback(async () => {
    if (selected === null || !hasValidAmount) return;
    const amt = parsedAmount;
    setIsConfirming(false);
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
  }, [selected, hasValidAmount, parsedAmount, contractId, pool.id, placeBet, onBet]);

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
              onClick={handleOpenConfirm}
              disabled={selected === null || status === 'loading'}
              aria-busy={status === 'loading'}
            >
              {status === 'loading' ? '…' : 'Bet'}
            </button>
          </div>
          {status === 'err' && <p className="pdx-error" role="alert">{message}</p>}
          {status === 'ok'  && <p className="pdx-success" role="status">{message}</p>}
          {isConfirming && selected !== null && hasValidAmount && (
            <div className="pdx-confirm-backdrop" role="presentation">
              <div className="pdx-confirm-modal" role="dialog" aria-modal="true" aria-label="Confirm wager">
                <h3 className="pdx-confirm-title">Confirm your wager</h3>
                <div className="pdx-confirm-grid">
                  <div>
                    <span className="pdx-confirm-label">Outcome</span>
                    <p className="pdx-confirm-value">{selected === 0 ? pool.outcomeA : pool.outcomeB}</p>
                  </div>
                  <div>
                    <span className="pdx-confirm-label">Amount</span>
                    <p className="pdx-confirm-value">{formatAmount(parsedAmount)} XLM</p>
                  </div>
                  <div>
                    <span className="pdx-confirm-label">Expected payout</span>
                    <p className="pdx-confirm-value">{formatAmount(expectedPayout)} XLM</p>
                  </div>
                </div>
                <p className="pdx-confirm-note">
                  Review the numbers carefully. Confirming will submit the wager immediately.
                </p>
                <div className="pdx-confirm-actions">
                  <button type="button" className="pdx-cancel-btn" onClick={handleCancelConfirm}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="pdx-confirm-btn"
                    onClick={() => void handleBet()}
                    disabled={status === 'loading'}
                  >
                    {status === 'loading' ? 'Submitting…' : 'Confirm wager'}
                  </button>
                </div>
              </div>
            </div>
          )}
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
  const fetchPoolRef = useRef(fetchPool);
  fetchPoolRef.current = fetchPool;

  useEffect(() => {
    if (poolId === undefined) return;
    let cancelled = false;
    setError(null);
    fetchPoolRef.current(contractId, poolId)
      .then((p) => { if (!cancelled) { setError(null); setPool(p); } })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load pool.');
      });
    return () => { cancelled = true; };
  }, [contractId, poolId]);

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
