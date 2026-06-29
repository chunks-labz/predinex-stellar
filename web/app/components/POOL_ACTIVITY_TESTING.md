# Pool Activity Timeline - Testing & Development Guide

## Development Setup

### 1. Using Mock Data

For rapid development without a backend, use the mock data generator:

```tsx
// In usePoolActivity.ts
import { generateMockPoolActivityEvents } from '../lib/pool-activity-mock';

const fetchPoolActivity = useCallback(
  async (id: number, limit: number): Promise<PoolActivityEvent[]> => {
    // Replace real API call with mock for development
    const mockEvents = generateMockPoolActivityEvents(id, 15);
    
    // Add a small delay to simulate network request
    await new Promise(resolve => setTimeout(resolve, 500));
    
    return mockEvents;
  },
  []
);
```

### 2. Test Different Event Types

To test specific event types individually:

```tsx
import { getMockEventByType } from '@/app/lib/pool-activity-mock';

// Test pool-created event
const event = getMockEventByType('pool-created', 1, {
  timestamp: Math.floor(Date.now() / 1000) - 3600,
});

// Test bet-placed event with amount
const betEvent = getMockEventByType('bet-placed', 1, {
  amount: 100_000_000, // 100 STX
  outcome: 0,
});
```

### 3. Manual Component Testing

Create a temporary test page at `web/app/test-timeline/page.tsx`:

```tsx
'use client';

import PoolActivityTimeline from '../components/PoolActivityTimeline';

export default function TimelineTest() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="pt-8 max-w-3xl mx-auto px-4">
        <h1 className="text-3xl font-bold mb-8">Pool Activity Timeline Test</h1>
        
        <div className="glass p-8 rounded-2xl border border-border">
          <h2 className="text-xl font-semibold mb-6">Pool #1 Activity</h2>
          <PoolActivityTimeline 
            poolId={1}
            outcomeLabels={["Outcome A", "Outcome B"]}
          />
        </div>
        
        <div className="glass p-8 rounded-2xl border border-border mt-8">
          <h2 className="text-xl font-semibold mb-6">Pool #2 Activity</h2>
          <PoolActivityTimeline 
            poolId={2}
            outcomeLabels={["Yes", "No"]}
          />
        </div>
      </div>
    </main>
  );
}
```

Visit `http://localhost:3000/test-timeline` to test the component.

## Debugging

### Enable Debug Console Logging

In `usePoolActivity.ts`:

```tsx
const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));

useEffect(() => {
  console.log(`[usePoolActivity] Loaded ${events.length} events for pool ${poolId}`);
  console.log('[usePoolActivity] Events:', events);
}, [events, poolId]);

const loadEvents = useCallback(async () => {
  console.log(`[usePoolActivity] Loading events for pool ${poolId}...`);
  // ... rest of function
}, [poolId]);
```

In component:

```tsx
useEffect(() => {
  console.log('[PoolActivityTimeline] Rendered with props:', { poolId, outcomeLabels });
}, [poolId, outcomeLabels]);
```

### Check Component State with React DevTools

1. Open React DevTools browser extension
2. Find `<PoolActivityTimeline>` component
3. Inspect props and state:
   - `events` array structure
   - `isLoading`, `error` state
   - `displayedCount` pagination state

### Inspect Generated Mock Data

```tsx
import { generateMockPoolActivityEvents, getMockEventByType } from '@/app/lib/pool-activity-mock';

// In browser console or temporary test file:
const mockEvents = generateMockPoolActivityEvents(1, 5);
console.table(mockEvents.map(e => ({
  id: e.id,
  type: e.type,
  actor: e.actor,
  timestamp: new Date(e.timestamp * 1000).toLocaleString(),
  amount: e.amount ? (e.amount / 1_000_000).toFixed(2) : 'N/A',
  outcome: e.outcome,
})));
```

## Testing Checklist

### Visual/UI Testing

- [ ] Loading skeleton animates smoothly
- [ ] Empty state displays correctly for pool with no events
- [ ] Error message shows with retry capability
- [ ] Timeline vertical line connects all events
- [ ] Event icons display with correct colors
- [ ] Relative timestamps update every 30 seconds
- [ ] Absolute timestamp shows on hover over relative time
- [ ] Truncated addresses display correctly
- [ ] Full address appears on hover
- [ ] Amount displays for applicable events
- [ ] Outcome labels display correctly
- [ ] Explorer link is clickable
- [ ] "Load More" button appears when needed
- [ ] Pagination info displays correctly

### Functionality Testing

- [ ] Component loads with correct poolId
- [ ] Events are sorted chronologically (newest first)
- [ ] Refresh button works and reloads events
- [ ] Load more button loads next batch
- [ ] Component handles no events gracefully
- [ ] Component handles error state
- [ ] Multiple instances don't interfere
- [ ] Time updates without page refresh

### Performance Testing

- [ ] Smooth performance with 100 events
- [ ] No layout shift when events load
- [ ] Relative time updates don't cause flicker
- [ ] Memory usage stable over time (check DevTools Performance tab)
- [ ] No console errors or warnings

### Accessibility Testing

- [ ] Keyboard navigation works (Tab through links)
- [ ] Screen reader announces timeline section
- [ ] Color not the only indicator (icons + text used)
- [ ] Contrast ratios meet WCAG AA standards
- [ ] Error messages announced to screen readers
- [ ] Time elements have proper `<time>` semantics

## Integration Test Scenarios

### Scenario 1: No Activity

```tsx
// Mock with empty array
const fetchPoolActivity = async () => [];

// Should show: "No Activity Yet" empty state
```

### Scenario 2: Loading Then Data

```tsx
// Mock with delay
const fetchPoolActivity = async () => {
  await new Promise(r => setTimeout(r, 2000));
  return generateMockPoolActivityEvents(1, 5);
};

// Should show: skeleton for 2s, then events
```

### Scenario 3: Error Then Retry

```tsx
let shouldFail = true;

const fetchPoolActivity = async () => {
  if (shouldFail) {
    shouldFail = false;
    throw new Error('Network error');
  }
  return generateMockPoolActivityEvents(1, 5);
};

// Should show: error message + retry button
// After clicking retry: show events
```

### Scenario 4: Large Dataset

```tsx
const fetchPoolActivity = async () => {
  return generateMockPoolActivityEvents(1, 150);
};

// Should show: first 100 events + "Load More" button
// After clicking Load More: show next 20 events
```

## Browser Testing

### Chrome DevTools

1. **Performance Tab**: Check for layout shifts
   - Open DevTools → Performance → Record
   - Interact with timeline
   - Check for red bars (jank)

2. **Memory Tab**: Check for memory leaks
   - Navigate away, then back
   - Memory usage shouldn't increase indefinitely

3. **Network Tab**: Check request waterfall
   - See cache hits/misses
   - Verify 30-second cache TTL

### Responsive Testing

Test on different screen sizes:

```tsx
// Add to test component
<div className="flex flex-col gap-4">
  <div className="border rounded p-4 max-w-xs">
    <p className="text-xs mb-2">Mobile (360px)</p>
    <PoolActivityTimeline poolId={1} />
  </div>
  <div className="border rounded p-4 max-w-md">
    <p className="text-xs mb-2">Tablet (768px)</p>
    <PoolActivityTimeline poolId={1} />
  </div>
  <div className="border rounded p-4 max-w-full">
    <p className="text-xs mb-2">Desktop (1200px)</p>
    <PoolActivityTimeline poolId={1} />
  </div>
</div>
```

## Unit Testing Examples

### Jest + React Testing Library

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import PoolActivityTimeline from './PoolActivityTimeline';

describe('PoolActivityTimeline', () => {
  it('shows loading skeleton initially', () => {
    render(<PoolActivityTimeline poolId={1} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('displays empty state for pools with no activity', async () => {
    render(<PoolActivityTimeline poolId={999} />);
    await waitFor(() => {
      expect(screen.getByText('No Activity Yet')).toBeInTheDocument();
    });
  });

  it('renders events with correct information', async () => {
    render(<PoolActivityTimeline poolId={1} />);
    await waitFor(() => {
      expect(screen.getByText('Pool Created')).toBeInTheDocument();
    });
  });

  it('updates relative timestamps every 30 seconds', async () => {
    jest.useFakeTimers();
    render(<PoolActivityTimeline poolId={1} />);
    
    // Initial text
    expect(screen.getByText('just now')).toBeInTheDocument();
    
    // Advance 31 seconds
    jest.advanceTimersByTime(31000);
    
    // Time should update
    await waitFor(() => {
      expect(screen.queryByText('just now')).not.toBeInTheDocument();
    });
    
    jest.useRealTimers();
  });

  it('shows load more button when events exceed max', async () => {
    render(<PoolActivityTimeline poolId={1} maxInitialEvents={5} />);
    await waitFor(() => {
      expect(screen.getByText(/load more/i)).toBeInTheDocument();
    });
  });
});
```

## Troubleshooting Common Issues

### Events not appearing

**Check:**
1. Is `poolId` being passed correctly?
2. Are mock events being generated? (check console)
3. Is component properly imported?
4. Check for JavaScript errors in console

**Fix:**
```tsx
// Add debug logging
console.log('[PoolActivityTimeline] Rendering with poolId:', poolId);
const { events, isLoading, error } = usePoolActivity(poolId);
console.log('[PoolActivityTimeline] Events loaded:', events.length, error);
```

### Timestamps look wrong

**Check:**
1. Are timestamps in Unix seconds (not milliseconds)?
2. Is browser timezone correct?
3. Does `formatTimeAgo` handle edge cases?

**Fix:**
```tsx
// Verify timestamp format
const event = mockEvents[0];
console.log('Timestamp:', event.timestamp); // Should be ~1700000000
console.log('Date:', new Date(event.timestamp * 1000)); // Should be recent
```

### Performance issues

**Check:**
1. How many events are being rendered?
2. Are other animations affecting performance?
3. Is browser console showing warnings?

**Fix:**
- Reduce initial event count
- Use React.memo for event items
- Check DevTools Performance profiler

## Release Checklist

Before merging to production:

- [ ] All tests passing
- [ ] No TypeScript errors
- [ ] No console errors/warnings
- [ ] Accessibility audit passed
- [ ] Code reviewed
- [ ] Integration tested with real pool data
- [ ] Performance tested with 100 events
- [ ] Mobile responsive tested
- [ ] Error states tested
- [ ] Documentation updated
