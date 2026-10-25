/**
 * BettingTipsPanel Component
 * Issue #1532: UX Iteration 2 - Contextual tips
 */
'use client';
import { Lightbulb, AlertCircle, TrendingUp, DollarSign } from 'lucide-react';

export function BettingTipsPanel() {
  const tips = [
    { icon: DollarSign, text: 'Start with small bets to test your strategy', color: 'text-blue-400' },
    { icon: TrendingUp, text: 'Higher odds mean higher risk but bigger rewards', color: 'text-green-400' },
    { icon: AlertCircle, text: 'Never bet more than you can afford to lose', color: 'text-yellow-400' },
  ];

  return (
    <div className="p-4 rounded-lg bg-gradient-to-br from-yellow-400/10 to-orange-400/5 border border-yellow-400/20">
      <div className="flex items-center gap-2 mb-3">
        <Lightbulb className="w-4 h-4 text-yellow-400" />
        <h4 className="text-sm font-semibold">Betting Tips</h4>
      </div>
      <div className="space-y-2">
        {tips.map((tip, i) => (
          <div key={i} className="flex items-start gap-2 text-sm">
            <tip.icon className={`w-4 h-4 mt-0.5 shrink-0 ${tip.color}`} />
            <span>{tip.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
