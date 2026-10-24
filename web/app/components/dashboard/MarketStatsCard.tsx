'use client';

import Link from 'next/link';
import { TrendingUp, Users, Clock, ExternalLink, CheckCircle, XCircle } from 'lucide-react';
import { MarketStatistics } from '../../lib/market-types';
import { formatCurrency, formatPercentage } from '../../lib/dashboard-utils';
import { formatTimeRemaining } from '../../lib/market-utils';
import { formatDisplayAddress } from '../../lib/address-display';

interface MarketStatsCardProps {
  markets: MarketStatistics[];
  isLoading?: boolean;
}

export default function MarketStatsCard({ markets, isLoading = false }: MarketStatsCardProps) {
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-6 bg-muted/50 rounded mb-4"></div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="glass p-6 rounded-xl animate-pulse">
              <div className="h-4 bg-muted/50 rounded mb-3"></div>
              <div className="h-6 bg-muted/50 rounded mb-4"></div>
              <div className="space-y-2">
                <div className="h-3 bg-muted/50 rounded"></div>
                <div className="h-3 bg-muted/50 rounded w-2/3"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const getStatusIcon = (status: MarketStatistics['status']) => {
    switch (status) {
      case 'active': return <Clock className="w-4 h-4 text-green-500" />;
      case 'settled': return <CheckCircle className="w-4 h-4 text-blue-500" />;
      case 'expired': return <XCircle className="w-4 h-4 text-red-500" />;
      default: return null;
    }
  };

  const getStatusColor = (status: MarketStatistics['status']) => {
    switch (status) {
      case 'active': return 'text-green-500 bg-green-500/10';
      case 'settled': return 'text-blue-500 bg-blue-500/10';
      case 'expired': return 'text-red-500 bg-red-500/10';
      default: return 'text-muted-foreground bg-muted/10';
    }
  };

  const topMarkets = markets
    .sort((a, b) => b.totalVolume - a.totalVolume)
    .slice(0, 12);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Market Statistics</h3>
        <span className="text-sm text-muted-foreground">
          Top {topMarkets.length} by volume
        </span>
      </div>

      {topMarkets.length === 0 ? (
        <div className="glass p-8 rounded-xl text-center">
          <TrendingUp className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">No market statistics available</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {topMarkets.map((market) => {
            const currentBlockHeight = 150000; // Mock current block height
            const timeRemaining = market.status === 'active' 
              ? Math.max(0, market.expiresAt - currentBlockHeight)
              : null;

            return (
              <div key={market.poolId} className="glass p-6 rounded-xl hover:border-primary/50 transition-all duration-200">
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                  <span className="text-xs font-mono text-muted-foreground">
                    #POOL-{market.poolId}
                  </span>
                  <span className={`px-2 py-1 rounded text-xs font-medium flex items-center gap-1 ${getStatusColor(market.status)}`}>
                    {getStatusIcon(market.status)}
                    {market.status.charAt(0).toUpperCase() + market.status.slice(1)}
                  </span>
                </div>

                {/* Title */}
                <Link 
                  href={`/markets/${market.poolId}`}
                  className="block mb-3 group"
                >
                  <h4 className="font-semibold group-hover:text-primary transition-colors line-clamp-2 mb-1">
                    {market.title}
                  </h4>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <ExternalLink className="w-3 h-3" />
                    <span>View details</span>
                  </div>
                </Link>

                {/* Outcomes */}
                <div className="mb-4">
                  <div className="flex justify-between items-center text-sm mb-2">
                    <span className="font-medium text-green-400">{market.outcomeAName}</span>
                    <span className="font-medium text-red-400">{market.outcomeBName}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs text-muted-foreground mb-1">
                    <span>{formatPercentage(market.currentOdds.A)}</span>
                    <span>{formatPercentage(market.currentOdds.B)}</span>
                  </div>
                  <div className="w-full h-2 bg-muted/30 rounded-full overflow-hidden">
                    <div className="h-full flex">
                      <div 
                        className="bg-green-400 transition-all duration-300"
                        style={{ width: `${market.currentOdds.A}%` }}
                      />
                      <div 
                        className="bg-red-400 transition-all duration-300"
                        style={{ width: `${market.currentOdds.B}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Statistics */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <TrendingUp className="w-4 h-4" />
                      <span>Volume</span>
                    </div>
                    <span className="font-semibold">{formatCurrency(market.totalVolume)}</span>
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Users className="w-4 h-4" />
                      <span>Participants</span>
                    </div>
                    <span className="font-semibold">{market.participantCount || 'N/A'}</span>
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Clock className="w-4 h-4" />
                      <span>
                        {market.status === 'active' ? 'Ends in' : 
                         market.status === 'settled' ? 'Settled' : 'Expired'}
                      </span>
                    </div>
                    <span className="font-semibold">
                      {market.status === 'active' && timeRemaining !== null
                        ? formatTimeRemaining(timeRemaining)
                        : market.status === 'settled'
                          ? 'Complete'
                          : 'Expired'
                      }
                    </span>
                  </div>
                </div>

                {/* Creator */}
                <div className="mt-4 pt-3 border-t border-muted/20">
                  <div className="text-xs text-muted-foreground">
                    Created by {formatDisplayAddress(market.creator)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Summary Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="glass p-4 rounded-lg text-center">
          <div className="text-2xl font-bold text-blue-500">
            {markets.filter(m => m.status === 'active').length}
          </div>
          <div className="text-sm text-muted-foreground">Active Markets</div>
        </div>
        
        <div className="glass p-4 rounded-lg text-center">
          <div className="text-2xl font-bold text-green-500">
            {formatCurrency(markets.reduce((sum, m) => sum + m.totalVolume, 0))}
          </div>
          <div className="text-sm text-muted-foreground">Total Volume</div>
        </div>
        
        <div className="glass p-4 rounded-lg text-center">
          <div className="text-2xl font-bold text-purple-500">
            {markets.length > 0 
              ? formatCurrency(markets.reduce((sum, m) => sum + m.totalVolume, 0) / markets.length)
              : formatCurrency(0)
            }
          </div>
          <div className="text-sm text-muted-foreground">Avg Market Size</div>
        </div>
        
        <div className="glass p-4 rounded-lg text-center">
          <div className="text-2xl font-bold text-yellow-500">
            {markets.reduce((sum, m) => sum + (m.participantCount || 0), 0)}
          </div>
          <div className="text-sm text-muted-foreground">Total Participants</div>
        </div>
      </div>
    </div>
  );
}