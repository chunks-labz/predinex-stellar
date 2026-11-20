'use client';
import { createScopedLogger } from '@/app/lib/logger';
const log = createScopedLogger('IncentivesDisplay');

import { useState, useEffect } from 'react';
import { useIncentives } from '../lib/hooks/useIncentives';
import { useWallet } from '@/components/WalletAdapterProvider';
import { getStacksCoreApiBaseUrl, predinexReadApi } from '../lib/adapters/predinex-read-api';
import { calculateTotalIncentive, DEFAULT_INCENTIVE_CONFIG, BetterIncentive } from '../lib/liquidity-incentives';
import { Gift, TrendingUp, Award, Zap, Loader2 } from 'lucide-react';
import { stroopsToUnits, TOKEN_SYMBOL } from '@/app/lib/formatting';

interface IncentivesDisplayProps {
  betterId?: string;
  poolId?: number;
}

interface ContractIncentive {
  id?: string;
  poolId: number;
  betterId: string;
  /** Token units (not stroops), like everything `calculateTotalIncentive` returns. */
  betAmount: number;
  /** Token units (not stroops). */
  bonusAmount: number;
  bonusType: 'early-bird' | 'volume' | 'referral' | 'loyalty';
  claimedAt?: number;
  status: 'pending' | 'claimed';
}

async function fetchIncentivesFromContract(userAddress: string): Promise<ContractIncentive[]> {
  try {
    const base = getStacksCoreApiBaseUrl();
    const response = await fetch(`${base}/extended/v1/address/${userAddress}/transactions?limit=50&type=contract_call`);
    if (!response.ok) throw new Error(`Incentive history request failed: ${response.status}`);
    const data = await response.json();
    
    const incentives: ContractIncentive[] = [];
    const results = data.results || [];
    
    for (let i = 0; i < results.length; i++) {
      const tx = results[i];
      if (tx.contract_call?.function_name === 'claim-incentive') {
        const args = tx.contract_call.function_args || [];
        const poolId = args.find((a: { name: string; repr?: string }) => a.name === 'pool-id')?.repr?.replace('u', '') || '0';
        
        incentives.push({
          id: `contract-${userAddress}-${poolId}-${tx.tx_id || i}`,
          poolId: parseInt(poolId),
          betterId: userAddress,
          betAmount: 0,
          bonusAmount: 0,
          bonusType: 'loyalty',
          claimedAt: tx.burn_block_time * 1000,
          status: 'claimed'
        });
      }
    }
    
    return incentives;
  } catch (error) {
    log.error('Failed to fetch incentives from contract:', error);
    return [];
  }
}

async function calculateRealIncentives(userAddress: string, poolId: number): Promise<ContractIncentive[]> {
  try {
    const pool = await predinexReadApi.getPool(poolId);
    if (!pool) return [];
    
    const userBet = await predinexReadApi.getUserBet(poolId, userAddress);
    if (!userBet || userBet.totalBet === 0) return [];
    
    const totalVolume = BigInt(pool.totalA) + BigInt(pool.totalB);
    const previousBetsCount = 0;
    const betUnits = stroopsToUnits(BigInt(userBet.totalBet));
    
    const { total, breakdown } = calculateTotalIncentive(
      betUnits,
      1,
      stroopsToUnits(totalVolume),
      previousBetsCount,
      false, // isReferred
      DEFAULT_INCENTIVE_CONFIG
    );
    
    const bonusType: 'early-bird' | 'volume' | 'referral' | 'loyalty' = 
      breakdown.earlyBird > 0 ? 'early-bird' :
      breakdown.volume > 0 ? 'volume' :
      'loyalty';
    
    return [{
      id: `pending-${userAddress}-${poolId}-${bonusType}`,
      poolId,
      betterId: userAddress,
      // Keep amounts in token units: the list renders them with TOKEN_SYMBOL.
      // `unitsToStroops(total)` mixed a number into BigInt maths and threw,
      // so pending incentives were always silently empty.
      betAmount: betUnits,
      bonusAmount: total,
      bonusType,
      status: 'pending'
    }];
  } catch (error) {
    log.error('Failed to calculate incentives:', error);
    return [];
  }
}

export default function IncentivesDisplay({ betterId, poolId }: IncentivesDisplayProps) {
  const { getPendingIncentives, getTotalPendingBonus, getClaimedIncentives, getTotalClaimedBonus, setIncentives } = useIncentives();
  const [selectedTab, setSelectedTab] = useState<'pending' | 'claimed'>('pending');
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { address: userAddress } = useWallet();
  
  useEffect(() => {
    if (!userAddress) return;
    const address = userAddress;
    
    async function loadIncentives() {
      setIsLoading(true);
      setLoadError(null);
      try {
        const contractIncentives = await fetchIncentivesFromContract(address);
        // Without a pool in scope (the /incentives page) there is nothing to
        // estimate; this used to query pool #0 for every user.
        const pendingIncentives =
          poolId === undefined ? [] : await calculateRealIncentives(address, poolId);
        
        const allIncentives: BetterIncentive[] = [
          ...contractIncentives.map((inc, idx) => ({
            ...inc,
            id: inc.id || `contract-${address}-${inc.poolId}-${idx}`,
            bonusType: inc.bonusType,
            status: inc.status as 'pending' | 'claimed'
          })),
          ...pendingIncentives.map((inc, idx) => ({
            ...inc,
            id: inc.id || `pending-${address}-${inc.poolId}-${idx}`,
            bonusType: inc.bonusType,
            status: inc.status as 'pending' | 'claimed'
          }))
        ];
        
        if (allIncentives.length > 0) {
          setIncentives(allIncentives);
        }
      } catch (error) {
        log.error('Error loading incentives:', error);
        setLoadError('Could not load your incentives. Please try again later.');
      } finally {
        setIsLoading(false);
      }
    }
    
    loadIncentives();
  }, [userAddress, poolId, setIncentives]);

  if (!betterId) {
    return (
      <div className="glass p-6 rounded-xl border border-border text-center">
        <Gift className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
        <p className="text-muted-foreground">Connect wallet to view incentives</p>
      </div>
    );
  }

  const pendingIncentives = getPendingIncentives(betterId);
  const claimedIncentives = getClaimedIncentives(betterId);
  const totalPending = getTotalPendingBonus(betterId);
  const totalClaimed = getTotalClaimedBonus(betterId);

  const getIncentiveIcon = (type: string) => {
    switch (type) {
      case 'early-bird':
        return <Zap className="w-4 h-4" />;
      case 'volume':
        return <TrendingUp className="w-4 h-4" />;
      case 'loyalty':
        return <Award className="w-4 h-4" />;
      default:
        return <Gift className="w-4 h-4" />;
    }
  };

  const getIncentiveColor = (type: string) => {
    switch (type) {
      case 'early-bird':
        return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
      case 'volume':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      case 'loyalty':
        return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
      default:
        return 'bg-green-500/10 text-green-400 border-green-500/20';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="glass p-6 rounded-xl border border-border">
        <h2 className="text-2xl font-bold mb-4">Liquidity Incentives</h2>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-muted/50 p-4 rounded-lg">
            <p className="text-sm text-muted-foreground">Pending Bonus</p>
            <p className="text-2xl font-bold text-yellow-400">{totalPending.toFixed(2)} {TOKEN_SYMBOL}</p>
          </div>
          <div className="bg-muted/50 p-4 rounded-lg">
            <p className="text-sm text-muted-foreground">Claimed Bonus</p>
            <p className="text-2xl font-bold text-green-400">{totalClaimed.toFixed(2)} {TOKEN_SYMBOL}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b border-border">
        <button
          type="button"
          aria-pressed={selectedTab === 'pending'}
          onClick={() => setSelectedTab('pending')}
          className={`px-4 py-2 font-bold transition-all ${selectedTab === 'pending'
              ? 'text-primary border-b-2 border-primary'
              : 'text-muted-foreground hover:text-foreground'
            }`}
        >
          Pending ({pendingIncentives.length})
        </button>
        <button
          type="button"
          aria-pressed={selectedTab === 'claimed'}
          onClick={() => setSelectedTab('claimed')}
          className={`px-4 py-2 font-bold transition-all ${selectedTab === 'claimed'
              ? 'text-primary border-b-2 border-primary'
              : 'text-muted-foreground hover:text-foreground'
            }`}
        >
          Claimed ({claimedIncentives.length})
        </button>
      </div>

      {/* Content */}
      <div className="space-y-3">
        {loadError && (
          <p role="alert" className="text-sm text-red-500 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
            {loadError}
          </p>
        )}
        {isLoading ? (
          <div role="status" className="glass p-6 rounded-xl border border-border flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            Loading incentives…
          </div>
        ) : (
        <>
        {selectedTab === 'pending' && (
          <>
            {pendingIncentives.length === 0 ? (
              <div className="glass p-6 rounded-xl border border-border text-center">
                <Gift className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-muted-foreground">No pending incentives</p>
              </div>
            ) : (
              pendingIncentives.map((incentive, idx) => (
                <div
                  key={incentive.id || idx}
                  className={`glass p-4 rounded-lg border flex justify-between items-center ${getIncentiveColor(
                    incentive.bonusType
                  )}`}
                >
                  <div className="flex items-center gap-3">
                    {getIncentiveIcon(incentive.bonusType)}
                    <div>
                      <p className="font-bold capitalize">{incentive.bonusType.replace('-', ' ')}</p>
                      <p className="text-xs text-muted-foreground">Pool #{incentive.poolId}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold">{incentive.bonusAmount.toFixed(2)} {TOKEN_SYMBOL}</p>
                    {/*
                      There is no on-chain incentive claim yet. The old button only
                      flipped local state to "claimed", so users believed they had
                      been paid and the bonus reappeared on refresh.
                    */}
                    <span className="inline-block text-xs px-2 py-1 bg-muted/50 rounded mt-1 text-muted-foreground">
                      Claiming opens soon
                    </span>
                  </div>
                </div>
              ))
            )}
          </>
        )}

        {selectedTab === 'claimed' && (
          <>
            {claimedIncentives.length === 0 ? (
              <div className="glass p-6 rounded-xl border border-border text-center">
                <Award className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-muted-foreground">No claimed incentives yet</p>
              </div>
            ) : (
              claimedIncentives.map((incentive, idx) => (
                <div
                  key={idx}
                  className={`glass p-4 rounded-lg border flex justify-between items-center ${getIncentiveColor(
                    incentive.bonusType
                  )}`}
                >
                  <div className="flex items-center gap-3">
                    {getIncentiveIcon(incentive.bonusType)}
                    <div>
                      <p className="font-bold capitalize">{incentive.bonusType.replace('-', ' ')}</p>
                      <p className="text-xs text-muted-foreground">
                        Claimed {new Date(incentive.claimedAt || 0).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <p className="font-bold">{incentive.bonusAmount.toFixed(2)} {TOKEN_SYMBOL}</p>
                </div>
              ))
            )}
          </>
        )}
        </>
        )}
      </div>

      {/* Info */}
      <div className="glass p-4 rounded-lg border border-border/50 bg-primary/5">
        <p className="text-sm text-muted-foreground">
          💡 Earn bonuses by being an early bettor, reaching volume thresholds, and betting consistently!
        </p>
      </div>
    </div>
  );
}
// IncentivesDisplay enhancement 1
// IncentivesDisplay enhancement 2
// IncentivesDisplay enhancement 3
// IncentivesDisplay enhancement 4
// IncentivesDisplay enhancement 5
// IncentivesDisplay enhancement 6
// IncentivesDisplay enhancement 7
// IncentivesDisplay enhancement 8
// IncentivesDisplay enhancement 9
// IncentivesDisplay enhancement 10
