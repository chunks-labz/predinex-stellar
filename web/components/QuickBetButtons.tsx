/**
 * QuickBetButtons Component
 * 
 * Issue #1525: UX Improvement - Quick bet amount buttons
 * Allows users to quickly select preset bet amounts
 */

'use client';

import { DollarSign } from 'lucide-react';

interface QuickBetButtonsProps {
  onSelectAmount: (amount: string) => void;
  walletBalance?: number | null;
  disabled?: boolean;
}

const QUICK_AMOUNTS = [1, 5, 10, 25, 50, 100];

export function QuickBetButtons({
  onSelectAmount,
  walletBalance,
  disabled = false,
}: QuickBetButtonsProps) {
  const availableAmounts = walletBalance
    ? QUICK_AMOUNTS.filter((amt) => amt <= walletBalance)
    : QUICK_AMOUNTS;

  const handleMaxClick = () => {
    if (walletBalance && walletBalance > 0) {
      // Leave 1 XLM for fees
      const maxBet = Math.max(0, Math.floor((walletBalance - 1) * 100) / 100);
      onSelectAmount(maxBet.toFixed(2));
    }
  };

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
        <DollarSign className="w-3 h-3" aria-hidden="true" />
        Quick Select
      </label>
      <div className="flex flex-wrap gap-2">
        {availableAmounts.map((amount) => (
          <button
            key={amount}
            type="button"
            onClick={() => onSelectAmount(amount.toString())}
            disabled={disabled}
            className="px-3 py-1.5 text-sm font-medium rounded-lg border border-border/50 
              bg-muted/30 hover:bg-muted/50 hover:border-primary/50 transition-colors
              disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label={`Bet ${amount} XLM`}
          >
            {amount} XLM
          </button>
        ))}
        {walletBalance && walletBalance > 1 && (
          <button
            type="button"
            onClick={handleMaxClick}
            disabled={disabled}
            className="px-3 py-1.5 text-sm font-medium rounded-lg border border-primary/50 
              bg-primary/10 hover:bg-primary/20 text-primary transition-colors
              disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Bet maximum amount"
          >
            Max
          </button>
        )}
      </div>
    </div>
  );
}
