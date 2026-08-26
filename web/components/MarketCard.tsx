'use client';

import Link from 'next/link';
import { Clock, TrendingUp, Users, CheckCircle, XCircle, Star, StarOff, Snowflake, AlertTriangle } from 'lucide-react';
import { ProcessedMarket } from '@/app/lib/market-types';
import { formatTokenAmount } from '@/app/lib/formatting';
import { blocksToSeconds } from '@/app/lib/countdown-utils';
import { formatDisplayAddress } from '@/app/lib/address-display';
import { usePoolFavorites } from '@/app/lib/hooks/usePoolFavorites';
import { usePoolComparison, POOL_COMPARISON_MAX } from '@/app/lib/hooks/usePoolComparison';
import CountdownTimer from '@/components/CountdownTimer';

interface MarketCardProps {
  market: ProcessedMarket;
}

export default function MarketCard({ market }: MarketCardProps) {
  const { isFavorite, toggleFavorite } = usePoolFavorites();
  const favorite = isFavorite(market.poolId);
  const compare = usePoolComparison();
  const isCompared = compare.isSelected(market.poolId);
  const compareDisabled = !isCompared && compare.atCapacity;

  const getStatusColor = (status: ProcessedMarket['status']) => {
    switch (status) {
      case 'active':
        return 'bg-green-500/10 text-green-500';
      case 'settled':
        return 'bg-blue-500/10 text-blue-500';
      case 'expired':
        return 'bg-red-500/10 text-red-500';
      case 'frozen':
        return 'bg-cyan-500/10 text-cyan-500';
      case 'disputed':
        return 'bg-orange-500/10 text-orange-500';
      default:
        return 'bg-gray-500/10 text-gray-500';
    }
  };

  const getStatusIcon = (status: ProcessedMarket['status']) => {
    switch (status) {
      case 'active':
        return <Clock className="w-3 h-3" />;
      case 'settled':
        return <CheckCircle className="w-3 h-3" />;
      case 'expired':
        return <XCircle className="w-3 h-3" />;
      case 'frozen':
        return <Snowflake className="w-3 h-3" />;
      case 'disputed':
        return <AlertTriangle className="w-3 h-3" />;
      default:
        return null;
    }
  };

  const getStatusText = (status: ProcessedMarket['status']) => {
    switch (status) {
      case 'active':
        return 'Active';
      case 'settled':
        return 'Settled';
      case 'expired':
        return 'Expired';
      case 'frozen':
        return 'Frozen';
      case 'disputed':
        return 'Disputed';
      default:
        return 'Unknown';
    }
  };

  return (
    <Link href={`/markets/${market.poolId}`} aria-label={`View market: ${market.title}`} className="block h-full min-w-0">
      <div className="glass p-4 sm:p-6 rounded-xl hover:border-primary/50 transition-all duration-200 cursor-pointer group h-full flex flex-col justify-between hover:shadow-lg hover:shadow-primary/10 overflow-x-hidden min-w-0">
        {/* Header */}
        <div className="min-w-0">
          <div className="flex justify-between items-start mb-4">
            <span className="text-xs font-mono text-muted-foreground truncate">
              #POOL-{market.poolId}
            </span>
            <div className="flex items-center gap-2">
              <span
                className={`px-2 py-1 rounded text-xs font-medium flex items-center gap-1 shrink-0 ${getStatusColor(market.status)}`}
                aria-label={`Status: ${getStatusText(market.status)}`}
              >
                {getStatusIcon(market.status)}
                {getStatusText(market.status)}
              </span>

              <button
                type="button"
                aria-label={favorite ? `Unfavorite pool #${market.poolId}` : `Favorite pool #${market.poolId}`}
                aria-pressed={favorite}
                title={favorite ? 'Remove bookmark' : 'Bookmark pool'}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleFavorite(market.poolId);
                }}
                className={`h-11 w-11 flex items-center justify-center rounded-lg border transition-colors shrink-0 ${
                  favorite
                    ? 'bg-yellow-400/10 border-yellow-400/30 text-yellow-400 hover:bg-yellow-400/15'
                    : 'bg-muted/30 border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
              >
                {favorite ? (
                  <Star className="w-5 h-5" fill="currentColor" strokeWidth={2} aria-hidden="true" />
                ) : (
                  <StarOff className="w-5 h-5" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          {/* Compare selection */}
          <label
            className={`flex items-center gap-2 mb-3 min-h-[44px] text-xs ${
              compareDisabled ? 'text-muted-foreground/60 cursor-not-allowed' : 'text-muted-foreground cursor-pointer'
            }`}
            onClick={(e) => e.stopPropagation()}
            title={compareDisabled ? `You can compare at most ${POOL_COMPARISON_MAX} pools` : undefined}
          >
            <input
              type="checkbox"
              checked={isCompared}
              disabled={compareDisabled}
              onChange={() => compare.toggle(market.poolId)}
              onClick={(e) => {
                e.stopPropagation();
              }}
              aria-label={
                isCompared
                  ? `Remove pool #${market.poolId} from comparison`
                  : `Add pool #${market.poolId} to comparison`
              }
              className="h-6 w-6 rounded border-border/70 text-primary focus:ring-primary cursor-pointer shrink-0"
            />
            <span className="truncate">
              {isCompared
                ? 'In comparison'
                : compareDisabled
                  ? `Compare full (${POOL_COMPARISON_MAX})`
                  : 'Add to compare'}
            </span>
          </label>

          {/* Title and Description */}
          {market.coverImage && (
            <img
              src={market.coverImage}
              alt=""
              aria-hidden="true"
              className="w-full h-28 object-cover rounded-lg mb-3"
            />
          )}
          <h3 className="text-lg sm:text-xl font-bold mb-2 group-hover:text-primary transition-colors line-clamp-2 break-words">
            {market.title}
          </h3>
          <p className="text-sm text-muted-foreground mb-4 sm:mb-6 line-clamp-3">
            {market.description}
          </p>
        </div>

        {/* Market Info */}
        <div className="space-y-4 shrink-0">
          {/* Outcomes */}
          <div className="space-y-2">
            <div className="flex justify-between items-center text-sm p-3 bg-muted/30 rounded-lg min-w-0">
              <div className="flex items-center gap-2 truncate min-w-0">
                <span className="font-medium text-green-400 truncate">{market.outcomeA}</span>
                <span className="text-xs text-muted-foreground shrink-0">({market.oddsA}%)</span>
              </div>
              <span className="text-muted-foreground text-xs shrink-0 px-2" aria-hidden="true">vs</span>
              <div className="flex items-center gap-2 truncate min-w-0 justify-end">
                <span className="text-xs text-muted-foreground shrink-0">({market.oddsB}%)</span>
                <span className="font-medium text-red-400 truncate">{market.outcomeB}</span>
              </div>
            </div>

            {/* Odds visualization bar */}
            <div
              className="w-full h-2 bg-muted/30 rounded-full overflow-hidden"
              role="img"
              aria-label={`Odds: ${market.outcomeA} ${market.oddsA}%, ${market.outcomeB} ${market.oddsB}%`}
            >
              <div className="h-full flex">
                <div
                  className="bg-green-400 transition-all duration-300"
                  style={{ width: `${market.oddsA}%` }}
                />
                <div
                  className="bg-red-400 transition-all duration-300"
                  style={{ width: `${market.oddsB}%` }}
                />
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="flex justify-between items-center text-sm">
            <div className="flex items-center gap-1 text-muted-foreground truncate min-w-0">
              <TrendingUp className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{formatTokenAmount(BigInt(Math.round(market.totalVolume)))}</span>
            </div>
            <div className="flex items-center gap-1 text-muted-foreground shrink-0">
              <CountdownTimer
                secondsRemaining={
                  market.status === 'expired' ? null : blocksToSeconds(market.timeRemaining)
                }
                settled={market.status === 'settled'}
                showIcon
              />
            </div>
          </div>

          {/* Creator info */}
          <div className="flex items-center gap-1 text-xs text-muted-foreground pt-2 border-t border-muted/20 truncate">
            <Users className="w-3 h-3 shrink-0" aria-hidden="true" />
            <span className="truncate">Created by {formatDisplayAddress(market.creator)}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
