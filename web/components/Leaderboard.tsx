'use client';

import { memo, useState } from 'react';
import { Trophy, RefreshCw, AlertCircle, Users, Layers } from 'lucide-react';
import { useLeaderboard, type LeaderboardTab } from '../app/lib/hooks/useLeaderboard';
import { formatDisplayAddress } from '../app/lib/address-display';

interface LeaderboardProps {
  currentUserAddress?: string | null;
}

const RANK_COLORS: Record<number, string> = {
  1: 'text-yellow-400',
  2: 'text-slate-300',
  3: 'text-amber-600',
};

function SkeletonRows() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading leaderboard">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex items-center justify-between p-4 bg-muted/30 rounded-lg animate-pulse">
          <div className="flex items-center gap-4">
            <div className="h-5 w-8 bg-muted/50 rounded" />
            <div className="h-10 w-10 rounded-full bg-muted/50" />
            <div className="h-4 w-32 bg-muted/50 rounded" />
          </div>
          <div className="h-4 w-20 bg-muted/50 rounded" />
        </div>
      ))}
    </div>
  );
}

function formatVolume(stroops: number): string {
  if (stroops >= 1_000_000) return `${(stroops / 1_000_000).toFixed(2)} XLM`;
  return `${stroops.toLocaleString()} μXLM`;
}

const Leaderboard = memo(function Leaderboard({ currentUserAddress }: LeaderboardProps) {
  const [activeTab, setActiveTab] = useState<LeaderboardTab>('bettors');
  const { bettors, creators, userBettorRank, userCreatorRank, isLoading, error, refresh } =
    useLeaderboard(currentUserAddress);

  const userRank = activeTab === 'bettors' ? userBettorRank : userCreatorRank;

  return (
    <div className="glass-panel rounded-xl p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Trophy className="h-6 w-6 text-yellow-500" aria-hidden="true" />
          <h2 className="text-2xl font-bold">Leaderboard</h2>
        </div>
        <button
          onClick={refresh}
          disabled={isLoading}
          className="p-2 rounded-lg hover:bg-muted/50 transition-colors disabled:opacity-50"
          aria-label="Refresh leaderboard"
        >
          <RefreshCw className={`h-4 w-4 text-muted-foreground ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6" role="tablist" aria-label="Leaderboard categories">
        <button
          role="tab"
          aria-selected={activeTab === 'bettors'}
          aria-controls="tab-panel-bettors"
          id="tab-bettors"
          onClick={() => setActiveTab('bettors')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors
            ${activeTab === 'bettors' ? 'bg-primary text-primary-foreground' : 'bg-muted/30 hover:bg-muted/50 text-muted-foreground'}`}
        >
          <Users className="h-4 w-4" aria-hidden="true" />
          Top Bettors
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'creators'}
          aria-controls="tab-panel-creators"
          id="tab-creators"
          onClick={() => setActiveTab('creators')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors
            ${activeTab === 'creators' ? 'bg-primary text-primary-foreground' : 'bg-muted/30 hover:bg-muted/50 text-muted-foreground'}`}
        >
          <Layers className="h-4 w-4" aria-hidden="true" />
          Top Creators
        </button>
      </div>

      {/* Current user rank badge */}
      {userRank && (
        <p className="text-xs text-primary mb-4">
          Your rank: <span className="font-bold">#{userRank}</span>
        </p>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-3 mb-4 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400" role="alert">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </div>
      )}

      {/* Bettors panel */}
      <div
        id="tab-panel-bettors"
        role="tabpanel"
        aria-labelledby="tab-bettors"
        hidden={activeTab !== 'bettors'}
      >
        {isLoading && bettors.length === 0 ? (
          <SkeletonRows />
        ) : bettors.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground">
            <Trophy className="h-10 w-10 mx-auto mb-3 opacity-30" aria-hidden="true" />
            <p>No bettors yet. Be the first!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {bettors.map((entry) => {
              const isCurrentUser = !!currentUserAddress && entry.address === currentUserAddress;
              const rankColor = RANK_COLORS[entry.rank] ?? 'text-muted-foreground';
              return (
                <div
                  key={entry.address}
                  className={`flex items-center justify-between p-4 rounded-lg transition-colors
                    ${isCurrentUser ? 'bg-primary/10 border border-primary/30' : 'bg-muted/30 hover:bg-muted/50'}`}
                  aria-current={isCurrentUser ? 'true' : undefined}
                >
                  <div className="flex items-center gap-4">
                    <span className={`font-bold text-lg font-mono w-8 ${rankColor}`} aria-label={`Rank ${entry.rank}`}>
                      #{entry.rank}
                    </span>
                    <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary" aria-hidden="true">
                      {entry.address.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <span className="font-medium text-sm">
                        {formatDisplayAddress(entry.address)}
                        {isCurrentUser && <span className="ml-2 text-xs text-primary font-semibold">(you)</span>}
                      </span>
                      <p className="text-xs text-muted-foreground">
                        {entry.totalPredictions} bets · {entry.winPercentage.toFixed(1)}% win rate · {entry.wins} wins
                      </p>
                    </div>
                  </div>
                  <span className="font-bold text-primary text-sm">{formatVolume(entry.totalVolume)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Creators panel */}
      <div
        id="tab-panel-creators"
        role="tabpanel"
        aria-labelledby="tab-creators"
        hidden={activeTab !== 'creators'}
      >
        {isLoading && creators.length === 0 ? (
          <SkeletonRows />
        ) : creators.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground">
            <Layers className="h-10 w-10 mx-auto mb-3 opacity-30" aria-hidden="true" />
            <p>No pool creators yet. Create the first market!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {creators.map((entry) => {
              const isCurrentUser = !!currentUserAddress && entry.address === currentUserAddress;
              const rankColor = RANK_COLORS[entry.rank] ?? 'text-muted-foreground';
              return (
                <div
                  key={entry.address}
                  className={`flex items-center justify-between p-4 rounded-lg transition-colors
                    ${isCurrentUser ? 'bg-primary/10 border border-primary/30' : 'bg-muted/30 hover:bg-muted/50'}`}
                  aria-current={isCurrentUser ? 'true' : undefined}
                >
                  <div className="flex items-center gap-4">
                    <span className={`font-bold text-lg font-mono w-8 ${rankColor}`} aria-label={`Rank ${entry.rank}`}>
                      #{entry.rank}
                    </span>
                    <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary" aria-hidden="true">
                      {entry.address.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <span className="font-medium text-sm">
                        {formatDisplayAddress(entry.address)}
                        {isCurrentUser && <span className="ml-2 text-xs text-primary font-semibold">(you)</span>}
                      </span>
                      <p className="text-xs text-muted-foreground">
                        {entry.totalPools} pools created
                      </p>
                    </div>
                  </div>
                  <span className="font-bold text-primary text-sm">{formatVolume(entry.totalVolume)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});

export default Leaderboard;
