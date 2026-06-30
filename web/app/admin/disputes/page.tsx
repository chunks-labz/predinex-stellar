'use client';

import { useEffect, useState } from 'react';
import Navbar from '@/components/Navbar';
import AuthGuard from '@/components/AuthGuard';
import { useWallet } from '@/components/WalletAdapterProvider';
import { useToast } from '@/app/providers/ToastProvider';
import { predinexReadApi } from '@/app/lib/adapters/predinex-read-api';
import { predinexContract } from '@/app/lib/adapters/predinex-contract';
import { getPoolAdminActivityFromSoroban } from '@/app/lib/soroban-event-service';
import { getRuntimeConfig } from '@/app/lib/runtime-config';
import { TxStage } from '@/app/lib/soroban-transaction-service';
import { ProcessedMarket } from '@/app/lib/market-types';
import type { ActivityItem } from '@/app/lib/adapters/types';
import {
  getPoolCountFromSoroban,
  getPoolsBatchFromSoroban,
} from '@/app/lib/soroban-read-api';
import { fetchCurrentBlockHeightLive } from '@/app/lib/market-utils';
import { Loader2, AlertTriangle, Snowflake, CheckCircle, Clock } from 'lucide-react';
import RouteErrorBoundary from '@/components/RouteErrorBoundary';
import { TransactionFeeModal } from '@/components/TransactionFeeModal';
import MarketCard from '@/components/MarketCard';
import { formatRelativeTime } from '@/app/lib/formatting';

export default function AdminDisputes() {
  const wallet = useWallet();
  const { showToast } = useToast();
  
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [checkingAccess, setCheckingAccess] = useState(true);
  
  const [pools, setPools] = useState<ProcessedMarket[]>([]);
  const [loadingPools, setLoadingPools] = useState(false);
  
  const [selectedPool, setSelectedPool] = useState<ProcessedMarket | null>(null);
  const [history, setHistory] = useState<ActivityItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [stage, setStage] = useState<TxStage>('idle');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feePrompt, setFeePrompt] = useState<{ feeStroops: string; resolve: (v: boolean) => void } | null>(null);

  useEffect(() => {
    async function checkAccess() {
      if (!wallet.isConnected || !wallet.address) return;
      setCheckingAccess(true);
      try {
        const freezeAdmin = await predinexReadApi.getFreezeAdmin();
        setIsAdmin(wallet.address === freezeAdmin);
      } catch (err) {
        console.error('Failed to get freeze admin', err);
        setIsAdmin(false);
      } finally {
        setCheckingAccess(false);
      }
    }
    checkAccess();
  }, [wallet.isConnected, wallet.address]);

  async function loadPools() {
    setLoadingPools(true);
    try {
      // Use the Soroban read path directly — normalizePool correctly maps
      // the on-chain Frozen/Disputed status enum to 'frozen'/'disputed'.
      // We must NOT use fetchAllPools→processMarketData→calculateMarketStatus
      // because that pipeline only returns 'active'|'settled'|'expired'.
      const count = await getPoolCountFromSoroban();
      if (count === 0) { setPools([]); return; }

      const sorobanPools = await getPoolsBatchFromSoroban(1, count);
      const { height: blockHeight } = await fetchCurrentBlockHeightLive();

      // Map Pool (from soroban-read-api/stacks-api) → ProcessedMarket,
      // preserving the status that normalizePool already set correctly.
      const allMarkets: ProcessedMarket[] = sorobanPools.map(pool => {
        const totalVolume = pool.totalA + pool.totalB;
        const oddsA = totalVolume > 0 ? Math.round((pool.totalA / totalVolume) * 100) : 50;
        const oddsB = totalVolume > 0 ? Math.round((pool.totalB / totalVolume) * 100) : 50;
        const timeRemaining = pool.expiry > blockHeight ? pool.expiry - blockHeight : null;

        return {
          poolId: pool.id,
          title: pool.title,
          description: pool.description,
          outcomeA: pool.outcomeA,
          outcomeB: pool.outcomeB,
          totalVolume,
          oddsA,
          oddsB,
          status: pool.status, // preserved from normalizePool — NOT recomputed
          timeRemaining,
          createdAt: 0,
          settledAt: null,
          creator: pool.creator,
          participantCount: pool.participant_count,
        };
      });

      const filtered = allMarkets.filter(p => p.status === 'frozen' || p.status === 'disputed');
      setPools(filtered);
    } catch (err) {
      console.error('Failed to load pools', err);
      showToast('Failed to load pools', 'error');
    } finally {
      setLoadingPools(false);
    }
  }

  useEffect(() => {
    if (isAdmin) {
      loadPools();
    }
  }, [isAdmin]);

  async function loadHistory(poolId: number) {
    setLoadingHistory(true);
    try {
      const config = getRuntimeConfig().soroban;
      const evs = await getPoolAdminActivityFromSoroban(poolId, 20, config);
      setHistory(evs);
    } catch (err) {
      console.error('Failed to load history', err);
    } finally {
      setLoadingHistory(false);
    }
  }

  useEffect(() => {
    if (selectedPool) {
      loadHistory(selectedPool.poolId);
    }
  }, [selectedPool]);

  const handleAction = async (action: 'freeze' | 'dispute' | 'unfreeze', poolId: number) => {
    if (!wallet.isConnected) return;
    setIsSubmitting(true);
    setStage('idle');
    try {
      if (action === 'freeze') {
        await predinexContract.freezePoolSoroban({
          wallet,
          poolId,
          onStageChange: setStage,
          onFeeEstimated: (fee) => new Promise((resolve) => setFeePrompt({ feeStroops: fee, resolve })),
        });
      } else if (action === 'dispute') {
        await predinexContract.disputePoolSoroban({
          wallet,
          poolId,
          onStageChange: setStage,
          onFeeEstimated: (fee) => new Promise((resolve) => setFeePrompt({ feeStroops: fee, resolve })),
        });
      } else if (action === 'unfreeze') {
        await predinexContract.unfreezePoolSoroban({
          wallet,
          poolId,
          onStageChange: setStage,
          onFeeEstimated: (fee) => new Promise((resolve) => setFeePrompt({ feeStroops: fee, resolve })),
        });
      }
      showToast(`Successfully executed ${action} on pool ${poolId}`, 'success');
      loadPools();
      if (selectedPool && selectedPool.poolId === poolId) {
        loadHistory(poolId);
      }
    } catch (err) {
      console.error(`Failed to ${action} pool`, err);
      showToast(`Failed to ${action} pool: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setIsSubmitting(false);
      setStage('idle');
      setFeePrompt(null);
    }
  };

  const getStageLabel = (s: TxStage) => {
    switch (s) {
      case 'simulating': return 'Simulating...';
      case 'signing': return 'Waiting for signature...';
      case 'submitting': return 'Submitting...';
      case 'polling': return 'Confirming...';
      default: return 'Processing...';
    }
  };

  return (
    <main className="min-h-screen bg-background">
      <Navbar />
      <RouteErrorBoundary routeName="AdminDisputes">
        <AuthGuard>
          <div className="container mx-auto px-4 py-8">
            <h1 className="text-3xl font-bold mb-8">Admin Disputes Dashboard</h1>

            {checkingAccess ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                Checking access...
              </div>
            ) : !isAdmin ? (
              <div className="p-6 rounded-xl border border-red-500/30 bg-red-500/10 text-red-500 flex items-center gap-3">
                <AlertTriangle className="w-6 h-6" />
                <div>
                  <h2 className="font-bold">Access Denied</h2>
                  <p className="text-sm opacity-80">You must be the FreezeAdmin to view this page.</p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* List View */}
                <div className="lg:col-span-2 space-y-4">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold">Frozen & Disputed Pools</h2>
                    <button 
                      onClick={loadPools}
                      disabled={loadingPools}
                      className="text-sm bg-muted/50 hover:bg-muted p-2 rounded"
                    >
                      {loadingPools ? 'Refreshing...' : 'Refresh'}
                    </button>
                  </div>

                  {pools.length === 0 && !loadingPools ? (
                    <div className="p-8 text-center border rounded-xl bg-card/30 text-muted-foreground">
                      No frozen or disputed pools found.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {pools.map(pool => (
                        <div 
                          key={pool.poolId} 
                          onClick={() => setSelectedPool(pool)}
                          className={`cursor-pointer transition-all ${selectedPool?.poolId === pool.poolId ? 'ring-2 ring-primary scale-[1.02]' : ''}`}
                        >
                          <MarketCard market={pool} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Detail View */}
                <div className="lg:col-span-1">
                  <div className="sticky top-24 border rounded-xl bg-card/30 p-6">
                    <h2 className="text-xl font-semibold mb-4">Pool Actions</h2>
                    
                    {!selectedPool ? (
                      <p className="text-muted-foreground text-sm">Select a pool to view actions and history.</p>
                    ) : (
                      <div className="space-y-6">
                        <div>
                          <p className="text-sm text-muted-foreground mb-1">Selected Pool</p>
                          <p className="font-bold text-lg">#{selectedPool.poolId}: {selectedPool.title}</p>
                          <p className="text-sm inline-flex items-center gap-1 mt-1 font-medium capitalize">
                            Status: <span className={selectedPool.status === 'frozen' ? 'text-cyan-500' : 'text-orange-500'}>{selectedPool.status}</span>
                          </p>
                        </div>

                        <div className="space-y-3">
                          <button
                            disabled={isSubmitting || selectedPool.status === 'frozen'}
                            onClick={() => handleAction('freeze', selectedPool.poolId)}
                            className="w-full flex items-center justify-center gap-2 bg-cyan-500/20 text-cyan-500 hover:bg-cyan-500/30 p-3 rounded-lg font-semibold disabled:opacity-50"
                          >
                            <Snowflake className="w-4 h-4" />
                            Freeze Pool
                          </button>

                          <button
                            disabled={isSubmitting || selectedPool.status === 'disputed'}
                            onClick={() => handleAction('dispute', selectedPool.poolId)}
                            className="w-full flex items-center justify-center gap-2 bg-orange-500/20 text-orange-500 hover:bg-orange-500/30 p-3 rounded-lg font-semibold disabled:opacity-50"
                          >
                            <AlertTriangle className="w-4 h-4" />
                            Dispute Pool
                          </button>

                          <button
                            disabled={isSubmitting || (selectedPool.status !== 'frozen' && selectedPool.status !== 'disputed')}
                            onClick={() => handleAction('unfreeze', selectedPool.poolId)}
                            className="w-full flex items-center justify-center gap-2 bg-blue-500/20 text-blue-500 hover:bg-blue-500/30 p-3 rounded-lg font-semibold disabled:opacity-50"
                          >
                            <CheckCircle className="w-4 h-4" />
                            Unfreeze Pool
                          </button>

                          {isSubmitting && (
                            <p className="text-sm text-center text-primary animate-pulse mt-2">{getStageLabel(stage)}</p>
                          )}
                        </div>

                        <div className="pt-6 border-t">
                          <h3 className="font-semibold mb-4">Event History</h3>
                          {loadingHistory ? (
                            <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                          ) : history.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No recent admin events found.</p>
                          ) : (
                            <ul className="space-y-4">
                              {history.map((ev, i) => (
                                <li key={i} className="flex gap-3 text-sm">
                                  <div className="mt-1">
                                    <Clock className="w-4 h-4 text-muted-foreground" />
                                  </div>
                                  <div>
                                    <p className="font-medium capitalize">{ev.functionName.replace('pool_', '')}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {formatRelativeTime(ev.timestamp)}
                                    </p>
                                    <a 
                                      href={ev.explorerUrl} 
                                      target="_blank" 
                                      rel="noreferrer"
                                      className="text-xs text-primary hover:underline mt-1 inline-block"
                                    >
                                      View Transaction
                                    </a>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            
            <TransactionFeeModal
              isOpen={!!feePrompt}
              actionName="Admin Action"
              feeStroops={feePrompt?.feeStroops || '0'}
              onConfirm={() => {
                feePrompt?.resolve(true);
                setFeePrompt(null);
              }}
              onCancel={() => {
                feePrompt?.resolve(false);
                setFeePrompt(null);
                setIsSubmitting(false);
                setStage('idle');
              }}
              isConfirming={stage === 'signing' || stage === 'submitting' || stage === 'polling'}
            />
          </div>
        </AuthGuard>
      </RouteErrorBoundary>
    </main>
  );
}
