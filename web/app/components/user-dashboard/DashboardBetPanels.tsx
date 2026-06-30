import type { UserBet } from '@/app/lib/user-dashboard/types';
import { formatStxAmount, getBetStatusClasses } from '@/app/lib/user-dashboard/model';

interface DashboardBetPanelsProps {
  bets: UserBet[];
  isLoading: boolean;
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
                <p className="font-bold">{formatStxAmount(bet.amount)} STX</p>
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

export function DashboardActiveBetsPanel({ bets, isLoading }: DashboardBetPanelsProps) {
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
                <p className="font-bold">{formatStxAmount(bet.amount)} STX</p>
                <p className="text-xs text-muted-foreground">Active</p>
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
                <p className="font-bold">{formatStxAmount(bet.amount)} STX</p>
                {bet.winnings !== undefined && (
                  <p className="text-sm font-bold">
                    {bet.status === 'won' ? '+' : '-'}
                    {formatStxAmount(bet.winnings)} STX
                  </p>
                )}
              </div>
            </div>
          ))}
          {history.length === 0 && <p className="text-muted-foreground">No history yet.</p>}
        </div>
      )}
    </div>
  );
}
