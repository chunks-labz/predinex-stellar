import { TOKEN_SYMBOL } from '@/app/lib/formatting';
import type { UserBet } from '@/app/lib/user-dashboard/types';
import { formatStxAmount, getBetStatusClasses, realizedPnl } from '@/app/lib/user-dashboard/model';
import CancelBetButton from './CancelBetButton';

interface DashboardBetPanelsProps {
  bets: UserBet[];
  isLoading: boolean;
  /** Called after an on-chain bet cancellation succeeds, to refresh the list. */
  onBetCancelled?: () => void;
}

/** Skeleton rows that mirror the bet list layout shown once data arrives. */
function BetRowsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-busy="true">
      <span className="sr-only">Loading bets…</span>
      {Array.from({ length: rows }).map((_, idx) => (
        <div
          key={idx}
          className="flex justify-between items-start gap-2 p-4 bg-muted/50 rounded-lg animate-pulse"
          aria-hidden="true"
        >
          <div className="flex-1 min-w-0 space-y-2">
            <div className="h-4 w-3/4 bg-muted/60 rounded" />
            <div className="h-3 w-1/3 bg-muted/40 rounded" />
          </div>
          <div className="text-right shrink-0 space-y-2">
            <div className="h-4 w-20 bg-muted/60 rounded" />
            <div className="h-3 w-14 bg-muted/40 rounded ml-auto" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * #1701 — Realized PnL with an explicit sign and the token symbol. Unsettled
 * bets or bets without a known payout show a dash, never a misleading zero.
 */
function RealizedPnl({ bet }: { bet: UserBet }) {
  const pnl = realizedPnl(bet);
  if (pnl === null) {
    return (
      <p className="text-sm text-muted-foreground">
        <span aria-hidden="true">PnL —</span>
        <span className="sr-only">Realized PnL not available</span>
      </p>
    );
  }
  const sign = pnl > 0 ? '+' : pnl < 0 ? '-' : '';
  const tone = pnl > 0 ? 'text-green-400' : pnl < 0 ? 'text-red-400' : 'text-muted-foreground';
  return (
    <p className={`text-sm font-bold ${tone}`}>
      PnL {sign}
      {formatStxAmount(Math.abs(pnl))} {TOKEN_SYMBOL}
    </p>
  );
}

export function DashboardOverviewPanel({ bets, isLoading }: DashboardBetPanelsProps) {
  return (
    <div className="glass p-6 rounded-xl border border-border space-y-4">
      <h3 className="text-xl font-bold">Recent Activity</h3>
      {isLoading ? (
        <BetRowsSkeleton />
      ) : bets.length === 0 ? (
        <p className="text-muted-foreground">No bets yet. Start betting to see your activity here.</p>
      ) : (
        <div className="space-y-3 animate-fade-in">
          {bets.slice(0, 5).map((bet, idx) => (
            <div key={idx} className="flex justify-between items-start gap-2 p-4 bg-muted/50 rounded-lg">
              <div className="flex-1 min-w-0">
                <p className="font-bold truncate">{bet.poolTitle}</p>
                <p className="text-sm text-muted-foreground">Bet on: {bet.outcome}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-bold">{formatStxAmount(bet.amount)} {TOKEN_SYMBOL}</p>
                <span
                  className={`text-xs px-2 py-1 rounded-full border ${getBetStatusClasses(bet.status)}`}
                >
                  {bet.status.charAt(0).toUpperCase() + bet.status.slice(1)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DashboardActiveBetsPanel({ bets, isLoading, onBetCancelled }: DashboardBetPanelsProps) {
  const active = bets.filter((bet) => bet.status === 'active');

  return (
    <div className="glass p-6 rounded-xl border border-border space-y-4">
      <h3 className="text-xl font-bold">Active Bets</h3>
      {isLoading ? (
        <BetRowsSkeleton />
      ) : (
        <div className="space-y-3 animate-fade-in">
          {active.map((bet, idx) => (
            <div
              key={idx}
              className="flex justify-between items-start gap-2 p-4 bg-blue-500/10 rounded-lg border border-blue-500/20"
            >
              <div className="flex-1 min-w-0">
                <p className="font-bold truncate">{bet.poolTitle}</p>
                <p className="text-sm text-muted-foreground">Bet on: {bet.outcome}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-bold">{formatStxAmount(bet.amount)} {TOKEN_SYMBOL}</p>
                <p className="text-xs text-muted-foreground">Active</p>
                <CancelBetButton bet={bet} onCancelled={onBetCancelled} />
              </div>
            </div>
          ))}
          {active.length === 0 && <p className="text-muted-foreground">No active bets.</p>}
        </div>
      )}
    </div>
  );
}

export function DashboardHistoryPanel({ bets, isLoading }: DashboardBetPanelsProps) {
  const history = bets.filter((bet) => bet.status !== 'active');

  return (
    <div className="glass p-6 rounded-xl border border-border space-y-4">
      <h3 className="text-xl font-bold">Betting History</h3>
      {isLoading ? (
        <BetRowsSkeleton />
      ) : (
        <div className="space-y-3 animate-fade-in">
          {history.map((bet, idx) => (
            <div
              key={idx}
              className={`flex justify-between items-start gap-2 p-4 rounded-lg border ${getBetStatusClasses(bet.status)}`}
            >
              <div className="flex-1 min-w-0">
                <p className="font-bold truncate">{bet.poolTitle}</p>
                <p className="text-sm text-muted-foreground">Bet on: {bet.outcome}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-bold">{formatStxAmount(bet.amount)} {TOKEN_SYMBOL}</p>
                <RealizedPnl bet={bet} />
              </div>
            </div>
          ))}
          {history.length === 0 && <p className="text-muted-foreground">No history yet.</p>}
        </div>
      )}
    </div>
  );
}
