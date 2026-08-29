'use client';

import { useState } from 'react';
import { Bookmark, BookmarkCheck, Trash2 } from 'lucide-react';
import type { FilterPreset } from '../lib/hooks/useFilterPresets';
import type { MarketFilters } from '../lib/market-types';

interface FilterPresetsProps {
  presets: FilterPreset[];
  currentFilters: MarketFilters;
  canSave: boolean;
  maxPresets: number;
  onApply: (filters: MarketFilters) => void;
  onSave: (name: string, filters: MarketFilters) => void;
  onDelete: (id: string) => void;
}

export default function FilterPresets({
  presets,
  currentFilters,
  canSave,
  maxPresets,
  onApply,
  onSave,
  onDelete,
}: FilterPresetsProps) {
  const [savingName, setSavingName] = useState('');
  const [showInput, setShowInput] = useState(false);

  function handleSave() {
    if (!savingName.trim()) return;
    onSave(savingName, currentFilters);
    setSavingName('');
    setShowInput(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') {
      setSavingName('');
      setShowInput(false);
    }
  }

  return (
    <div className="mt-3 border-t border-muted/30 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Saved filters
        </span>

        {presets.length === 0 && !showInput && (
          <span className="text-xs text-muted-foreground/60">No saved filters yet</span>
        )}

        {presets.map((preset) => (
          <span
            key={preset.id}
            className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
          >
            <button
              type="button"
              onClick={() => onApply(preset.filters)}
              className="max-w-[120px] truncate hover:underline"
              title={`Load filter: ${preset.name}`}
            >
              {preset.name}
            </button>
            <button
              type="button"
              onClick={() => onDelete(preset.id)}
              aria-label={`Delete preset ${preset.name}`}
              className="ml-0.5 opacity-60 hover:opacity-100"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </span>
        ))}

        {showInput ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              type="text"
              value={savingName}
              onChange={(e) => setSavingName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Preset name…"
              maxLength={40}
              className="h-7 rounded-md border border-primary/40 bg-muted/30 px-2 text-xs outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/30"
            />
            <button
              type="button"
              onClick={handleSave}
              disabled={!savingName.trim()}
              className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <BookmarkCheck className="h-3 w-3" />
              Save
            </button>
            <button
              type="button"
              onClick={() => { setSavingName(''); setShowInput(false); }}
              className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        ) : canSave ? (
          <button
            type="button"
            onClick={() => setShowInput(true)}
            className="inline-flex items-center gap-1 rounded-full border border-muted/50 px-2 py-0.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary"
          >
            <Bookmark className="h-3 w-3" />
            Save current
          </button>
        ) : (
          <span className="text-xs text-muted-foreground/60">
            Max {maxPresets} saved filters
          </span>
        )}
      </div>
    </div>
  );
}
