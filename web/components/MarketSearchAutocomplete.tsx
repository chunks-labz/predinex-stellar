/**
 * MarketSearchAutocomplete Component
 * 
 * Issue #1524: UX Improvement Iteration 4 - Smart search with autocomplete
 */

'use client';

import { Search, TrendingUp, Clock, X } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

interface SearchResult {
  id: number;
  title: string;
  category: string;
  status: string;
  volume: string;
  timeRemaining: string;
}

interface MarketSearchAutocompleteProps {
  onSearch?: (query: string) => void;
}

export function MarketSearchAutocomplete({
  onSearch,
}: MarketSearchAutocompleteProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    // Mock search - replace with actual API call
    const mockResults: SearchResult[] = [
      {
        id: 1,
        title: 'Will Bitcoin reach $100k by end of 2024?',
        category: 'Crypto',
        status: 'active',
        volume: '150,000',
        timeRemaining: '45d',
      },
      {
        id: 2,
        title: 'Will Ethereum merge happen in Q3?',
        category: 'Crypto',
        status: 'active',
        volume: '80,000',
        timeRemaining: '20d',
      },
    ].filter((r) => r.title.toLowerCase().includes(query.toLowerCase()));

    setResults(mockResults);
    setIsOpen(mockResults.length > 0);
    setSelectedIndex(-1);
  }, [query]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) => (prev < results.length - 1 ? prev + 1 : prev));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && results[selectedIndex]) {
          window.location.href = `/markets/${results[selectedIndex].id}`;
        } else if (onSearch) {
          onSearch(query);
          setIsOpen(false);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        inputRef.current?.blur();
        break;
    }
  };

  const handleClear = () => {
    setQuery('');
    setResults([]);
    setIsOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div className="relative w-full max-w-2xl">
      <div className="relative">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setIsOpen(true)}
          placeholder="Search markets by title, category, or keyword..."
          className="w-full pl-10 pr-10 py-3 rounded-lg border border-border/50 bg-muted/30 
            focus:outline-none focus:ring-2 focus:ring-primary focus:bg-background transition-all"
          aria-label="Search markets"
          aria-autocomplete="list"
          aria-controls="search-results"
          aria-expanded={isOpen}
        />
        {query && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted/50 transition-colors"
            aria-label="Clear search"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {isOpen && results.length > 0 && (
        <div
          ref={dropdownRef}
          id="search-results"
          className="absolute top-full mt-2 w-full glass rounded-xl border shadow-lg z-50 max-h-96 overflow-y-auto animate-in fade-in slide-in-from-top-2 duration-200"
          role="listbox"
        >
          <div className="p-2">
            {results.map((result, index) => (
              <Link
                key={result.id}
                href={`/markets/${result.id}`}
                className={`block p-3 rounded-lg hover:bg-muted/50 transition-colors ${
                  index === selectedIndex ? 'bg-muted/50' : ''
                }`}
                role="option"
                aria-selected={index === selectedIndex}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium mb-1 line-clamp-2">{result.title}</h4>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="px-2 py-0.5 rounded bg-primary/10 text-primary">
                        {result.category}
                      </span>
                      <span className="flex items-center gap-1">
                        <TrendingUp className="w-3 h-3" aria-hidden="true" />
                        {result.volume} XLM
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" aria-hidden="true" />
                        {result.timeRemaining}
                      </span>
                    </div>
                  </div>
                  <span
                    className={`px-2 py-1 text-xs font-medium rounded capitalize shrink-0 ${
                      result.status === 'active'
                        ? 'bg-green-400/10 text-green-400'
                        : 'bg-gray-400/10 text-gray-400'
                    }`}
                  >
                    {result.status}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {isOpen && results.length === 0 && query.length >= 2 && (
        <div
          className="absolute top-full mt-2 w-full glass p-6 rounded-xl border text-center"
          role="status"
        >
          <p className="text-muted-foreground">No markets found for "{query}"</p>
          <p className="text-sm text-muted-foreground mt-1">
            Try different keywords or browse all markets
          </p>
        </div>
      )}
    </div>
  );
}
