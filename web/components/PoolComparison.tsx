/**
 * PoolComparison Component
 * 
 * Issue #1524: UX Improvement Iteration 4 - Side-by-side pool comparison
 * Allows users to compare multiple pools in a table format
 */

'use client';

import { X, TrendingUp, Users, Clock, DollarSign, CheckCircle } from 'lucide-react';
import { ProcessedMarket } from '@/app/lib/market-types';
import { formatTokenAmount } from '@/app/lib/formatting';
import Link from 'next/link';

interface PoolComparisonProps {
  pools: ProcessedMarket[];
  onRemove: (poolId: number) => void;
  onClearAll: () => void;
}

export function PoolComparison({ pools, onRemove, onClearAll }: PoolComparisonProps) {
  if (pools.length === 0) {
    return (
      <div className="glass p-8 rounded-xl text-center">
        <p className="text-muted-foreground">
          No pools selected for comparison. Add pools from the market list to compare them side-by-side.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">
          Comparing {pools.length} Pool{pools.length !== 1 ? 's' : ''}
        </h2>
        <button
          onClick={onClearAll}
          className="px-4 py-2 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 
            transition-colors text-sm font-medium"
        >
          Clear All
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[800px]">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left p-4 text-sm font-semibold text-muted-foreground">
                Attribute
              </th>
              {pools.map((pool) => (
                <th key={pool.poolId} className="p-4 text-center relative">
                  <button
                    onClick={() => onRemove(pool.poolId)}
                    className="absolute top-2 right-2 p-1 rounded-full bg-red-500/10 
                      text-red-500 hover:bg-red-500/20 transition-colors"
                    aria-label={`Remove pool ${pool.poolId} from comparison`}
                  >
                    <X className="w-4 h-4" />
                  </button>
                  <div className="text-xs font-mono text-muted-foreground mb-1">
                    #POOL-{pool.poolId}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Title */}
            <tr className="border-b border-border/50">
              <td className="p-4 text-sm font-medium text-muted-foreground">
                Title
              </td>
              {pools.map((pool) => (
                <td key={pool.poolId} className="p-4">
                  <Link
                    href={`/markets/${pool.poolId}`}
                    className="text-sm font-semibold hover:text-primary transition-colors line-clamp-2"
                  >
                    {pool.title}
                  </Link>
                </td>
              ))}
            </tr>

            {/* Status */}
            <tr className="border-b border-border/50">
              <td className="p-4 text-sm font-medium text-muted-foreground">
                Status
              </td>
              {pools.map((pool) => (
                <td key={pool.poolId} className="p-4 text-center">
                  <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${
                    pool.status === 'active' ? 'bg-green-500/10 text-green-500' :
                    pool.status === 'settled' ? 'bg-blue-500/10 text-blue-500' :
                    'bg-red-500/10 text-red-500'
                  }`}>
                    {pool.status === 'active' && <Clock className="w-3 h-3" />}
                    {pool.status === 'settled' && <CheckCircle className="w-3 h-3" />}
                    {pool.status.charAt(0).toUpperCase() + pool.status.slice(1)}
                  </span>
                </td>
              ))}
            </tr>

            {/* Outcomes */}
            <tr className="border-b border-border/50">
              <td className="p-4 text-sm font-medium text-muted-foreground">
                Outcomes
              </td>
              {pools.map((pool) => (
                <td key={pool.poolId} className="p-4">
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-green-400 font-medium truncate">{pool.outcomeA}</span>
                      <span className="text-muted-foreground ml-2">{pool.oddsA}%</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-red-400 font-medium truncate">{pool.outcomeB}</span>
                      <span className="text-muted-foreground ml-2">{pool.oddsB}%</span>
                    </div>
                  </div>
                </td>
              ))}
            </tr>

            {/* Total Volume */}
            <tr className="border-b border-border/50">
              <td className="p-4 text-sm font-medium text-muted-foreground">
                <div className="flex items-center gap-1">
                  <DollarSign className="w-4 h-4" />
                  Total Volume
                </div>
              </td>
              {pools.map((pool) => (
                <td key={pool.poolId} className="p-4 text-center">
                  <span className="text-sm font-bold">
                    {formatTokenAmount(BigInt(Math.round(pool.totalVolume)))}
                  </span>
                </td>
              ))}
            </tr>

            {/* Participants */}
            <tr className="border-b border-border/50">
              <td className="p-4 text-sm font-medium text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Users className="w-4 h-4" />
                  Participants
                </div>
              </td>
              {pools.map((pool) => (
                <td key={pool.poolId} className="p-4 text-center">
                  <span className="text-sm font-medium">
                    {pool.participantCount || 'N/A'}
                  </span>
                </td>
              ))}
            </tr>

            {/* Time Remaining */}
            <tr className="border-b border-border/50">
              <td className="p-4 text-sm font-medium text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Clock className="w-4 h-4" />
                  Time Remaining
                </div>
              </td>
              {pools.map((pool) => (
                <td key={pool.poolId} className="p-4 text-center">
                  <span className="text-sm">
                    {pool.status === 'settled' || pool.status === 'expired' 
                      ? 'Ended' 
                      : `${Math.floor(pool.timeRemaining / 24)}d ${pool.timeRemaining % 24}h`}
                  </span>
                </td>
              ))}
            </tr>

            {/* Creator */}
            <tr>
              <td className="p-4 text-sm font-medium text-muted-foreground">
                Creator
              </td>
              {pools.map((pool) => (
                <td key={pool.poolId} className="p-4 text-center">
                  <span className="text-xs font-mono text-muted-foreground">
                    {pool.creator.slice(0, 8)}...{pool.creator.slice(-4)}
                  </span>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-3 justify-center pt-4">
        {pools.map((pool) => (
          <Link
            key={pool.poolId}
            href={`/markets/${pool.poolId}`}
            className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 
              text-primary-foreground font-medium transition-colors text-sm"
          >
            View Pool #{pool.poolId}
          </Link>
        ))}
      </div>
    </div>
  );
}
