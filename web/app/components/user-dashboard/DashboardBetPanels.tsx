import type { UserBet } from '@/app/lib/user-dashboard/types';
import { formatStxAmount, getBetStatusClasses } from '@/app/lib/user-dashboard/model';

interface DashboardBetPanelsProps {
  bets: UserBet[];
  isLoading: boolean;
}

export function DashboardOverviewPanel({ bets, isLoading }: DashboardBetPanelsProps) {
  return (
    <div className="glass p-6 rounded-xl border border-border space-y-4">
      <h3 className="text-xl font-bold">Recent Activity</h3>
      {isLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : bets.length === 0 ? (
        <p className="text-muted-foreground">No bets yet. Start betting to see your activity here.</p>
      ) : (
        <div className="space-y-3">
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
        <p className="text-muted-foreground">Loading...</p>
      ) : (
        <div className="space-y-3">
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
        <p className="text-muted-foreground">Loading...</p>
      ) : (
        <div className="space-y-3">
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
