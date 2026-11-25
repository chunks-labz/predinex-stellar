'use client';

import { useId, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useWallet } from '@/components/WalletAdapterProvider';
import { predinexContract } from '@/lib/contract';
import { TOKEN_SYMBOL } from '@/app/lib/formatting';
import { useFocusTrap } from '@/app/lib/hooks/useFocusTrap';
import { useEscapeDismiss } from '@/app/lib/hooks/useEscapeDismiss';
import type { UserBet } from '@/app/lib/user-dashboard/types';
import { formatStxAmount } from '@/app/lib/user-dashboard/model';

interface CancelBetButtonProps {
  bet: UserBet;
  onCancelled?: () => void;
}

/**
 * #1702 — Cancelling a bet always goes through a confirmation dialog that
 * names the market and the stake, so a misclick cannot refund a position.
 */
export default function CancelBetButton({ bet, onCancelled }: CancelBetButtonProps) {
  const wallet = useWallet();
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // State updates are async; the ref blocks a second submit in the same tick.
  const inFlight = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const close = () => setIsOpen(false);
  useFocusTrap({ active: isOpen, containerRef });
  useEscapeDismiss({ active: isOpen && !isPending, onDismiss: close });

  if (!bet.cancellable || bet.outcomeIndex === undefined || bet.stakeStroops === undefined) {
    return null;
  }

  const stake = `${formatStxAmount(bet.amount)} ${TOKEN_SYMBOL}`;

  const confirm = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setIsPending(true);
    setError(null);
    try {
      await predinexContract.cancelBetSoroban({
        wallet,
        poolId: bet.poolId,
        outcome: bet.outcomeIndex!,
        amountStroops: bet.stakeStroops!,
      });
      setIsOpen(false);
      onCancelled?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel bet');
    } finally {
      inFlight.current = false;
      setIsPending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setIsOpen(true);
        }}
        className="text-xs text-red-400 hover:text-red-300 underline"
      >
        Cancel bet
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
          <div
            ref={containerRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className="bg-background border border-border rounded-2xl w-full max-w-md p-6 shadow-2xl outline-none text-left"
          >
            <h2 id={titleId} className="text-xl font-bold mb-4">Cancel bet?</h2>
            <p className="text-muted-foreground mb-2">
              Market: <strong className="text-foreground">{bet.poolTitle}</strong>
            </p>
            <p className="text-muted-foreground mb-6">
              Bet: <strong className="text-foreground">{stake} on {bet.outcome}</strong> will be refunded.
            </p>
            {error && (
              <p role="alert" className="text-red-400 text-sm mb-4">
                {error}
              </p>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={close}
                disabled={isPending}
                className="flex-1 py-3 rounded-xl border border-border hover:bg-muted font-bold disabled:opacity-50"
              >
                Keep bet
              </button>
              <button
                type="button"
                onClick={() => void confirm()}
                disabled={isPending}
                aria-busy={isPending}
                className="flex-1 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isPending && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                {isPending ? 'Cancelling…' : 'Confirm cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
