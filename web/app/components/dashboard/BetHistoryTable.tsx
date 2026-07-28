'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { 
  Calendar, 
  Filter, 
  ArrowUpDown, 
  ExternalLink, 
  TrendingUp, 
  TrendingDown,
  CheckCircle,
  XCircle,
  Clock
} from 'lucide-react';
import { BetHistory, DashboardFilters } from '../../lib/dashboard-types';
import { formatCurrency, formatProfitLoss } from '../../lib/dashboard-utils';

interface BetHistoryTableProps {
  history: BetHistory[];
  filters: DashboardFilters;
  onFiltersChange: (filters: Partial<DashboardFilters>) => void;
  isLoading?: boolean;
}

export default function BetHistoryTable({ 
  history, 
  filters, 
  onFiltersChange, 
  isLoading = false 
}: BetHistoryTableProps) {
  const [showFilters, setShowFilters] = useState(false);

  // Filter and sort history
  const filteredHistory = useMemo(() => {
    let filtered = [...history];

    // Apply outcome filter
    if (filters.historyOutcome !== 'all') {
      filtered = filtered.filter(bet => {
        switch (filters.historyOutcome) {
          case 'won': return bet.status === 'won';
          case 'lost': return bet.status === 'lost' || bet.status === 'expired';
          case 'active': return bet.status === 'active';
          default: return true;
        }
      });
    }

    // Apply market status filter
    if (filters.historyMarketStatus !== 'all') {
      filtered = filtered.filter(bet => bet.marketStatus === filters.historyMarketStatus);
    }

    // Apply date range filter
    if (filters.historyDateRange.start || filters.historyDateRange.end) {
      filtered = filtered.filter(bet => {
        const betDate = new Date(bet.betTimestamp * 1000);
        const start = filters.historyDateRange.start;
        const end = filters.historyDateRange.end;
        
        if (start && betDate < start) return false;
        if (end && betDate > end) return false;
        return true;
      });
    }

    // Apply sorting
    filtered.sort((a, b) => {
      let aValue: number, bValue: number;
      
      switch (filters.sortBy) {
        case 'date':
          aValue = a.betTimestamp;
          bValue = b.betTimestamp;
          break;
        case 'amount':
          aValue = a.amountBet;
          bValue = b.amountBet;
          break;
        case 'profit':
          aValue = a.profitLoss;
          bValue = b.profitLoss;
          break;
        default:
          aValue = a.betTimestamp;
          bValue = b.betTimestamp;
      }
      
      return filters.sortOrder === 'desc' ? bValue - aValue : aValue - bValue;
    });

    return filtered;
  }, [history, filters]);

  // Calculate summary statistics
  const summaryStats = useMemo(() => {
    const totalBets = filteredHistory.length;
    const wonBets = filteredHistory.filter(bet => bet.status === 'won').length;
    const totalWagered = filteredHistory.reduce((sum, bet) => sum + bet.amountBet, 0);
    const totalProfit = filteredHistory.reduce((sum, bet) => sum + bet.profitLoss, 0);
    const winRate = totalBets > 0 ? (wonBets / totalBets) * 100 : 0;

    return { totalBets, wonBets, totalWagered, totalProfit, winRate };
  }, [filteredHistory]);

  const getStatusIcon = (status: BetHistory['status']) => {
    switch (status) {
      case 'won': return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'lost': return <XCircle className="w-4 h-4 text-red-500" />;
      case 'expired': return <Clock className="w-4 h-4 text-yellow-500" />;
      case 'active': return <TrendingUp className="w-4 h-4 text-blue-500" />;
      default: return null;
    }
  };

  const getStatusText = (status: BetHistory['status']) => {
    switch (status) {
      case 'won': return 'Won';
      case 'lost': return 'Lost';
      case 'expired': return 'Expired';
      case 'active': return 'Active';
      default: return 'Unknown';
    }
  };

  if (isLoading) {
    return (
      <div className="glass p-6 rounded-xl">
        <div className="h-6 bg-muted/50 rounded mb-6"></div>
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 bg-muted/30 rounded animate-pulse"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header and Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h3 className="text-lg font-semibold">Betting History</h3>
        
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 px-3 py-2 border border-muted/50 rounded-lg hover:bg-muted/50 transition-colors"
          >
            <Filter className="w-4 h-4" />
            Filters
          </button>

          <select
            value={`${filters.sortBy}-${filters.sortOrder}`}
            onChange={(e) => {
              const [sortBy, sortOrder] = e.target.value.split('-') as [typeof filters.sortBy, typeof filters.sortOrder];
              onFiltersChange({ sortBy, sortOrder });
            }}
            className="flex-1 sm:flex-none px-3 py-2 border border-muted/50 rounded-lg bg-background min-w-0"
          >
            <option value="date-desc">Newest First</option>
            <option value="date-asc">Oldest First</option>
            <option value="amount-desc">Highest Amount</option>
            <option value="amount-asc">Lowest Amount</option>
            <option value="profit-desc">Highest Profit</option>
            <option value="profit-asc">Lowest Profit</option>
          </select>
        </div>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div className="glass p-4 rounded-xl">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Outcome</label>
              <select
                value={filters.historyOutcome}
                onChange={(e) => onFiltersChange({ historyOutcome: e.target.value as DashboardFilters['historyOutcome'] })}
                className="w-full px-3 py-2 border border-muted/50 rounded-lg bg-background"
              >
                <option value="all">All Outcomes</option>
                <option value="won">Won</option>
                <option value="lost">Lost</option>
                <option value="active">Active</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">Market Status</label>
              <select
                value={filters.historyMarketStatus}
                onChange={(e) => onFiltersChange({ historyMarketStatus: e.target.value as DashboardFilters['historyMarketStatus'] })}
                className="w-full px-3 py-2 border border-muted/50 rounded-lg bg-background"
              >
                <option value="all">All Markets</option>
                <option value="active">Active</option>
                <option value="settled">Settled</option>
                <option value="expired">Expired</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">Date Range</label>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={filters.historyDateRange.start?.toISOString().split('T')[0] || ''}
                  onChange={(e) => onFiltersChange({
                    historyDateRange: {
                      ...filters.historyDateRange,
                      start: e.target.value ? new Date(e.target.value) : null
                    }
                  })}
                  className="flex-1 px-2 py-1 border border-muted/50 rounded text-xs bg-background"
                />
                <input
                  type="date"
                  value={filters.historyDateRange.end?.toISOString().split('T')[0] || ''}
                  onChange={(e) => onFiltersChange({
                    historyDateRange: {
                      ...filters.historyDateRange,
                      end: e.target.value ? new Date(e.target.value) : null
                    }
                  })}
                  className="flex-1 px-2 py-1 border border-muted/50 rounded text-xs bg-background"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Summary Statistics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="glass p-4 rounded-lg text-center">
          <div className="text-2xl font-bold text-blue-500">{summaryStats.totalBets}</div>
          <div className="text-sm text-muted-foreground">Total Bets</div>
        </div>
        <div className="glass p-4 rounded-lg text-center">
          <div className="text-2xl font-bold text-green-500">{summaryStats.winRate.toFixed(1)}%</div>
          <div className="text-sm text-muted-foreground">Win Rate</div>
        </div>
        <div className="glass p-4 rounded-lg text-center">
          <div className="text-2xl font-bold text-purple-500">{formatCurrency(summaryStats.totalWagered)}</div>
          <div className="text-sm text-muted-foreground">Total Wagered</div>
        </div>
        <div className="glass p-4 rounded-lg text-center">
          <div className={`text-2xl font-bold ${summaryStats.totalProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
            {formatProfitLoss(summaryStats.totalProfit).formatted}
          </div>
          <div className="text-sm text-muted-foreground">Net Profit</div>
        </div>
      </div>

      {/* History Table */}
      <div className="glass rounded-xl overflow-hidden">
        {filteredHistory.length === 0 ? (
          <div className="p-8 text-center">
            <Calendar className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground mb-2">No betting history found</p>
            <p className="text-sm text-muted-foreground">
              {history.length === 0 
                ? "Start betting to see your history here"
                : "Try adjusting your filters"
              }
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted/30">
                <tr>
                  <th className="text-left p-4 font-medium">Market</th>
                  <th className="text-left p-4 font-medium">Outcome</th>
                  <th className="text-left p-4 font-medium">Amount</th>
                  <th className="text-left p-4 font-medium">Status</th>
                  <th className="text-left p-4 font-medium">Profit/Loss</th>
                  <th className="text-left p-4 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {filteredHistory.map((bet, index) => {
                  const profitLossData = formatProfitLoss(bet.profitLoss);
                  
                  return (
                    <tr key={index} className="border-t border-muted/20 hover:bg-muted/20 transition-colors">
                      <td className="p-4">
                        <Link 
                          href={`/markets/${bet.poolId}`}
                          className="font-medium hover:text-primary transition-colors flex items-center gap-2"
                        >
                          <span className="truncate max-w-[120px] sm:max-w-[200px]">{bet.marketTitle}</span>
                          <ExternalLink className="w-3 h-3 flex-shrink-0" />
                        </Link>
                      </td>
                      <td className="p-4">
                        <span className="font-medium">{bet.outcomeName}</span>
                      </td>
                      <td className="p-4">
                        <span className="font-medium">{formatCurrency(bet.amountBet)}</span>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          {getStatusIcon(bet.status)}
                          <span className="text-sm">{getStatusText(bet.status)}</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <span className={`font-medium ${
                          profitLossData.isBreakeven 
                            ? 'text-muted-foreground' 
                            : profitLossData.isProfit 
                              ? 'text-green-500' 
                              : 'text-red-500'
                        }`}>
                          {profitLossData.formatted}
                        </span>
                      </td>
                      <td className="p-4 text-sm text-muted-foreground">
                        {new Date(bet.betTimestamp * 1000).toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}