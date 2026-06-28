'use client';
import { createScopedLogger } from '@/app/lib/logger';
const log = createScopedLogger('PoolIntegration');

import { useId, useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@/components/WalletAdapterProvider';
import { useNetworkMismatch } from '@/lib/hooks/useNetworkMismatch';
import {
  Loader2,
  AlertCircle,
  CheckCircle,
  TrendingUp,
  Users,
  RefreshCw,
  Search,
  ChevronDown,
} from 'lucide-react';
import { formatDisplayAddress } from '../lib/address-display';
import { getMarkets, type Pool } from '../lib/stacks-api';

/**
 * Number of pools rendered on initial load and per additional "Load More" click.
 * Issue: #674 — web pools list pagination.
 */
const POOLS_PER_PAGE = 20;

type StatusFilter = 'all' | 'active' | 'settled';

interface PoolStats {
  totalPools: number;
  totalVolume: number;
  activePoolsCount: number;
  settledPoolsCount: number;
}

export default function PoolIntegration() {
  const router = useRouter();
  const { isConnected, connect } = useWallet();
  const { isMismatch, expectedNetworkName } = useNetworkMismatch();
  const searchInputId = useId();
  const [pools, setPools] = useState<Pool[]>([]);
  const [stats, setStats] = useState<PoolStats>({
    totalPools: 0,
    totalVolume: 0,
    activePoolsCount: 0,
    settledPoolsCount: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [displayedCount, setDisplayedCount] = useState(POOLS_PER_PAGE);

  // Fetch pools on component mount.
  // fetchPools is stable (useCallback with no changing deps) so the effect
  // runs exactly once and the exhaustive-deps rule is satisfied.

  // All deps are stable: state setters never change, getMarkets is a module-level import.
  const fetchPools = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const allPools = await getMarkets('all');
      setPools(allPools);
      setStats({
        totalPools: allPools.length,
        totalVolume: allPools.reduce((sum, p) => sum + p.totalA + p.totalB, 0),
        activePoolsCount: allPools.filter(p => !p.settled).length,
        settledPoolsCount: allPools.filter(p => p.settled).length,
      });
      // Reset pagination to first page whenever fresh data is loaded.
      setDisplayedCount(POOLS_PER_PAGE);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch pools');
      log.error('Error fetching pools:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPools();
  }, [fetchPools]);

  // Compatibility with search and filter (#674): pagination operates on the
  // *filtered* list, so when a user narrows results any remaining pages snap
  // back to the first page of the new view.
  const filteredPools = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return pools.filter((pool) => {
      if (statusFilter !== 'all') {
        if (statusFilter === 'active' && pool.settled) return false;
        if (statusFilter === 'settled' && !pool.settled) return false;
      }
      if (normalizedQuery) {
        const haystack = `${pool.title} ${pool.description}`.toLowerCase();
        if (!haystack.includes(normalizedQuery)) return false;
      }
      return true;
    });
  }, [pools, searchQuery, statusFilter]);

  // Cap `displayedCount` whenever the filter shrinks the dataset so we never
  // show an empty "Load More" button on a list that's already complete.
  const effectiveDisplayedCount = Math.min(displayedCount, filteredPools.length);
  const visiblePools = useMemo(
    () => filteredPools.slice(0, effectiveDisplayedCount),
    [filteredPools, effectiveDisplayedCount],
  );
  const hasMorePools = effectiveDisplayedCount < filteredPools.length;

  const handleFilterChange = useCallback(
    (next: { search?: string; status?: StatusFilter }) => {
      if (next.search !== undefined) setSearchQuery(next.search);
      if (next.status !== undefined) setStatusFilter(next.status);
      setDisplayedCount(POOLS_PER_PAGE);
    },
    [],
  );

  const handleLoadMore = useCallback(() => {
    setDisplayedCount((previous) => previous + POOLS_PER_PAGE);
  }, []);

  const getPoolOdds = (pool: Pool) => {
    const total = pool.totalA + pool.totalB;
    if (total === 0) return { a: 50, b: 50 };
    return {
      a: Math.round((pool.totalA / total) * 100),
      b: Math.round((pool.totalB / total) * 100),
    };
  };

  const formatXLM = (stroops: number) => {
    return (stroops / 10_000_000).toFixed(2);
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="glass p-8 rounded-2xl border border-border">
        <h1 className="text-4xl font-bold mb-2">Prediction Pools</h1>
        <p className="text-muted-foreground">Explore and participate in active on-chain prediction markets</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="glass p-6 rounded-xl border border-border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Total Pools</p>
              <p className="text-3xl font-bold">{stats.totalPools}</p>
            </div>
            <TrendingUp className="w-8 h-8 text-primary opacity-50" />
          </div>
        </div>

        <div className="glass p-6 rounded-xl border border-border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Total Volume</p>
              <p className="text-3xl font-bold">{formatXLM(stats.totalVolume)} XLM</p>
            </div>
            <TrendingUp className="w-8 h-8 text-green-500 opacity-50" />
          </div>
        </div>

        <div className="glass p-6 rounded-xl border border-border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Active Pools</p>
              <p className="text-3xl font-bold">{stats.activePoolsCount}</p>
            </div>
            <Users className="w-8 h-8 text-blue-500 opacity-50" />
          </div>
        </div>

        <div className="glass p-6 rounded-xl border border-border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Settled Pools</p>
              <p className="text-3xl font-bold">{stats.settledPoolsCount}</p>
            </div>
            <CheckCircle className="w-8 h-8 text-green-500 opacity-50" />
          </div>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="glass p-4 rounded-xl border border-border flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="relative flex-1 max-w-md">
          <label htmlFor={searchInputId} className="sr-only">
            Search pools
          </label>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" aria-hidden="true" />
          <input
            id={searchInputId}
            type="search"
            value={searchQuery}
            onChange={(event) => handleFilterChange({ search: event.target.value })}
            placeholder="Search pools by title or description…"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        <div
          role="group"
          aria-label="Filter pools by status"
          className="flex items-center gap-1 p-1 rounded-lg border border-border bg-background/60"
        >
          {(['all', 'active', 'settled'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => handleFilterChange({ status: value })}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                statusFilter === value
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted/50'
              }`}
              aria-pressed={statusFilter === value}
            >
              {value === 'all' ? 'All' : value === 'active' ? 'Active' : 'Settled'}
            </button>
          ))}
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg flex gap-2">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-red-600 font-medium">Failed to load pools</p>
            <p className="text-xs text-red-500 mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Pools List */}
      <div className="space-y-4">
        {isLoading ? (
          <div className="flex flex-col justify-center items-center py-12 gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading pools from blockchain...</p>
          </div>
        ) : filteredPools.length === 0 ? (
          <div className="glass p-8 rounded-xl border border-border text-center">
            <p className="text-muted-foreground">
              {pools.length === 0
                ? 'No pools available yet. Be the first to create one!'
                : 'No pools match the current search or filter.'}
            </p>
          </div>
        ) : (
          visiblePools.map(pool => {
            const odds = getPoolOdds(pool);
            return (
              <div
                key={pool.id}
                className="glass p-6 rounded-xl border border-border hover:border-primary/50 transition-all"
              >
                <div className="space-y-4">
                  {/* Pool Header */}
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h3 className="text-xl font-bold mb-1">{pool.title}</h3>
                      <p className="text-sm text-muted-foreground">{pool.description}</p>
                    </div>
                    <div className="text-right">
                      <span className={`px-3 py-1 rounded-full text-xs font-bold ${pool.settled
                          ? 'bg-green-500/20 text-green-400'
                          : pool.status === 'expired'
                            ? 'bg-gray-500/20 text-gray-400'
                            : 'bg-blue-500/20 text-blue-400'
                        }`}>
                        {pool.status === 'settled' ? 'Settled' : pool.status === 'expired' ? 'Expired' : 'Active'}
                      </span>
                    </div>
                  </div>

                  {/* Outcomes */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className={`p-4 rounded-lg border ${pool.settled && pool.winningOutcome === 0
                        ? 'bg-green-500/20 border-green-500/40'
                        : 'bg-green-500/10 border-green-500/20'
                      }`}>
                      <p className="text-sm text-muted-foreground mb-2">{pool.outcomeA}</p>
                      <p className="text-2xl font-bold text-green-400">{formatXLM(pool.totalA)} XLM</p>
                      <p className="text-xs text-muted-foreground mt-1">{odds.a}% of pool</p>
                      {pool.settled && pool.winningOutcome === 0 && (
                        <p className="text-xs text-green-400 font-bold mt-2">✓ Winner</p>
                      )}
                    </div>
                    <div className={`p-4 rounded-lg border ${pool.settled && pool.winningOutcome === 1
                        ? 'bg-red-500/20 border-red-500/40'
                        : 'bg-red-500/10 border-red-500/20'
                      }`}>
                      <p className="text-sm text-muted-foreground mb-2">{pool.outcomeB}</p>
                      <p className="text-2xl font-bold text-red-400">{formatXLM(pool.totalB)} XLM</p>
                      <p className="text-xs text-muted-foreground mt-1">{odds.b}% of pool</p>
                      {pool.settled && pool.winningOutcome === 1 && (
                        <p className="text-xs text-red-400 font-bold mt-2">✓ Winner</p>
                      )}
                    </div>
                  </div>

                  {/* Pool Info */}
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Creator: {formatDisplayAddress(pool.creator)}</span>
                    <span>Expires in {pool.expiry} seconds</span>
                  </div>

                  {/* Action Button */}
                  {!pool.settled && (
                    <div className="space-y-2">
                      <button
                        onClick={isMismatch ? undefined : (isConnected ? () => {} : connect)}
                        disabled={isMismatch}
                        className="w-full py-2 bg-primary hover:bg-violet-600 text-white font-bold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isMismatch ? 'Wrong Network' : isConnected ? 'Place Bet' : 'Connect Wallet'}
                      </button>
                      {isMismatch && (
                        <p className="text-[10px] text-center text-yellow-500 font-medium">
                          Please switch to {expectedNetworkName} to interact
                        </p>
                      )}
                    </div>
                  )}

                  {!pool.settled && pool.status === 'active' && !isConnected && (
                    <button
                      onClick={() => router.push(`/markets/${pool.id}`)}
                      className="w-full py-2 bg-primary/20 hover:bg-primary/30 text-primary font-bold rounded-lg transition-all"
                    >
                      View Pool Details
                    </button>
                  )}

                  {pool.settled && (
                    <div className="text-center py-2 text-sm text-muted-foreground">
                      Pool settled • Outcome: {pool.winningOutcome === 0 ? pool.outcomeA : pool.outcomeB}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Load More button — only rendered when more than one page is available,
          so we never bother small lists with a disabled button. */}
      {!isLoading && !error && filteredPools.length > POOLS_PER_PAGE && (
        <div className="flex flex-col items-center gap-2 pt-2">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={!hasMorePools}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-border bg-card hover:bg-muted/50 text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label={
              hasMorePools
                ? `Load ${Math.min(POOLS_PER_PAGE, filteredPools.length - effectiveDisplayedCount)} more pools`
                : 'All pools loaded'
            }
          >
            {hasMorePools ? 'Load More' : 'All Pools Loaded'}
            <ChevronDown className={`w-4 h-4 ${hasMorePools ? '' : 'opacity-30'}`} aria-hidden="true" />
          </button>
          <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
            Showing {visiblePools.length} of {filteredPools.length} pool{filteredPools.length === 1 ? '' : 's'}
            {filteredPools.length !== pools.length && searchQuery && ` (filtered from ${pools.length})`}
          </p>
        </div>
      )}

      {/* Refresh Button */}
      <button
        onClick={fetchPools}
        disabled={isLoading}
        className="w-full py-3 bg-primary/10 hover:bg-primary/20 text-primary font-bold rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2"
      >
        <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        {isLoading ? 'Refreshing...' : 'Refresh Pools'}
      </button>
    </div>
  );
}
