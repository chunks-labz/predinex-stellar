# Predinex Frontend

Next.js 14 application providing the user interface for Predinex Prediction Markets.

## Tech Stack
- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS
- **Blockchain Interop**: Stellar SDK (Soroban integration)
- **Icons**: Lucide React

> [!NOTE]
> **Migration Status**: The active wallet and network support matrix is documented in [WALLET_NETWORK_SUPPORT.md](./docs/WALLET_NETWORK_SUPPORT.md). Legacy Stacks-oriented helpers still exist during the migration, but they are not the authoritative product support surface.

## UI Kit (Design System)
The project includes a custom UI kit located in `components/ui/` designed for a premium, institutional-grade experience:
- **Card**: Glassmorphism-based container for content sections.
- **Badge**: Status indicators with multiple color variants.
- **StatItem**: Specialized component for displaying dashboard metrics and trends.
- **Tabs**: Smooth navigation for switching between market views.
- **Tooltip**: Technical term explanations on hover.
- **Toast**: Ephemeral notifications for transaction feedback.

## Key Features
- **Market Discovery**: Advanced filtering, search, and sorting system on Stellar.
- **Wallet Integration**: See the [wallet and network support page](./docs/WALLET_NETWORK_SUPPORT.md) for the current supported wallets and networks.
- **Dashboard**: Real-time portfolio tracking and performance metrics on Soroban.
- **Transitions**: Native-like smooth page and modal animations.

## Performance Policy
Auto-refreshing market and activity hooks pause while a tab is hidden and resume immediately on focus. See [POLLING_POLICY.md](./docs/POLLING_POLICY.md) for the current cadence and visibility rules.

## Development
See [DEVELOPMENT.md](./DEVELOPMENT.md) for setup and architectural guidelines.
