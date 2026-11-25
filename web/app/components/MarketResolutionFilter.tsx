'use client';

import type { ResolutionFilter } from '../lib/market-types';

interface MarketResolutionFilterProps {
  value: ResolutionFilter;
  onChange: (value: ResolutionFilter) => void;
}

// #1703 — tabbed resolution filter above the market table. The four options
// (all/open/resolving/resolved) round-trip through the `resolution` URL param
// in market-filtering.ts, so links are shareable.
const RESOLUTION_OPTIONS: Array<{ value: ResolutionFilter; label: string; description: string }> = [
  { value: 'all', label: 'All', description: 'Show markets in every resolution stage' },
  { value: 'open', label: 'Open', description: 'Markets still accepting bets' },
  { value: 'resolving', label: 'Resolving', description: 'Expired or disputed markets awaiting settlement' },
  { value: 'resolved', label: 'Resolved', description: 'Settled markets with a final outcome' },
];

export default function MarketResolutionFilter({ value, onChange }: MarketResolutionFilterProps) {
  return (
    <div
      role="tablist"
      aria-label="Filter markets by resolution status"
      className="mb-4 flex flex-wrap gap-2"
    >
      {RESOLUTION_OPTIONS.map((option) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            title={option.description}
            onClick={() => onChange(option.value)}
            className={
              'rounded-full border px-4 py-1.5 text-sm font-medium transition ' +
              (isActive
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border/60 bg-card/30 text-muted-foreground hover:border-border hover:text-foreground')
            }
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
