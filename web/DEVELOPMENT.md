# Development Guide - Predinex Frontend

This document provides instructions for developers looking to contribute to the Predinex frontend. For information on the release lifecycle, see the [Release Process](../RELEASE.md).

## Prerequisites

- **Node.js**: v18 or higher
- **npm**: v8 or higher (npm is the standard package manager for this project)
- **Wallet**: [Freighter](https://www.freighter.app/) (for testing Stellar interactions)

> **Note**: This project uses `npm` as the sole package manager. Please do not use `pnpm` or `yarn` to avoid lockfile conflicts.

## Getting Started

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Environment Variables**:
   Create a `.env.local` file in the `web` directory:
   ```env
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   NEXT_PUBLIC_NETWORK=testnet
   ```

   Runtime config boundaries are enforced by tests. Before adding a new client-exposed env key, update `app/lib/env-boundary.ts` and `docs/RUNTIME_CONFIG_BOUNDARIES.md`.

3. **Run Development Server**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) to see the result.

## Project Structure

- `web/app/`: Next.js App Router (pages and layouts)
- `web/components/`: Reusable UI components
- `web/app/lib/`: Core logic, hooks, and utility functions
- `web/components/ui/`: Shared primitive components (design system)

## Coding Standards

### TypeScript
- Use functional components with Proper TypeScript interfaces.
- Avoid using `any` type; define proper interfaces for all data.

### Styling
- Use **Tailwind CSS** for all styling.
- Follow the design system defined in `web/app/globals.css`.
- Use the `Card` and `Badge` components for consistent layout and status display.

### Icons
- Use **Lucide React** for icons.
- Import standard sizes/classes from `web/app/lib/constants.ts` (`ICON_CLASS`).

### Documentation
- Use JSDoc for all utility functions and complex components.
- Keep components small and focused.

## Component Library

We use a custom component library located in `web/components/ui/`. Key components include:
- `Card`: Standard glassmorphism container.
- `Badge`: Status and tag indicator.
- `StatusBadge`: Specialized market status badge.
- `Tooltip`: Informational overlays.
- `Toast`: Session notifications.

## Local End-to-End Setup

To run the contract and the web app together locally (deploy to testnet, wire env vars, smoke-test the full stack), follow the [Local End-to-End Runbook](../docs/local-runbook.md).

## Contract Integration

When working on features that touch the smart contract interface:

- **API Reference** — See [web/docs/CONTRACT_API.md](./docs/CONTRACT_API.md) for full entrypoint specifications.
- **Event schemas** — Refer to [docs/CONTRACT_EVENTS.md](./docs/CONTRACT_EVENTS.md) for the canonical event payload definitions. Do not reverse-engineer event structures from the contract source.
- **Versioning & migrations** — All contract changes (breaking or otherwise) must follow the process in [docs/CONTRACT_VERSIONING.md](./docs/CONTRACT_VERSIONING.md). Breaking interface changes require an explicit major version bump and a migration note before the PR can be merged.
- **Error boundaries** — Route-level components should be wrapped in `<RouteErrorBoundary routeName="...">` (see `web/components/RouteErrorBoundary.tsx`). Add the wrapper when creating new top-level pages.

## Soroban Event Service (Activity Feed)

The activity feed is powered by `web/app/lib/soroban-event-service.ts`, which ingests Soroban contract events directly from the Stellar RPC.

### How it works

1. `getUserActivityFromSoroban` calls the Soroban RPC `getEvents` method, filtering by contract ID and relevant event names (`place_bet`, `claim_winnings`, `create_pool`, `settle_pool`).
2. `decodeSorobanEvent` normalises raw RPC topic/value payloads into typed `DecodedSorobanEvent` objects.
3. `mapEventToActivityItem` converts decoded events into `ActivityItem` objects consumed by `<ActivityFeed>`.
4. `useUserActivity` (hook) calls `predinexReadApi.getUserActivitySoroban` which wires the above together.

### Local environment setup

Add the following to your `.env.local`:

```env
NEXT_PUBLIC_SOROBAN_CONTRACT_ID=<your-deployed-contract-C-strkey>
```

The Soroban RPC URL defaults to `https://soroban-testnet.stellar.org` for testnet and `https://mainnet.stellar.validationcloud.io/v1/soroban/rpc` for mainnet (configured in `walletconnect-config.ts`).

### Deployed environment

Set `NEXT_PUBLIC_SOROBAN_CONTRACT_ID` to the mainnet contract strkey in your deployment environment variables. The RPC URL is resolved automatically based on `NEXT_PUBLIC_NETWORK`.

## Testing

### Local CI/CD Checks

Before pushing, ensure all checks pass:

```bash
npm run lint
npm run test
npm run build
```

## Dependency Caching Strategy

This project uses both Node.js (npm) and Rust (Cargo) toolchains. Understanding the caching strategy ensures fast, deterministic installs across local and CI environments.

### Package Manager

**npm** is the standard package manager for this project. The `package-lock.json` lockfile ensures deterministic dependency resolution.

### Cache Locations

| Tool | Cache Location | Environment Variable |
|------|-----------------|-------------------|
| npm | `~/.npm` | `npm_config_cache` |
| Cargo | `~/.cargo/registry` | `CARGO_HOME` |

### Cache-Friendly Install Commands

**Web (Node.js)**:
```bash
# Uses package-lock.json for deterministic installs
npm ci

# For local development (updates lockfile if needed)
npm install
```

**Contracts (Rust)**:
```bash
# Uses Cargo.lock for deterministic builds
cargo build

# Fetch dependencies without building
cargo fetch
```

### CI Caching Behavior

The [CI workflow](../.github/workflows/ci.yml) uses GitHub Actions built-in caching:

1. **Node.js**: `actions/setup-node@v4` with `cache: 'npm'` caches `~/.npm`
2. **Rust**: `actions-rust-lang/setup-rust-toolchain@v1` caches `~/.cargo`

Cache keys are based on lockfile hashes:
- `web/package-lock.json` for npm
- `contracts/predinex/Cargo.lock` for Rust

### Local Development Best Practices

1. **Use the bootstrap script** for initial setup:
   ```bash
   ./scripts/bootstrap.sh
   ```

2. **Clear cache if you encounter issues**:
   ```bash
   # npm
   npm cache clean --force
   rm -rf node_modules
   npm ci

   # Cargo
   cargo clean
   rm -rf ~/.cargo/registry/cache
   ```

3. **Verify cache is working**:
   ```bash
   npm config get cache
   echo $CARGO_HOME
   ```

4. **Offline builds** (useful for verifying cache completeness):
   ```bash
   cargo build --offline
   ```

### Troubleshooting

| Issue | Solution |
|-------|----------|
| Slow installs | Check cache directory permissions; ensure `~/.npm` and `~/.cargo` are writable |
| Lockfile conflicts | Run `npm ci` instead of `npm install` in CI; only update lockfile intentionally |
| Missing Rust components | Run `rustup component add rustfmt clippy` |

