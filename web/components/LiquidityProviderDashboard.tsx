'use client';

import { useState, useEffect, useCallback } from 'react';
import { useWallet } from './WalletAdapterProvider';
import Card from './ui/Card';
import { AlertCircle } from 'lucide-react';
import { predinexReadApi } from '@/app/lib/adapters/predinex-read-api';
import { predinexContract } from '@/app/lib/adapters/predinex-contract';
import { TxStage } from '@/app/lib/soroban-transaction-service';

interface LiquidityProviderDashboardProps {
  poolId: number;
}

export default function LiquidityProviderDashboard({
  poolId,
}: LiquidityProviderDashboardProps) {
  const wallet = useWallet();
  const { address } = wallet;
  const [lpShares, setLpShares] = useState(0);
  const [pendingRewards, setPendingRewards] = useState(0);
  const [stakedShares, setStakedShares] = useState(0);
  const [stakedUntil, setStakedUntil] = useState(0);
  const [totalShares, setTotalShares] = useState(0);
  const [totalLiquidity, setTotalLiquidity] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'position' | 'deposit' | 'withdraw' | 'stake'>('position');
  const [txStage, setTxStage] = useState<TxStage>('idle');
  const [txError, setTxError] = useState<string | null>(null);

  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawShares, setWithdrawShares] = useState('');
  const [stakeShares, setStakeShares] = useState('');
  const [lockDays, setLockDays] = useState('30');

  const fetchLPData = useCallback(async () => {
    if (!address) return;
    try {
      setLoading(true);
      setError(null);
      const [position, rewards, stake, totalSh, totalLiq] = await Promise.all([
        predinexReadApi.getLpPosition(poolId, address),
        predinexReadApi.getPendingLpRewards(poolId, address),
        predinexReadApi.getLpStake(poolId, address),
        predinexReadApi.getPool(poolId),
        predinexReadApi.getPool(poolId),
      ]);
      setLpShares(position?.shares ?? 0);
      setPendingRewards(rewards ?? 0);
      setStakedShares(stake?.shares ?? 0);
      setStakedUntil(stake?.lockUntil ?? 0);
      if (totalSh) {
        setTotalShares(totalSh.participantCount ?? 0);
      }
      if (totalLiq) {
        setTotalLiquidity((totalLiq.totalA ?? 0) + (totalLiq.totalB ?? 0));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load LP data');
    } finally {
      setLoading(false);
    }
  }, [address, poolId]);

  useEffect(() => {
    if (!address) {
      setLoading(false);
      return;
    }
    void fetchLPData();
  }, [address, fetchLPData]);

  const withTxHandling = useCallback(async (action: () => Promise<void>) => {
    setTxError(null);
    setTxStage('idle');
    try {
      await action();
      await fetchLPData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Transaction failed';
      if (msg !== 'Transaction cancelled by user') {
        setTxError(msg);
      }
    } finally {
      setTxStage('idle');
    }
  }, [fetchLPData]);

  const handleDeposit = useCallback(() => {
    const amount = Number(depositAmount);
    if (!amount || amount <= 0) return;
    void withTxHandling(async () => {
      await predinexContract.depositLiquiditySoroban({
        wallet,
        poolId,
        amountStroops: Math.floor(amount * 10_000_000),
        onStageChange: setTxStage,
      });
      setDepositAmount('');
    });
  }, [depositAmount, wallet, poolId, withTxHandling]);

  const handleWithdraw = useCallback(() => {
    const shares = Number(withdrawShares);
    if (!shares || shares <= 0) return;
    void withTxHandling(async () => {
      await predinexContract.withdrawLiquiditySoroban({
        wallet,
        poolId,
        shares: Math.floor(shares),
        onStageChange: setTxStage,
      });
      setWithdrawShares('');
    });
  }, [withdrawShares, wallet, poolId, withTxHandling]);

  const handleStake = useCallback(() => {
    const shares = Number(stakeShares);
    const days = Number(lockDays);
    if (!shares || shares <= 0 || !days) return;
    void withTxHandling(async () => {
      await predinexContract.stakeLpSoroban({
        wallet,
        poolId,
        shares: Math.floor(shares),
        durationSecs: days * 86400,
        onStageChange: setTxStage,
      });
      setStakeShares('');
    });
  }, [stakeShares, lockDays, wallet, poolId, withTxHandling]);

  const handleClaimRewards = useCallback(() => {
    if (pendingRewards <= 0) return;
    void withTxHandling(async () => {
      await predinexContract.claimLpRewardsSoroban({
        wallet,
        poolId,
        onStageChange: setTxStage,
      });
    });
  }, [pendingRewards, wallet, poolId, withTxHandling]);

  if (!address) {
    return (
      <Card className="p-6">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">Connect wallet to manage liquidity</p>
        </div>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card className="p-6 animate-pulse">
        <div className="h-32 bg-muted rounded" />
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-6 border-red-500/20 bg-red-500/10">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-200">Error loading LP data</p>
            <p className="text-xs text-red-300 mt-1">{error}</p>
          </div>
        </div>
      </Card>
    );
  }

  const isBusy = txStage !== 'idle' && txStage !== 'success' && txStage !== 'error';

  const TabButton = ({ id, label }: { id: 'position' | 'deposit' | 'withdraw' | 'stake'; label: string }) => (
    <button
      onClick={() => { setActiveTab(id); setTxError(null); }}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        activeTab === id
          ? 'border-primary text-primary'
          : 'border-transparent text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </button>
  );

  const percentageOfPool = totalLiquidity > 0 ? (lpShares / totalLiquidity) * 100 : 0;

  return (
    <Card className="p-0">
      <div className="flex border-b border-border/40">
        <TabButton id="position" label="Your Position" />
        <TabButton id="deposit" label="Deposit" />
        <TabButton id="withdraw" label="Withdraw" />
        <TabButton id="stake" label="Stake" />
      </div>

      <div className="p-6">
        {txError && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-300">{txError}</p>
            </div>
          </div>
        )}

        {txStage !== 'idle' && txStage !== 'success' && txStage !== 'error' && (
          <div className="mb-4 p-3 rounded-lg bg-primary/10 border border-primary/20">
            <p className="text-sm text-primary">
              {txStage === 'simulating' && 'Simulating transaction...'}
              {txStage === 'signing' && 'Waiting for wallet signature...'}
              {txStage === 'submitting' && 'Submitting transaction...'}
              {txStage === 'polling' && 'Waiting for confirmation...'}
            </p>
          </div>
        )}

        {activeTab === 'position' && (
          <div>
            <h3 className="font-semibold mb-4">LP Position Summary</h3>
            {lpShares > 0 ? (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <p className="text-xs text-muted-foreground">Shares</p>
                  <p className="text-lg font-semibold">{lpShares.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Pool Share</p>
                  <p className="text-lg font-semibold">{percentageOfPool.toFixed(2)}%</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Pending Rewards</p>
                  <p className="text-lg font-semibold text-green-400">{pendingRewards.toLocaleString()}</p>
                </div>
                {stakedShares > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground">Staked</p>
                    <p className="text-lg font-semibold text-blue-400">{stakedShares.toLocaleString()}</p>
                    {stakedUntil > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Locked until {new Date(stakedUntil * 1000).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No LP position found</p>
            )}

            {pendingRewards > 0 && (
              <div className="mt-6 pt-6 border-t border-border/40">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Pending Rewards</p>
                    <p className="text-2xl font-bold text-primary">{pendingRewards.toLocaleString()}</p>
                  </div>
                  <button
                    onClick={handleClaimRewards}
                    disabled={isBusy}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isBusy ? 'Processing...' : 'Claim Rewards'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'deposit' && (
          <div>
            <h3 className="font-semibold mb-4">Provide Liquidity</h3>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium block mb-2">Amount (USDC)</label>
                <input
                  type="number"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-4 py-2 bg-background border border-border/50 rounded-lg text-foreground placeholder-muted-foreground focus:border-primary outline-none"
                />
              </div>
              <button
                onClick={handleDeposit}
                disabled={isBusy || !depositAmount || Number(depositAmount) <= 0}
                className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isBusy ? 'Processing...' : 'Approve & Deposit'}
              </button>
              <p className="text-xs text-muted-foreground">
                You will receive LP tokens representing your share of the pool.
              </p>
            </div>
          </div>
        )}

        {activeTab === 'withdraw' && (
          <div>
            <h3 className="font-semibold mb-4">Withdraw Liquidity</h3>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium block mb-2">LP Shares to Withdraw</label>
                <input
                  type="number"
                  value={withdrawShares}
                  onChange={(e) => setWithdrawShares(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-4 py-2 bg-background border border-border/50 rounded-lg text-foreground placeholder-muted-foreground focus:border-primary outline-none"
                />
              </div>
              <div>
                <label className="text-sm font-medium block mb-2">Percentage</label>
                <div className="flex gap-2">
                  {[25, 50, 75, 100].map((pct) => (
                    <button
                      key={pct}
                      onClick={() => {
                        const unstaked = lpShares - stakedShares;
                        setWithdrawShares(String(Math.floor(unstaked * pct / 100)));
                      }}
                      className="flex-1 px-2 py-1 text-xs border border-border/50 rounded hover:bg-muted/50 transition-colors"
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={handleWithdraw}
                disabled={isBusy || !withdrawShares || Number(withdrawShares) <= 0}
                className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isBusy ? 'Processing...' : 'Withdraw'}
              </button>
            </div>
          </div>
        )}

        {activeTab === 'stake' && (
          <div>
            <h3 className="font-semibold mb-4">Stake LP Tokens</h3>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium block mb-2">Shares to Stake</label>
                <input
                  type="number"
                  value={stakeShares}
                  onChange={(e) => setStakeShares(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-4 py-2 bg-background border border-border/50 rounded-lg text-foreground placeholder-muted-foreground focus:border-primary outline-none"
                />
              </div>
              <div>
                <label className="text-sm font-medium block mb-2">Lock Period (days)</label>
                <select
                  value={lockDays}
                  onChange={(e) => setLockDays(e.target.value)}
                  className="w-full px-4 py-2 bg-background border border-border/50 rounded-lg text-foreground focus:border-primary outline-none"
                >
                  <option value="30">30 days (1.5x rewards)</option>
                  <option value="90">90 days (2x rewards)</option>
                  <option value="180">180 days (3x rewards)</option>
                </select>
              </div>
              <button
                onClick={handleStake}
                disabled={isBusy || !stakeShares || Number(stakeShares) <= 0}
                className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isBusy ? 'Processing...' : 'Stake & Lock'}
              </button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
