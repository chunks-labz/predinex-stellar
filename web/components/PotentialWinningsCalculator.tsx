/**
 * PotentialWinningsCalculator Component
 * 
 * Issue #1525: UX Improvement - Real-time winnings calculator
 * Shows users potential returns before placing bet
 */

'use client';

import { TrendingUp, Info } from 'lucide-react';
import { useMemo } from 'react';

interface PotentialWinningsCalculatorProps {
  betAmount: string;
  selectedOutcome: number;
  outcomeAOdds: number;
  outcomeBOdds: number;
  outcomeAName: string;
  outcomeBName: string;
}

export function PotentialWinningsCalculator({
  betAmount,
  selectedOutcome,
  outcomeAOdds,
  outcomeBOdds,
  outcomeAName,
  outcomeBName,
}: PotentialWinningsCalculatorProps) {
  const calculation = useMemo(() => {
    const amount = parseFloat(betAmount);
    if (isNaN(amount) || amount <= 0) {
      return null;
    }

    const odds = selectedOutcome === 0 ? outcomeAOdds : outcomeBOdds;
    const otherOdds = selectedOutcome === 0 ? outcomeBOdds : outcomeAOdds;
    
    // Calculate potential return (simplified)
    // In reality: return = (betAmount / odds) * 100
    const potentialReturn = (amount * (100 / odds)).toFixed(2);
    const profit = (parseFloat(potentialReturn) - amount).toFixed(2);
    const roi = ((parseFloat(profit) / amount) * 100).toFixed(1);

    return {
      potentialReturn,
      profit,
      roi,
      selectedOutcomeName: selectedOutcome === 0 ? outcomeAName : outcomeBName,
    };
  }, [betAmount, selectedOutcome, outcomeAOdds, outcomeBOdds, outcomeAName, outcomeBName]);

  if (!calculation) {
    return null;
  }

  return (
    <div className="p-4 rounded-lg bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="w-4 h-4 text-primary" aria-hidden="true" />
        <h4 className="text-sm font-semibold text-primary">Potential Winnings</h4>
        <button
          type="button"
          className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Information about winnings calculation"
          title="Potential winnings if your prediction is correct"
        >
          <Info className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between items-center text-sm">
          <span className="text-muted-foreground">Your Bet</span>
          <span className="font-medium">{betAmount} XLM</span>
        </div>
        <div className="flex justify-between items-center text-sm">
          <span className="text-muted-foreground">Betting On</span>
          <span className="font-medium text-primary truncate max-w-[150px]">
            {calculation.selectedOutcomeName}
          </span>
        </div>
        <div className="h-px bg-border/50 my-2" />
        <div className="flex justify-between items-center">
          <span className="text-sm text-muted-foreground">If You Win</span>
          <span className="text-lg font-bold text-green-400">
            {calculation.potentialReturn} XLM
          </span>
        </div>
        <div className="flex justify-between items-center text-sm">
          <span className="text-muted-foreground">Profit</span>
          <span className="font-semibold text-green-400">
            +{calculation.profit} XLM ({calculation.roi}%)
          </span>
        </div>
      </div>

      <div className="mt-3 p-2 bg-muted/30 rounded text-xs text-muted-foreground">
        <p className="flex items-start gap-1">
          <Info className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            Actual winnings may vary based on pool size and final odds at settlement.
          </span>
        </p>
      </div>
    </div>
  );
}
