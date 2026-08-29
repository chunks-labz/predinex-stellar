# Predinex Frontend Architecture

## Overview
Predinex is a decentralized prediction market built on the **Stellar blockchain** (via Soroban). The frontend is a modern Next.js application that prioritizes performance, type safety, and a premium user experience in the Stellar ecosystem.

> **Canonical frontend location.** `web/` is the single canonical Next.js
> application. It is the only frontend built, tested, and deployed by CI
> (`.github/workflows/ci.yml`, `working-directory: ./web`). A former
> `apps/web/` directory held an unwired skeleton that duplicated components
> already present here; it was removed and its one unique feature — the
> embeddable pool widget — was consolidated into this app (see below). Add new
> frontend code here, not in a second top-level app.

## Tech Stack
- **Framework**: Next.js 16 (App Router)
- **React**: React 19
- **Styling**: Tailwind CSS 4
- **Blockchain Interop**: Stellar SDK, Soroban integration
- **Wallet Connection**: Freighter, WalletConnect
- **Icons**: Lucide React
- **State Management**: React Context
- **Testing**: Vitest with React Testing Library

## Core Components
- **Wallet Providers**: Manages authentication and wallet state for the Stellar network.
- **Navbar**: Main navigation and Stellar wallet connection status.
- **Hero**: Institutional-grade landing section featuring Stellar-themed aesthetics.
- **MarketCard**: Detailed representation of individual prediction markets on Soroban.
- **Dashboard**: User-specific betting history and portfolio overview on Stellar.
- **Rewards**: Leaderboard and incentive tracking.

## Directory Structure
- `app/`: Next.js 16 pages, layouts, and route handlers.
- `app/components/`: Page-specific UI components.
- `components/`: Shared reusable UI components.
- `lib/`: Core logic, services, and utilities.
- `providers/`: Context providers for global state.
- `tests/`: Vitest test suites for components and utilities.
- `public/`: Static assets.
- `app/embed/pool/[poolId]/`: Standalone, iframe-friendly pool widget route
  used for embedding a single pool on external sites. Renders
  `components/PoolEmbedWidget`; `components/EmbedCodeSnippet` produces the
  copyable `<iframe>` markup.

## Component Documentation

### Layout Components
- **Navbar**: Responsive navigation with mobile menu support. Handles the primary Stellar wallet connection.
- **Footer**: Professional footer with social links, legal info, and Stellar ecosystem overview.
- **Wallet Providers**: Context providers that wrap the application to provide wallet authentication state.

### Dashboard Components
- **PortfolioOverview**: High-level summary of user earnings, wagered amounts (XLM), and profit/loss.
- **ActiveBetsCard**: Interactive list of the user's current open prediction markets on Soroban.
- **MarketStatsCard**: Statistics for individual pools, including participant counts and volume.

### UI Components
- **MarketCard**: The primary display unit for prediction markets, featuring glassmorphism effects and hover interactions.
- **Hero**: The landing page's main call-to-action section with Stellar-inspired aesthetics.
- **Leaderboard**: Displays top contributors and users based on platform activity.

## State Management

### Stellar Authentication (React Context)
Predinex uses React Context for global state management related to user authentication and wallet connectivity.

**Key State Variables:**
- `userAddress`: The authenticated Stellar public key.
- `isConnected`: Boolean flag for wallet status.
- `network`: Current target network (Testnet/Public).

## On-Chain Data Integration

The frontend interacts with Soroban smart contracts using the Stellar SDK.

### Fetching Data
- **Soroban RPC**: Use Soroban RPC calls for fetching pool details, user bets, and system stats.
- **Ledger Polling**: Strategic polling of ledger state to ensure the UI reflects the latest on-chain data.

### Executing Transactions
- **Wallet Signing**: Utilizes Freighter or WalletConnect to prompt users for transaction signing.
- **Transaction Monitoring**: Custom hooks track transaction status from `pending` to `success` or `failed` on the Stellar network.

## Styling and Design System

### Tailwind CSS
We use Tailwind CSS 4 for all component styling, leveraging a custom theme that provides a cohesive institutional aesthetic.

**Core Design Principles:**
- **Glassmorphism**: Extensive use of `backdrop-blur` and semi-transparent backgrounds.
- **Stellar Aesthetics**: Clean, fast, and secure look-and-feel inspired by the Stellar ecosystem.

## Performance Optimization
- **Skeleton Loaders**: Custom `animate-pulse` skeletons are implemented for `MarketCard` and `PortfolioOverview`.
- **Error Handling**: A global `ErrorBoundary` catches runtime failures, providing users with a graceful fallback and recovery path.
