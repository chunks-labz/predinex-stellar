/**
 * MarketActivityFeed Component
 * 
 * Issue #1525: UX Improvement - Real-time market activity feed
 * Shows recent bets and activities to create engagement
 */

'use client';

import { TrendingUp, Clock, DollarSign } from 'lucide-react';
import { formatDisplayAddress } from '@/app/lib/address-display';
import { useEffect, useState } from 'react';

interface Activity {
  id: string;
  type: 'bet' | 'claim' | 'settle';
  user: string;
  outcome?: string;
  amount?: string;
  timestamp: number;
}

interface MarketActivityFeedProps {
  poolId: number;
  maxItems?: number;
}

export function MarketActivityFeed({
  poolId,
  maxItems = 10,
}: MarketActivityFeedProps) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // TODO: Replace with actual API call to fetch activities
    // Mock data for demonstration
    const mockActivities: Activity[] = [
      {
        id: '1',
        type: 'bet',
        user: 'GABC...XYZ',
        outcome: 'Outcome A',
        amount: '50',
        timestamp: Date.now() - 120000,
      },
      {
        id: '2',
        type: 'bet',
        user: 'GDEF...ABC',
        outcome: 'Outcome B',
        amount: '25',
        timestamp: Date.now() - 300000,
      },
      {
        id: '3',
        type: 'bet',
        user: 'GHIJ...DEF',
        outcome: 'Outcome A',
        amount: '100',
        timestamp: Date.now() - 600000,
      },
    ];

    setActivities(mockActivities.slice(0, maxItems));
    setIsLoading(false);
  }, [poolId, maxItems]);

  const getTimeAgo = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  const getActivityIcon = (type: Activity['type']) => {
    switch (type) {
      case 'bet':
        return <TrendingUp className="w-4 h-4 text-primary" aria-hidden="true" />;
      case 'claim':
        return <DollarSign className="w-4 h-4 text-green-400" aria-hidden="true" />;
      case 'settle':
        return <Clock className="w-4 h-4 text-blue-400" aria-hidden="true" />;
    }
  };

  const getActivityText = (activity: Activity) => {
    switch (activity.type) {
      case 'bet':
        return (
          <>
            <span className="font-medium">{formatDisplayAddress(activity.user)}</span>
            {' '}bet{' '}
            <span className="font-semibold text-primary">{activity.amount} XLM</span>
            {' '}on{' '}
            <span className="font-medium truncate max-w-[100px] inline-block align-bottom">
              {activity.outcome}
            </span>
          </>
        );
      case 'claim':
        return (
          <>
            <span className="font-medium">{formatDisplayAddress(activity.user)}</span>
            {' '}claimed winnings
          </>
        );
      case 'settle':
        return <>Market settled</>;
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="p-3 rounded-lg bg-muted/30 animate-pulse"
          >
            <div className="h-4 bg-muted/50 rounded w-3/4 mb-2" />
            <div className="h-3 bg-muted/50 rounded w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        <TrendingUp className="w-8 h-8 mx-auto mb-2 opacity-50" aria-hidden="true" />
        <p className="text-sm">No recent activity</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="w-4 h-4 text-primary" aria-hidden="true" />
        <h3 className="text-sm font-semibold">Recent Activity</h3>
      </div>

      <div className="space-y-2 max-h-[400px] overflow-y-auto custom-scrollbar">
        {activities.map((activity) => (
          <div
            key={activity.id}
            className="p-3 rounded-lg bg-muted/30 border border-border/50 hover:bg-muted/40 transition-colors"
          >
            <div className="flex items-start gap-2">
              <div className="mt-0.5">{getActivityIcon(activity.type)}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm leading-relaxed">
                  {getActivityText(activity)}
                </p>
                <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                  <Clock className="w-3 h-3" aria-hidden="true" />
                  {getTimeAgo(activity.timestamp)}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
