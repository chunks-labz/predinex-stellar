/**
 * AdvancedMarketFilters Component
 * 
 * Issue #1524: UX Improvement Iteration 4 - Advanced filtering
 */

'use client';

import { Filter, X, ChevronDown } from 'lucide-react';
import { useState } from 'react';

interface FilterOptions {
  status: string[];
  volumeRange: [number, number];
  category: string[];
  sortBy: string;
}

interface AdvancedMarketFiltersProps {
  onFilterChange: (filters: FilterOptions) => void;
  categories: string[];
}

export function AdvancedMarketFilters({
  onFilterChange,
  categories,
}: AdvancedMarketFiltersProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [filters, setFilters] = useState<FilterOptions>({
    status: [],
    volumeRange: [0, 1000000],
    category: [],
    sortBy: 'volume',
  });

  const statusOptions = ['active', 'settled', 'expired', 'disputed'];
  const sortOptions = [
    { value: 'volume', label: 'Highest Volume' },
    { value: 'recent', label: 'Most Recent' },
    { value: 'ending', label: 'Ending Soon' },
    { value: 'participants', label: 'Most Participants' },
  ];

  const toggleStatus = (status: string) => {
    const newStatus = filters.status.includes(status)
      ? filters.status.filter((s) => s !== status)
      : [...filters.status, status];
    const newFilters = { ...filters, status: newStatus };
    setFilters(newFilters);
    onFilterChange(newFilters);
  };

  const toggleCategory = (category: string) => {
    const newCategory = filters.category.includes(category)
      ? filters.category.filter((c) => c !== category)
      : [...filters.category, category];
    const newFilters = { ...filters, category: newCategory };
    setFilters(newFilters);
    onFilterChange(newFilters);
  };

  const handleSortChange = (sortBy: string) => {
    const newFilters = { ...filters, sortBy };
    setFilters(newFilters);
    onFilterChange(newFilters);
  };

  const clearFilters = () => {
    const resetFilters: FilterOptions = {
      status: [],
      volumeRange: [0, 1000000],
      category: [],
      sortBy: 'volume',
    };
    setFilters(resetFilters);
    onFilterChange(resetFilters);
  };

  const activeFilterCount =
    filters.status.length + filters.category.length + (filters.sortBy !== 'volume' ? 1 : 0);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border/50 bg-muted/30 hover:bg-muted/50 transition-colors"
        aria-expanded={isOpen}
        aria-label="Advanced filters"
      >
        <Filter className="w-4 h-4" aria-hidden="true" />
        <span className="font-medium">Filters</span>
        {activeFilterCount > 0 && (
          <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-primary text-primary-foreground">
            {activeFilterCount}
          </span>
        )}
        <ChevronDown
          className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {isOpen && (
        <div className="absolute top-full mt-2 right-0 w-80 glass p-4 rounded-xl border shadow-lg z-50 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Advanced Filters</h3>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close filters"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-4">
            {/* Status Filter */}
            <div>
              <label className="text-sm font-medium mb-2 block">Status</label>
              <div className="flex flex-wrap gap-2">
                {statusOptions.map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => toggleStatus(status)}
                    className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                      filters.status.includes(status)
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border/50 bg-muted/30 hover:bg-muted/50'
                    }`}
                  >
                    {status}
                  </button>
                ))}
              </div>
            </div>

            {/* Category Filter */}
            {categories.length > 0 && (
              <div>
                <label className="text-sm font-medium mb-2 block">Category</label>
                <div className="flex flex-wrap gap-2">
                  {categories.map((category) => (
                    <button
                      key={category}
                      type="button"
                      onClick={() => toggleCategory(category)}
                      className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                        filters.category.includes(category)
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border/50 bg-muted/30 hover:bg-muted/50'
                      }`}
                    >
                      {category}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Sort By */}
            <div>
              <label className="text-sm font-medium mb-2 block">Sort By</label>
              <select
                value={filters.sortBy}
                onChange={(e) => handleSortChange(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border/50 bg-muted/30 focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {sortOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={clearFilters}
                className="flex-1 px-4 py-2 text-sm font-medium rounded-lg border border-border/50 bg-muted/30 hover:bg-muted/50 transition-colors"
              >
                Clear All
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="flex-1 px-4 py-2 text-sm font-semibold rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground transition-colors"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
