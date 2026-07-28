'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, TrendingUp, Clock, Calendar, Users } from 'lucide-react';
import { SortOption } from '@/app/lib/market-types';

interface SortControlsProps {
  selectedSort: SortOption;
  onSortChange: (sort: SortOption) => void;
}

interface SortOptionConfig {
  value: SortOption;
  label: string;
  icon: React.ReactNode;
  description: string;
}

const sortOptions: SortOptionConfig[] = [
  {
    value: 'newest',
    label: 'Newest First',
    icon: <Calendar className="w-4 h-4" />,
    description: 'Sort by creation time (newest first)'
  },
  {
    value: 'volume',
    label: 'Highest Volume',
    icon: <TrendingUp className="w-4 h-4" />,
    description: 'Sort by total betting volume (highest first)'
  },
  {
    value: 'participants',
    label: 'Most Participants',
    icon: <Users className="w-4 h-4" />,
    description: 'Sort by participant count (highest first)'
  },
  {
    value: 'ending-soon',
    label: 'Ending Soon',
    icon: <Clock className="w-4 h-4" />,
    description: 'Sort by time remaining (ending soonest first)'
  }
];

export default function SortControls({ selectedSort, onSortChange }: SortControlsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedOption = sortOptions.find(option => option.value === selectedSort) || sortOptions[0];

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSortSelect = (sortValue: SortOption) => {
    onSortChange(sortValue);
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">Sort by</label>

        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-muted/30 border border-muted/50
                   rounded-lg hover:border-muted/70 focus:outline-none focus:ring-2 focus:ring-primary/50
                   focus:border-primary/50 transition-all duration-200"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
        >
          <div className="flex items-center gap-3">
            {selectedOption.icon}
            <span className="text-sm font-medium">{selectedOption.label}</span>
          </div>
          <ChevronDown
            className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${
              isOpen ? 'rotate-180' : ''
            }`}
          />
        </button>
      </div>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-background border border-muted/50 rounded-lg
                      shadow-lg z-50 overflow-hidden">
          <div className="py-1">
            {sortOptions.map((option) => {
              const isSelected = option.value === selectedSort;

              return (
                <button
                  key={option.value}
                  onClick={() => handleSortSelect(option.value)}
                  className={`
                    w-full flex items-center gap-3 px-4 py-3 text-left transition-colors duration-150
                    ${isSelected
                      ? 'bg-primary/10 text-primary'
                      : 'hover:bg-muted/50 text-foreground'
                    }
                  `}
                  role="option"
                  aria-selected={isSelected}
                  title={option.description}
                >
                  <div className={`${isSelected ? 'text-primary' : 'text-muted-foreground'}`}>
                    {option.icon}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium">{option.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {option.description}
                    </div>
                  </div>
                  {isSelected && (
                    <div className="w-2 h-2 bg-primary rounded-full" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
