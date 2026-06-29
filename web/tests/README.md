# Web Frontend Tests

This directory contains tests for the Next.js web frontend application.

## Test Structure

- `setup.ts` - Test environment configuration and mocks
- `components/` - React component tests
- `routes/` - Route-level smoke tests (verifies each top-level App Router page mounts without crashing)
- `lib/` - API client and utility function tests
- `helpers/` - Shared render utilities (`renderWithProviders`)

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run tests with UI
npm run test:ui

# Run tests with coverage
npm run test:coverage
```

## Test Coverage

### Components
- **AuthGuard** - Authentication guard component
- **BettingSection** - Betting interface component

### API Client
- **stacks-api** - Contract interaction functions
  - `getPoolCount()` - Fetch total pool count
  - `getPool()` - Fetch individual pool data
  - `fetchActivePools()` - Fetch all active pools
  - `getUserBet()` - Fetch user bet data

## Mocking

Tests use Vitest mocks for:
- Next.js navigation hooks
- Wallet/auth provider context
- Adapter modules (`predinexReadApi`, `predinexContract`)
- Soroban RPC / event-service JSON payloads

## Supported Mock Surfaces

Production-facing suites should prefer the current product surfaces:
- `predinexReadApi` and `predinexContract`
- `getUserActivityFromSoroban` and other Soroban event helpers
- `fetch` responses shaped like Soroban RPC or REST JSON

Legacy Stacks transport primitives are only for compatibility tests that are
explicitly isolated for the old `stacks-api` module or network-selection checks:
- `@stacks/transactions`
- `@stacks/network`
- `@stacks/connect`

Compatibility suites stay out of the default `npm test` path via `vitest.config.ts`.

