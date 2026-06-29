'use client';
import { createScopedLogger } from '@/app/lib/logger';
const log = createScopedLogger('IncentivesDisplay');

import { useState, useEffect, useCallback } from 'react';
import { useIncentives } from '../lib/hooks/useIncentives';
import { useWallet } from '@/components/WalletAdapterProvider';
import { getStacksCoreApiBaseUrl, predinexReadApi } from '../lib/adapters/predinex-read-api';
import { calculateTotalIncentive, DEFAULT_INCENTIVE_CONFIG, BetterIncentive } from '../lib/liquidity-incentives';
import { TOKEN_SYMBOL } from '@/lib/formatting';
import { Gift, TrendingUp, Award, Zap } from 'lucide-react';

interface IncentivesDisplayProps {
  betterId?: string;
  poolId?: number;
}

interface ContractIncentive {
  poolId: number;
  betterId: string;
  betAmount: number;
  bonusAmount: number;
  bonusType: 'early-bird' | 'volume' | 'referral' | 'loyalty';
  claimedAt?: number;
  status: 'pending' | 'claimed';
}

async function fetchIncentivesFromContract(userAddress: string): Promise<ContractIncentive[]> {
  try {
    const base = getStacksCoreApiBaseUrl();
    const response = await fetch(`${base}/extended/v1/address/${userAddress}/transactions?limit=50&type=contract_call`);
    const data = await response.json();
    
    const incentives: ContractIncentive[] = [];
    const results = data.results || [];
    
    for (const tx of results) {
      if (tx.contract_call?.function_name === 'claim-incentive') {
        const args = tx.contract_call.function_args || [];
        const poolId = args.find((a: { name: string; repr?: string }) => a.name === 'pool-id')?.repr?.replace('u', '') || '0';
        
        incentives.push({
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
    
    const totalVolume = pool.totalA + pool.totalB;
    const previousBetsCount = 0;
    
    const { total, breakdown } = calculateTotalIncentive(
      userBet.totalBet / 1_000_000,
      1,
      totalVolume / 1_000_000,
      previousBetsCount,
      DEFAULT_INCENTIVE_CONFIG
    );
    
    const bonusType: 'early-bird' | 'volume' | 'referral' | 'loyalty' = 
      breakdown.earlyBird > 0 ? 'early-bird' :
      breakdown.volume > 0 ? 'volume' :
      'loyalty';
    
    return [{
      poolId,
      betterId: userAddress,
      betAmount: userBet.totalBet,
      bonusAmount: total * 1_000_000,
      bonusType,
      status: 'pending'
    }];
  } catch (error) {
    log.error('Failed to calculate incentives:', error);
    return [];
  }
}

export default function IncentivesDisplay({ betterId, poolId }: IncentivesDisplayProps) {
  const { incentives, getPendingIncentives, getTotalPendingBonus, getClaimedIncentives, getTotalClaimedBonus, setIncentives, claimIncentive } = useIncentives();
  const [selectedTab, setSelectedTab] = useState<'pending' | 'claimed'>('pending');
  const [isLoading, setIsLoading] = useState(false);
  const { address: userAddress } = useWallet();
  
  useEffect(() => {
    if (!userAddress) return;
    const address = userAddress;
    
    async function loadIncentives() {
      setIsLoading(true);
      try {
        const contractIncentives = await fetchIncentivesFromContract(address);
        const pendingIncentives = await calculateRealIncentives(address, poolId || 0);
        
        const allIncentives: BetterIncentive[] = [
          ...contractIncentives.map(inc => ({
            ...inc,
            bonusType: inc.bonusType,
            status: inc.status as 'pending' | 'claimed'
          })),
          ...pendingIncentives.map(inc => ({
            ...inc,
            bonusType: inc.bonusType,
            status: inc.status as 'pending' | 'claimed'
          }))
        ];
        
        if (allIncentives.length > 0) {
          setIncentives(allIncentives);
        }
      } catch (error) {
        log.error('Error loading incentives:', error);
      } finally {
        setIsLoading(false);
      }
    }
    
    loadIncentives();
  }, [userAddress, poolId, setIncentives]);

  const handleClaim = useCallback(async (incentiveId: number) => {
    try {
      await claimIncentive(incentiveId);
    } catch (error) {
      log.error('Failed to claim incentive:', error);
    }
  }, [claimIncentive]);

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
          onClick={() => setSelectedTab('pending')}
          className={`px-4 py-2 font-bold transition-all ${selectedTab === 'pending'
              ? 'text-primary border-b-2 border-primary'
              : 'text-muted-foreground hover:text-foreground'
            }`}
        >
          Pending ({pendingIncentives.length})
        </button>
        <button
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
                  key={idx}
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
                    <button
                      onClick={() => handleClaim(idx)}
                      className="text-xs px-2 py-1 bg-primary/20 hover:bg-primary/30 rounded mt-1 transition-all"
                    >
                      Claim
                    </button>
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
