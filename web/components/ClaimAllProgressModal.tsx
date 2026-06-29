'use client';

import { CheckCircle2, Loader2, XCircle, Coins, Clock } from 'lucide-react';
import type { ClaimAllState } from '@/app/lib/hooks/useClaimAll';

interface ClaimAllProgressModalProps {
  isOpen: boolean;
  state: ClaimAllState;
  /** Pool id → market title, for friendlier per-pool labels. */
  titles?: Record<number, string>;
  onClose: () => void;
}

/**
 * Progress modal for the batched "Claim All" flow.
 *
 * Shows an overall `Claiming X/N…` counter plus a per-pool status list, and
 * resolves into success / partial-failure / failed states once the batched
 * transaction settles.
 */
export default function ClaimAllProgressModal({
  isOpen,
  state,
  titles = {},
  onClose,
}: ClaimAllProgressModalProps) {
  if (!isOpen) return null;

  const total = state.pools.length;
  const inFlight = state.status === 'claiming';
  const isDone = state.status === 'success' || state.status === 'partial';
  const isFailed = state.status === 'failed';

  // While the atomic batch is in flight we surface a "Claiming X/N…" counter;
  // once it settles we show how many pools actually paid out.
  const header = inFlight
    ? `Claiming ${Math.min(state.claimedCount + 1, total)}/${total}…`
    : isFailed
      ? 'Claim failed'
      : `Claimed ${state.claimedCount}/${total}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Claim all winnings progress"
    >
      <div className="bg-background border border-border rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            {inFlight && <Loader2 className="w-5 h-5 animate-spin text-primary" />}
            {isDone && <CheckCircle2 className="w-5 h-5 text-green-500" />}
            {isFailed && <XCircle className="w-5 h-5 text-red-500" />}
            <h2 className="text-xl font-bold" data-testid="claim-all-header">
              {header}
            </h2>
          </div>

          <ul className="space-y-2 max-h-72 overflow-y-auto" data-testid="claim-all-pool-list">
            {state.pools.map((pool) => (
              <li
                key={pool.poolId}
                data-testid={`claim-all-pool-${pool.poolId}`}
                className="flex items-center justify-between gap-3 p-3 rounded-xl bg-muted/40 border border-border"
              >
                <span className="font-medium truncate">
                  {titles[pool.poolId] ?? `Pool #${pool.poolId}`}
                </span>
                <span className="flex items-center gap-1.5 text-sm shrink-0">
                  {pool.status === 'claiming' && (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-primary" />
                      <span className="text-muted-foreground">Claiming…</span>
                    </>
                  )}
                  {pool.status === 'claimed' && (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                      <span className="text-green-500">Claimed</span>
                    </>
                  )}
                  {pool.status === 'skipped' && (
                    <>
                      <Coins className="w-4 h-4 text-muted-foreground" />
                      <span className="text-muted-foreground">No payout</span>
                    </>
                  )}
                  {pool.status === 'pending' && (
                    <>
                      <Clock className="w-4 h-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Pending</span>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>

          {isFailed && state.error && (
            <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-500">
              {state.error}
            </div>
          )}

          {!inFlight && (
            <button
              onClick={onClose}
              data-testid="claim-all-close"
              className="mt-6 w-full px-4 py-3 rounded-xl bg-primary text-primary-foreground font-bold hover:brightness-110 transition-all"
            >
              {isFailed ? 'Close' : 'Done'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
