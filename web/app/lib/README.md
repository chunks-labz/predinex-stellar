# Frontend Utilities Library

Shared, framework-agnostic helpers should live in [`../../lib`](../../lib) and
be imported with `@/lib/...`. This directory is for App Router-specific data
access, contract adapters, route state, and compatibility re-exports.

This directory contains reusable utilities, hooks, and configurations for the Predinex frontend application.

## Files Overview

### Core Utilities

- **contract-utils.ts** - Contract interaction helpers
  - STX/microSTX conversion
  - Amount formatting and validation
  - Odds and winnings calculations

- **error-handler.ts** - Centralized error handling
  - Custom error classes
  - Error parsing and formatting
  - Retry logic with exponential backoff

- **validators.ts** - Form and data validation
  - Pool creation validation
  - Bet amount validation
  - Stacks address validation
  - Comprehensive form validation

- **types.ts** - TypeScript type definitions
  - Enums for statuses
  - Data structure interfaces
  - API response types

- **config.ts** - Application configuration
  - Bet and pool settings
  - API configuration
  - UI settings
  - Feature flags
  - Error and success messages

- **feature-flags.ts** - Public feature flag helpers
  - Oracle-management placeholder opt-in
  - Default-disabled parsing for production-facing placeholder surfaces

- **logger.ts** - Centralized logging
  - Multiple log levels
  - Context-based logging
  - Log export functionality
  - Scoped loggers

- **cache.ts** - Client-side caching
  - In-memory cache with TTL
  - Cache cleanup
  - Scoped cache instances

### Custom Hooks

- **hooks/useAsync.ts** - Async operation handling
  - Loading, error, and data states
  - Retry logic support
  - Success and error callbacks

- **hooks/useForm.ts** - Form state management
  - Field-level validation
  - Touch tracking
  - Form reset functionality
  - Single field hook

- **hooks/useLocalStorage.ts** - Persistent state
  - Local storage integration
  - Session storage support
  - Automatic serialization

## Usage Examples

### Contract Utils

```typescript
import { stxToMicroStx, calculateOdds, formatStxAmount } from '@/lib/contract-utils';

const microStx = stxToMicroStx(10); // 10,000,000
const odds = calculateOdds(5000000, 10000000); // 50
const formatted = formatStxAmount(10000000); // "10.00 STX"
```

### Error Handling

```typescript
import { parseContractError, retryWithBackoff } from '@/lib/error-handler';

try {
  await someContractCall();
} catch (error) {
  const message = parseContractError(error);
  console.error(message);
}

// With retry
const result = await retryWithBackoff(() => fetchData(), 3, 1000);
```

### Validation

```typescript
import { validatePoolCreationForm } from '@/lib/validators';

const result = validatePoolCreationForm({
  title: 'Bitcoin Price',
  description: 'Will Bitcoin reach $100k?',
  outcomeA: 'Yes',
  outcomeB: 'No',
  duration: 144,
});

if (!result.valid) {
  console.error(result.errors);
}
```

Contract-aligned metadata limits for pool creation:
- `title`: max `100` chars
- `description`: max `1000` chars
- `outcomeA` / `outcomeB`: max `50` chars each

### Logging

```typescript
import { createScopedLogger } from '@/lib/logger';

const log = createScopedLogger('BettingComponent');
log.info('Bet placed', { poolId: 1, amount: 10 });
log.error('Bet failed', { error: 'Insufficient balance' });
```

### Caching

```typescript
import { createScopedCache } from '@/lib/cache';

const poolCache = createScopedCache('pools');

// Set value
poolCache.set('pool-1', poolData, 5 * 60 * 1000);

// Get value
const cached = poolCache.get('pool-1');

// Get or set with callback
const data = await poolCache.getOrSet('pool-1', () => fetchPool(1));
```

### Hooks

```typescript
import { useAsync } from '@/lib/hooks/useAsync';
import { useForm } from '@/lib/hooks/useForm';
import { useLocalStorage } from '@/lib/hooks/useLocalStorage';

// Async operations
const { data, loading, error, execute } = useAsync(() => fetchPools());

// Form handling
const { values, errors, handleChange, handleSubmit } = useForm({
  initialValues: { title: '', amount: 0 },
  onSubmit: async (values) => { /* ... */ },
  validate: (values) => { /* ... */ },
});

// Persistent state
const [user, setUser, removeUser] = useLocalStorage('user', null);
```

## Best Practices

1. **Use typed utilities** - Always provide proper TypeScript types
2. **Centralize configuration** - Use config.ts for all constants
3. **Consistent error handling** - Use error-handler.ts for all errors
4. **Scoped loggers** - Create scoped loggers for each component/module
5. **Cache strategically** - Use appropriate TTL values for different data types
6. **Validate early** - Validate user input before sending to contract

To find oracle-management feature flag parsing visit [feature-flags.ts](file:///C:/Stellar%20Contributions/predinex-stellar/web/app/lib/feature-flags.ts).

## Adding New Utilities

When adding new utilities:

1. Create a new file in the appropriate directory
2. Add comprehensive JSDoc comments
3. Export types and interfaces
4. Add usage examples in this README
5. Consider creating a scoped version for component-specific use
