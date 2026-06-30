'use client';

import { useState, useEffect } from 'react';
import { useWallet } from './WalletAdapterProvider';
import Card from './ui/Card';
import { TrendingUp, Lock, DollarSign, AlertCircle } from 'lucide-react';

interface LPPosition {
  totalShares: string;
  depositedAmount: string;
  earnedFees: string;
  percentageOfPool: number;
  stakedShares?: string;
  stakedUntil?: number;
}

interface LPRewards {
  pending: string;
  claimed: string;
}

interface LiquidityProviderDashboardProps {
  poolId: number;
}

export default function LiquidityProviderDashboard({
  poolId,
}: LiquidityProviderDashboardProps) {
  const { address } = useWallet();
  const [lpPosition, setLpPosition] = useState<LPPosition | null>(null);
  const [rewards, setRewards] = useState<LPRewards | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'position' | 'deposit' | 'withdraw' | 'stake'>('position');

  useEffect(() => {
    if (!address) {
      setLoading(false);
      return;
    }

    const fetchLPData = async () => {
      try {
        setLoading(true);
        setError(null);
        // TODO: Fetch LP position and rewards from contract
        // const position = await predinexReadApi.getLpPosition(poolId, address);
        // const pendingRewards = await predinexReadApi.getPendingLpRewards(poolId, address);
        // setLpPosition(position);
        // setRewards({ pending: pendingRewards, claimed: '0' });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load LP data');
      } finally {
        setLoading(false);
      }
    };

    void fetchLPData();
  }, [address, poolId]);

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

  const TabButton = ({ id, label }: { id: 'position' | 'deposit' | 'withdraw' | 'stake'; label: string }) => (
    <button
      onClick={() => setActiveTab(id)}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        activeTab === id
          ? 'border-primary text-primary'
          : 'border-transparent text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </button>
  );

  return (
    <Card className="p-0">
      {/* Tab Navigation */}
      <div className="flex border-b border-border/40">
        <TabButton id="position" label="Your Position" />
        <TabButton id="deposit" label="Deposit" />
        <TabButton id="withdraw" label="Withdraw" />
        <TabButton id="stake" label="Stake" />
      </div>

      {/* Content */}
      <div className="p-6">
        {activeTab === 'position' && (
          <div>
            <h3 className="font-semibold mb-4">LP Position Summary</h3>
            {lpPosition ? (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <p className="text-xs text-muted-foreground">Deposited</p>
                  <p className="text-lg font-semibold">${lpPosition.depositedAmount}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Pool Share</p>
                  <p className="text-lg font-semibold">{lpPosition.percentageOfPool.toFixed(2)}%</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Earned Fees</p>
                  <p className="text-lg font-semibold text-green-400">${lpPosition.earnedFees}</p>
                </div>
                {lpPosition.stakedShares && (
                  <div>
                    <p className="text-xs text-muted-foreground">Staked</p>
                    <p className="text-lg font-semibold text-blue-400">{lpPosition.stakedShares}</p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No LP position found</p>
            )}

            {rewards && (
              <div className="mt-6 pt-6 border-t border-border/40">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Pending Rewards</p>
                    <p className="text-2xl font-bold text-primary">${rewards.pending}</p>
                  </div>
                  <button className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:brightness-110 transition-all">
                    Claim Rewards
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
                  placeholder="0.00"
                  className="w-full px-4 py-2 bg-background border border-border/50 rounded-lg text-foreground placeholder-muted-foreground focus:border-primary outline-none"
                />
              </div>
              <button className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:brightness-110 transition-all">
                Approve & Deposit
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
                      className="flex-1 px-2 py-1 text-xs border border-border/50 rounded hover:bg-muted/50 transition-colors"
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>
              <button className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:brightness-110 transition-all">
                Withdraw
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
                  placeholder="0.00"
                  className="w-full px-4 py-2 bg-background border border-border/50 rounded-lg text-foreground placeholder-muted-foreground focus:border-primary outline-none"
                />
              </div>
              <div>
                <label className="text-sm font-medium block mb-2">Lock Period (days)</label>
                <select className="w-full px-4 py-2 bg-background border border-border/50 rounded-lg text-foreground focus:border-primary outline-none">
                  <option value="30">30 days (1.5x rewards)</option>
                  <option value="90">90 days (2x rewards)</option>
                  <option value="180">180 days (3x rewards)</option>
                </select>
              </div>
              <button className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:brightness-110 transition-all">
                Stake & Lock
              </button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
