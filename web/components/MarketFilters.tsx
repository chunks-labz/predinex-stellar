/**
 * MarketFilters Component
 * 
 * Issue #1524: UX Improvement Iteration 4 - Advanced market filtering
 * Allows users to filter markets by status, category, volume, and time
 */

'use client';

import { Filter, TrendingUp, Clock, DollarSign, Grid } from 'lucide-react';
import { useState } from 'react';

export interface FilterOptions {
  status: 'all' | 'active' | 'settled' | 'expired';
  category: 'all' | 'sports' | 'crypto' | 'politics' | 'entertainment';
  minVolume: number;
  timeframe: 'all' | '24h' | '7d' | '30d';
  sortBy: 'volume' | 'participants' | 'newest' | 'ending-soon';
}

interface MarketFiltersProps {
  onFilterChange: (filters: FilterOptions) => void;
  initialFilters?: Partial<FilterOptions>;
}

export function MarketFilters({ onFilterChange, initialFilters }: MarketFiltersProps) {
  const [filters, setFilters] = useState<FilterOptions>({
    status: initialFilters?.status || 'all',
    category: initialFilters?.category || 'all',
    minVolume: initialFilters?.minVolume || 0,
    timeframe: initialFilters?.timeframe || 'all',
    sortBy: initialFilters?.sortBy || 'volume',
  });

  const [isExpanded, setIsExpanded] = useState(false);

  const updateFilter = <K extends keyof FilterOptions>(key: K, value: FilterOptions[K]) => {
    const newFilters = { ...filters, [key]: value };
    setFilters(newFilters);
    onFilterChange(newFilters);
  };

  const resetFilters = () => {
    const defaultFilters: FilterOptions = {
      status: 'all',
      category: 'all',
      minVolume: 0,
      timeframe: 'all',
      sortBy: 'volume',
    };
    setFilters(defaultFilters);
    onFilterChange(defaultFilters);
  };

  return (
    <div className="glass p-4 rounded-xl space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Filter className="w-5 h-5 text-primary" aria-hidden="true" />
          <h3 className="font-semibold text-lg">Filters</h3>
        </div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="lg:hidden text-sm text-primary hover:text-primary/80 transition-colors"
          aria-expanded={isExpanded}
          aria-controls="filter-panel"
        >
          {isExpanded ? 'Hide' : 'Show'}
        </button>
      </div>

      <div
        id="filter-panel"
        className={`space-y-4 ${isExpanded ? 'block' : 'hidden lg:block'}`}
      >
        {/* Status Filter */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-muted-foreground flex items-center gap-1">
            <Clock className="w-4 h-4" aria-hidden="true" />
            Market Status
          </label>
          <div className="grid grid-cols-2 gap-2">
            {(['all', 'active', 'settled', 'expired'] as const).map((status) => (
              <button
                key={status}
                onClick={() => updateFilter('status', status)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  filters.status === status
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted/30 hover:bg-muted/50'
                }`}
                aria-pressed={filters.status === status}
              >
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Category Filter */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-muted-foreground flex items-center gap-1">
            <Grid className="w-4 h-4" aria-hidden="true" />
            Category
          </label>
          <select
            value={filters.category}
            onChange={(e) => updateFilter('category', e.target.value as FilterOptions['category'])}
            className="w-full px-3 py-2 rounded-lg bg-muted/30 border border-border/50 
              focus:outline-none focus:ring-2 focus:ring-primary text-sm"
            aria-label="Filter by category"
          >
            <option value="all">All Categories</option>
            <option value="sports">Sports</option>
            <option value="crypto">Crypto</option>
            <option value="politics">Politics</option>
            <option value="entertainment">Entertainment</option>
          </select>
        </div>

        {/* Minimum Volume */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-muted-foreground flex items-center gap-1">
            <DollarSign className="w-4 h-4" aria-hidden="true" />
            Min Volume: {filters.minVolume} XLM
          </label>
          <input
            type="range"
            min="0"
            max="10000"
            step="100"
            value={filters.minVolume}
            onChange={(e) => updateFilter('minVolume', parseInt(e.target.value))}
            className="w-full"
            aria-label="Minimum volume filter"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>0</span>
            <span>10K XLM</span>
          </div>
        </div>

        {/* Timeframe */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-muted-foreground flex items-center gap-1">
            <Clock className="w-4 h-4" aria-hidden="true" />
            Created Within
          </label>
          <div className="grid grid-cols-2 gap-2">
            {(['all', '24h', '7d', '30d'] as const).map((time) => (
              <button
                key={time}
                onClick={() => updateFilter('timeframe', time)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  filters.timeframe === time
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted/30 hover:bg-muted/50'
                }`}
                aria-pressed={filters.timeframe === time}
              >
                {time === 'all' ? 'All Time' : time}
              </button>
            ))}
          </div>
        </div>

        {/* Sort By */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-muted-foreground flex items-center gap-1">
            <TrendingUp className="w-4 h-4" aria-hidden="true" />
            Sort By
          </label>
          <select
            value={filters.sortBy}
            onChange={(e) => updateFilter('sortBy', e.target.value as FilterOptions['sortBy'])}
            className="w-full px-3 py-2 rounded-lg bg-muted/30 border border-border/50 
              focus:outline-none focus:ring-2 focus:ring-primary text-sm"
            aria-label="Sort markets by"
          >
            <option value="volume">Highest Volume</option>
            <option value="participants">Most Participants</option>
            <option value="newest">Newest First</option>
            <option value="ending-soon">Ending Soon</option>
          </select>
        </div>

        {/* Reset Button */}
        <button
          onClick={resetFilters}
          className="w-full px-4 py-2 rounded-lg bg-muted/30 hover:bg-muted/50 
            text-sm font-medium transition-colors"
        >
          Reset Filters
        </button>
      </div>
    </div>
  );
}
