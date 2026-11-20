import { useRef, type KeyboardEvent } from 'react';
import type { DisputeTabId } from '@/app/lib/disputes/types';

const TABS: { key: DisputeTabId; label: string }[] = [
  { key: 'active', label: 'Active Disputes' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'create', label: 'Create Dispute' },
];

interface DisputeTabNavProps {
  selected: DisputeTabId;
  onSelect: (tab: DisputeTabId) => void;
}

export function DisputeTabNav({ selected, onSelect }: DisputeTabNavProps) {
  const refs = {
    active: useRef<HTMLButtonElement>(null),
    resolved: useRef<HTMLButtonElement>(null),
    create: useRef<HTMLButtonElement>(null),
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: DisputeTabId) => {
    const order: DisputeTabId[] = ['active', 'resolved', 'create'];
    const index = order.indexOf(current);
    let next: DisputeTabId | null = null;
    if (event.key === 'ArrowRight') next = order[(index + 1) % order.length];
    else if (event.key === 'ArrowLeft') next = order[(index - 1 + order.length) % order.length];
    else if (event.key === 'Home') next = order[0];
    else if (event.key === 'End') next = order[order.length - 1];
    if (next) {
      event.preventDefault();
      onSelect(next);
      refs[next].current?.focus();
    }
  };

  return (
    <div className="flex space-x-1 mb-6 bg-muted p-1 rounded-lg" role="tablist" aria-label="Dispute sections">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          ref={refs[tab.key]}
          role="tab"
          type="button"
          aria-selected={selected === tab.key}
          tabIndex={selected === tab.key ? 0 : -1}
          onKeyDown={(event) => handleKeyDown(event, tab.key)}
          onClick={() => onSelect(tab.key)}
          className={`flex-1 px-4 py-2 rounded-md transition-colors ${
            selected === tab.key
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
