'use client';

import { useState, useEffect } from 'react';
import { useWallet } from './WalletAdapterProvider';
import { useNetworkMismatch } from '@/lib/hooks/useNetworkMismatch';
import { Loader2, AlertCircle, CheckCircle, TrendingUp, Users } from 'lucide-react';
import { formatDisplayAddress } from '../lib/address-display';
import { mockPools, type Pool } from '../lib/fixtures/poolIntegration';

interface PoolStats {
  totalPools: number;
  totalVolume: number;
  activePoolsCount: number;
  settledPoolsCount: number;
}

export default function PoolIntegration() {
  const { isConnected } = useWallet();
  const { isMismatch, expectedNetworkName, switchNetwork } = useNetworkMismatch();
  const [pools, setPools] = useState<Pool[]>([]);
  const [stats, setStats] = useState<PoolStats>({
    totalPools: 0,
    totalVolume: 0,
    activePoolsCount: 0,
    settledPoolsCount: 0,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [selectedPool, setSelectedPool] = useState<Pool | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch pools on component mount
  useEffect(() => {
    fetchPools();
  }, []);

  const fetchPools = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // In a real app, this would fetch from the Stacks API
      // For now, we use fixtures for development/demo
      setPools(mockPools);
      updateStats(mockPools);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch pools');
    } finally {
      setIsLoading(false);
    }
  };

  const updateStats = (poolList: Pool[]) => {
    const activeCount = poolList.filter(p => !p.settled).length;
    const settledCount = poolList.filter(p => p.settled).length;
    const totalVolume = poolList.reduce((sum, p) => sum + p.totalA + p.totalB, 0);

    setStats({
      totalPools: poolList.length,
      totalVolume,
      activePoolsCount: activeCount,
      settledPoolsCount: settledCount,
    });
  };

  const getPoolOdds = (pool: Pool) => {
    const total = pool.totalA + pool.totalB;
    if (total === 0) return { a: 50, b: 50 };
    return {
      a: Math.round((pool.totalA / total) * 100),
      b: Math.round((pool.totalB / total) * 100),
    };
  };

  const formatSTX = (microSTX: number) => {
    return (microSTX / 1_000_000).toFixed(2);
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="glass p-8 rounded-2xl border border-border">
        <h1 className="text-4xl font-bold mb-2">Prediction Pools</h1>
        <p className="text-muted-foreground">Explore and participate in active prediction markets</p>
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
              <p className="text-3xl font-bold">{formatSTX(stats.totalVolume)} STX</p>
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

      {/* Error Message */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg flex gap-2">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Pools List */}
      <div className="space-y-4">
        {isLoading ? (
          <div className="flex justify-center items-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : pools.length === 0 ? (
          <div className="glass p-8 rounded-xl border border-border text-center">
            <p className="text-muted-foreground">No pools available yet</p>
          </div>
        ) : (
          pools.map(pool => {
            const odds = getPoolOdds(pool);
            return (
              <div
                key={pool.id}
                className="glass p-6 rounded-xl border border-border hover:border-primary/50 transition-all cursor-pointer"
                onClick={() => setSelectedPool(pool)}
              >
                <div className="space-y-4">
                  {/* Pool Header */}
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h3 className="text-xl font-bold mb-1">{pool.title}</h3>
                      <p className="text-sm text-muted-foreground">{pool.description}</p>
                    </div>
                    <div className="text-right">
                      <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                        pool.settled
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-blue-500/20 text-blue-400'
                      }`}>
                        {pool.settled ? 'Settled' : 'Active'}
                      </span>
                    </div>
                  </div>

                  {/* Outcomes */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-green-500/10 p-4 rounded-lg border border-green-500/20">
                      <p className="text-sm text-muted-foreground mb-2">{pool.outcomeA}</p>
                      <p className="text-2xl font-bold text-green-400">{formatSTX(pool.totalA)} STX</p>
                      <p className="text-xs text-muted-foreground mt-1">{odds.a}% of pool</p>
                    </div>
                    <div className="bg-red-500/10 p-4 rounded-lg border border-red-500/20">
                      <p className="text-sm text-muted-foreground mb-2">{pool.outcomeB}</p>
                      <p className="text-2xl font-bold text-red-400">{formatSTX(pool.totalB)} STX</p>
                      <p className="text-xs text-muted-foreground mt-1">{odds.b}% of pool</p>
                    </div>
                  </div>

                  {/* Pool Info */}
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Creator: {formatDisplayAddress(pool.creator)}</span>
                    <span>Expires in {pool.expiryBlock} blocks</span>
                  </div>

                  {/* Action Button */}
                  {!pool.settled && isConnected && (
                    <div className="space-y-2">
                      <button 
                        disabled={isMismatch}
                        className="w-full py-2 bg-primary hover:bg-violet-600 text-white font-bold rounded-lg transition-all disabled:opacity-50"
                      >
                        Place Bet
                      </button>
                      {isMismatch && (
                        <p className="text-xs text-red-500 font-medium text-center">
                          Please switch to {expectedNetworkName} to interact.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Refresh Button */}
      <button
        onClick={fetchPools}
        disabled={isLoading}
        className="w-full py-3 bg-primary/10 hover:bg-primary/20 text-primary font-bold rounded-xl transition-all disabled:opacity-50"
      >
        {isLoading ? 'Refreshing...' : 'Refresh Pools'}
      </button>
    </div>
  );
}
