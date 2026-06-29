'use client';

import MarketCard from '@/components/MarketCard';
import ActivityFeed from '@/app/components/ActivityFeed';
import PoolIntegration from '@/app/components/PoolIntegration';
import ActiveBetsCard from '@/app/components/dashboard/ActiveBetsCard';
import MarketStatsCard from '@/app/components/dashboard/MarketStatsCard';
import { ProcessedMarket } from '@/app/lib/market-types';

const MOCK_MARKET: ProcessedMarket = {
  poolId: 1,
  title: 'Will Stellar Lumens reach $1.00 by 2025?',
  description: 'A prediction market on the price of XLM. This market will resolve based on the price at Dec 31, 2024.',
  creator: 'GD234567890abcdefghijklmnopqrstuvwxyz123456',
  outcomeA: 'Yes',
  outcomeB: 'No',
  totalVolume: 1500000000,
  oddsA: 67,
  oddsB: 33,
  timeRemaining: 86400 * 10,
  status: 'active',
  createdAt: Math.floor(Date.now() / 1000) - 86400,
  settledAt: null,
};

const MOCK_ACTIVITIES = [
  {
    txId: 'tx1',
    type: 'bet-placed' as const,
    functionName: 'place_bet',
    timestamp: Math.floor(Date.now() / 1000) - 3600,
    status: 'success' as const,
    amount: 100000000,
    poolId: 1,
    explorerUrl: '#',
    event: {
      type: 'bet' as const,
      poolId: 1,
      amount: 100000000,
      outcome: 0,
    },
  },
  {
    txId: 'tx2',
    type: 'pool-created' as const,
    functionName: 'create_pool',
    timestamp: Math.floor(Date.now() / 1000) - 86400,
    status: 'success' as const,
    poolId: 2,
    explorerUrl: '#',
    event: {
      type: 'pool-creation' as const,
      poolId: 2,
      poolTitle: 'Next Fed Rate Hike',
    },
  },
];

export default function VisualRegressionPage() {
  return (
    <div className="p-8 space-y-12 bg-background min-h-screen">
      <h1 className="text-3xl font-bold border-b pb-4">Visual Regression Test Surface</h1>

      {/* Market Cards */}
      <section id="market-cards" className="space-y-6">
        <h2 className="text-xl font-semibold opacity-70 uppercase tracking-wider">Market Cards</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div id="market-card-default">
            <p className="text-xs mb-2 opacity-50">Default State</p>
            <MarketCard market={MOCK_MARKET} />
          </div>
          <div id="market-card-settled">
            <p className="text-xs mb-2 opacity-50">Settled State</p>
            <MarketCard
              market={{
                ...MOCK_MARKET,
                status: 'settled',
                timeRemaining: null,
                settledAt: Math.floor(Date.now() / 1000) - 3600,
              }}
            />
          </div>
          <div id="market-card-expired">
            <p className="text-xs mb-2 opacity-50">Expired State</p>
            <MarketCard
              market={{
                ...MOCK_MARKET,
                status: 'expired',
                timeRemaining: null,
              }}
            />
          </div>
        </div>
      </section>

      {/* Activity Feed */}
      <section id="activity-feed" className="space-y-6">
        <h2 className="text-xl font-semibold opacity-70 uppercase tracking-wider">Activity Feed</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          <div id="activity-feed-default" className="glass p-6 rounded-2xl">
            <p className="text-xs mb-4 opacity-50">Default State</p>
            <ActivityFeed activities={MOCK_ACTIVITIES} isLoading={false} error={null} />
          </div>
          <div id="activity-feed-loading" className="glass p-6 rounded-2xl">
            <p className="text-xs mb-4 opacity-50">Loading State</p>
            <ActivityFeed activities={[]} isLoading={true} error={null} />
          </div>
          <div id="activity-feed-empty" className="glass p-6 rounded-2xl">
            <p className="text-xs mb-4 opacity-50">Empty State</p>
            <ActivityFeed activities={[]} isLoading={false} error={null} />
          </div>
          <div id="activity-feed-error" className="glass p-6 rounded-2xl">
            <p className="text-xs mb-4 opacity-50">Error State</p>
            <ActivityFeed activities={[]} isLoading={false} error="Failed to fetch recent activity from Soroban" />
          </div>
        </div>
      </section>

      {/* Dashboard Cards */}
      <section id="dashboard-cards" className="space-y-6">
        <h2 className="text-xl font-semibold opacity-70 uppercase tracking-wider">Dashboard Cards</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div id="active-bets-card">
            <p className="text-xs mb-2 opacity-50">Active Bets</p>
            <ActiveBetsCard 
              bets={[]} 
              claimTransactions={new Map()} 
              onClaim={() => {}} 
            />
          </div>
          <div id="market-stats-card">
            <p className="text-xs mb-2 opacity-50">Market Stats</p>
            <MarketStatsCard markets={[]} />
          </div>
        </div>
      </section>
      
    </div>
  );
}
