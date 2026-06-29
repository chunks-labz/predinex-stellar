'use client';

import { CheckCircle, Clock, XCircle, Grid3X3 } from 'lucide-react';
import { StatusFilter } from '@/app/lib/market-types';

interface FilterControlsProps {
  selectedStatus: StatusFilter;
  onStatusChange: (status: StatusFilter) => void;
  counts?: {
    all: number;
    open?: number;
    active?: number;
    settled: number;
    disputed?: number;
  };
}

interface FilterOption {
  value: StatusFilter;
  label: string;
  icon: React.ReactNode;
  description: string;
}

const filterOptions: FilterOption[] = [
  {
    value: 'all',
    label: 'All Markets',
    icon: <Grid3X3 className="w-4 h-4" />,
    description: 'Show all markets regardless of status'
  },
  {
    value: 'open',
    label: 'Open',
    icon: <Clock className="w-4 h-4" />,
    description: 'Markets currently accepting bets'
  },
  {
    value: 'settled',
    label: 'Settled',
    icon: <CheckCircle className="w-4 h-4" />,
    description: 'Markets with determined outcomes'
  },
  {
    value: 'disputed',
    label: 'Disputed',
    icon: <XCircle className="w-4 h-4" />,
    description: 'Markets with an active dispute'
  }
];

export default function FilterControls({
  selectedStatus,
  onStatusChange,
  counts
}: FilterControlsProps) {
  const getFilterColor = (status: StatusFilter, isSelected: boolean) => {
    if (!isSelected) {
      return 'text-muted-foreground hover:text-foreground border-muted/30 hover:border-muted/50';
    }

    switch (status) {
      case 'all':
        return 'text-primary border-primary bg-primary/10';
      case 'open':
        return 'text-green-500 border-green-500 bg-green-500/10';
      case 'settled':
        return 'text-blue-500 border-blue-500 bg-blue-500/10';
      case 'disputed':
        return 'text-red-500 border-red-500 bg-red-500/10';
      default:
        return 'text-muted-foreground border-muted/30';
    }
  };

  const getCount = (status: StatusFilter): number => {
    if (!counts) return 0;
    if (status === 'open') return counts.open ?? counts.active ?? 0;
    return counts[status] || 0;
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-foreground">Filter by Status</h3>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {filterOptions.map((option) => {
          const isSelected = selectedStatus === option.value;
          const count = getCount(option.value);

          return (
            <button
              key={option.value}
              onClick={() => onStatusChange(option.value)}
              className={`
                flex flex-col items-center gap-2 p-3 rounded-lg border transition-all duration-200
                ${getFilterColor(option.value, isSelected)}
                hover:scale-105 active:scale-95
              `}
              title={option.description}
            >
              <div className="flex items-center gap-2">
                {option.icon}
                <span className="text-sm font-medium">{option.label}</span>
              </div>

              {counts && (
                <span className="text-xs opacity-75">
                  {count} market{count !== 1 ? 's' : ''}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Mobile-friendly horizontal scroll version */}
      <div className="md:hidden">
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
          {filterOptions.map((option) => {
            const isSelected = selectedStatus === option.value;
            const count = getCount(option.value);

            return (
              <button
                key={option.value}
                onClick={() => onStatusChange(option.value)}
                className={`
                  flex items-center gap-2 px-4 py-2 rounded-full border transition-all duration-200 whitespace-nowrap
                  ${getFilterColor(option.value, isSelected)}
                `}
                title={option.description}
              >
                {option.icon}
                <span className="text-sm font-medium">{option.label}</span>
                {counts && (
                  <span className="text-xs opacity-75 ml-1">
                    ({count})
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
