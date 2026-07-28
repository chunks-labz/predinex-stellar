'use client';

import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import SearchBar from '@/components/SearchBar';
import FilterPresets from './FilterPresets';
import type { FilterPreset } from '../lib/hooks/useFilterPresets';
import type { MarketFilters, MarketStatusFilter, SortOption, TimeRangeFilter } from '../lib/market-types';
import { TOKEN_SYMBOL } from '@/lib/formatting';

interface MarketFilterBarProps {
  filters: MarketFilters;
  assetOptions: string[];
  onSearchChange: (search: string) => void;
  onStatusChange: (status: MarketStatusFilter) => void;
  onAssetChange: (asset: string) => void;
  onMinVolumeChange: (value: string) => void;
  onMaxVolumeChange: (value: string) => void;
  onTimeRangeChange: (timeRange: TimeRangeFilter) => void;
  onSortChange: (sort: SortOption) => void;
  onReset: () => void;
  hasActiveFilters: boolean;
  // Filter preset props — optional so existing usages without presets still compile.
  presets?: FilterPreset[];
  canSavePreset?: boolean;
  maxPresets?: number;
  onApplyPreset?: (filters: MarketFilters) => void;
  onSavePreset?: (name: string, filters: MarketFilters) => void;
  onDeletePreset?: (id: string) => void;
}

const statusOptions: Array<{ value: MarketStatusFilter; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'open', label: 'Open' },
  { value: 'settled', label: 'Settled' },
  { value: 'disputed', label: 'Disputed' },
  { value: 'frozen', label: 'Frozen' },
];

const timeRangeOptions: Array<{ value: TimeRangeFilter; label: string }> = [
  { value: 'all', label: 'Any time' },
  { value: 'ending-24h', label: 'Ending in 24h' },
  { value: 'ending-7d', label: 'Ending in 7d' },
  { value: 'created-7d', label: 'Created in 7d' },
  { value: 'created-30d', label: 'Created in 30d' },
];

const sortOptions: Array<{ value: SortOption; label: string }> = [
  { value: 'newest', label: 'Newest' },
  { value: 'ending-soon', label: 'Ending Soon' },
  { value: 'volume', label: 'Highest Volume' },
  { value: 'participants', label: 'Most Participants' },
];

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground" htmlFor={htmlFor}>
      {children}
    </label>
  );
}

const controlClass =
  'h-11 w-full rounded-lg border border-muted/50 bg-muted/30 px-3 text-sm outline-none transition-colors focus:border-primary/50 focus:ring-2 focus:ring-primary/30';

export default function MarketFilterBar({
  filters,
  assetOptions,
  onSearchChange,
  onStatusChange,
  onAssetChange,
  onMinVolumeChange,
  onMaxVolumeChange,
  onTimeRangeChange,
  onSortChange,
  onReset,
  hasActiveFilters,
  presets,
  canSavePreset,
  maxPresets,
  onApplyPreset,
  onSavePreset,
  onDeletePreset,
}: MarketFilterBarProps) {
  const visibleAssetOptions = Array.from(
    new Set([
      ...(assetOptions.length > 0 ? assetOptions : [TOKEN_SYMBOL]),
      ...(filters.asset && filters.asset !== 'all' ? [filters.asset] : []),
    ]),
  ).sort();

  return (
    <section className="rounded-xl border border-border bg-card/30 p-4" aria-label="Market search and filters">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <SlidersHorizontal className="h-4 w-4 text-primary" />
          Filters
        </div>
        <button
          type="button"
          onClick={onReset}
          disabled={!hasActiveFilters}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RotateCcw className="h-4 w-4" />
          Reset
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-12">
        <div className="md:col-span-2 xl:col-span-4">
          <SearchBar
            value={filters.search}
            onChange={onSearchChange}
            placeholder="Search title, description, outcome, creator..."
          />
        </div>

        <div className="space-y-2 xl:col-span-2">
          <FieldLabel htmlFor="market-status-filter">Status</FieldLabel>
          <select
            id="market-status-filter"
            value={filters.status}
            onChange={(event) => onStatusChange(event.target.value as MarketStatusFilter)}
            className={controlClass}
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2 xl:col-span-2">
          <FieldLabel htmlFor="market-asset-filter">Asset type</FieldLabel>
          <select
            id="market-asset-filter"
            value={filters.asset}
            onChange={(event) => onAssetChange(event.target.value)}
            className={controlClass}
          >
            <option value="all">All assets</option>
            {visibleAssetOptions.map((asset) => (
              <option key={asset} value={asset}>
                {asset}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2 xl:col-span-2">
          <FieldLabel htmlFor="market-time-filter">Time range</FieldLabel>
          <select
            id="market-time-filter"
            value={filters.timeRange}
            onChange={(event) => onTimeRangeChange(event.target.value as TimeRangeFilter)}
            className={controlClass}
          >
            {timeRangeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2 xl:col-span-2">
          <FieldLabel htmlFor="market-sort-filter">Sort</FieldLabel>
          <select
            id="market-sort-filter"
            value={filters.sortBy}
            onChange={(event) => onSortChange(event.target.value as SortOption)}
            className={controlClass}
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2 xl:col-span-2">
          <FieldLabel htmlFor="market-min-volume">Min volume ({TOKEN_SYMBOL})</FieldLabel>
          <input
            id="market-min-volume"
            type="number"
            min="0"
            inputMode="decimal"
            value={filters.minVolume}
            onChange={(event) => onMinVolumeChange(event.target.value)}
            className={controlClass}
            placeholder="0"
          />
        </div>

        <div className="space-y-2 xl:col-span-2">
          <FieldLabel htmlFor="market-max-volume">Max volume ({TOKEN_SYMBOL})</FieldLabel>
          <input
            id="market-max-volume"
            type="number"
            min="0"
            inputMode="decimal"
            value={filters.maxVolume}
            onChange={(event) => onMaxVolumeChange(event.target.value)}
            className={controlClass}
            placeholder="Any"
          />
        </div>
      </div>

      {onApplyPreset && onSavePreset && onDeletePreset && (
        <FilterPresets
          presets={presets ?? []}
          currentFilters={filters}
          canSave={canSavePreset ?? false}
          maxPresets={maxPresets ?? 5}
          onApply={onApplyPreset}
          onSave={onSavePreset}
          onDelete={onDeletePreset}
        />
      )}
    </section>
  );
}
