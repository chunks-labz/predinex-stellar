# Wallet Connection Components

Shared UI components should live in [`../../components`](../../components) and
be imported with `@/components/...`. This directory is for App Router-specific
components and temporary compatibility re-exports for older `app/components`
imports.

This directory contains the wallet connection UI for Predinex. The current support matrix is documented in [WALLET_NETWORK_SUPPORT.md](../../docs/WALLET_NETWORK_SUPPORT.md).

## Components

### WalletConnectButton
The main wallet connection interface component.

**Features:**
- Wallet provider selection dropdown
- Entry point for the currently supported wallet flow
- Balance display and refresh functionality
- Loading states and error handling
- Responsive design

**Usage:**
```tsx
import { WalletConnectButton } from '@/components/WalletConnectButton';

function MyComponent() {
  return <WalletConnectButton />;
}
```

### NetworkSwitcher
Component for switching between the currently supported Stellar networks.

**Features:**
- Visual network status indicator
- One-click network switching
- Error handling for failed switches
- Disabled state during operations

**Usage:**
```tsx
import { NetworkSwitcher } from '@/components/NetworkSwitcher';

function MyComponent() {
  return <NetworkSwitcher />;
}
```

### WalletStatus
Displays wallet connection health and status information.

**Features:**
- Session health monitoring
- Online/offline status
- Session expiration warnings
- Real-time status updates

**Usage:**
```tsx
import { WalletStatus } from '@/components/WalletStatus';

function MyComponent() {
  return <WalletStatus />;
}
```

### WalletErrorBoundary
Error boundary component for graceful wallet error handling.

**Features:**
- Automatic error recovery with retry logic
- User-friendly error messages
- Development error details
- Fallback UI rendering

**Usage:**
```tsx
import { WalletErrorBoundary } from '@/components/WalletErrorBoundary';

function MyApp() {
  return (
    <WalletErrorBoundary>
      <MyWalletComponents />
    </WalletErrorBoundary>
  );
}
```

### OracleManagement
Feature status: fixture-backed placeholder tooling, disabled by default for production-facing surfaces.

Set `NEXT_PUBLIC_ENABLE_ORACLE_MANAGEMENT_PLACEHOLDER=true` only in a contributor or test environment to review the mock oracle-management path. When enabled, the component labels itself as a placeholder preview and keeps registration actions disabled so fixture data is not presented as live oracle administration.

To find the oracle-management route visit [page.tsx](file:///C:/Stellar%20Contributions/predinex-stellar/web/app/oracle-management/page.tsx).

To find oracle-management placeholder gating visit [OracleManagement.tsx](file:///C:/Stellar%20Contributions/predinex-stellar/web/app/components/OracleManagement.tsx).

The oracle-management feature flag can be found in [feature-flags.ts](file:///C:/Stellar%20Contributions/predinex-stellar/web/app/lib/feature-flags.ts).

## Context and Hooks

### useWalletConnect
Main hook for accessing wallet functionality.

**Returns:**
- `session`: Current wallet session data
- `isConnecting`: Connection loading state
- `error`: Current error message
- `availableWallets`: List of detected wallet providers
- `connect(walletType?)`: Connect to a specific wallet
- `disconnect()`: Disconnect current wallet
- `switchNetwork(network)`: Switch between supported networks
- `signMessage(message)`: Sign a message
- `sendTransaction(payload)`: Send a transaction
- `refreshBalance()`: Refresh wallet balance

**Usage:**
```tsx
import { useWalletConnect } from '@/context/WalletConnectContext';

function MyComponent() {
  const { session, connect, disconnect } = useWalletConnect();
  
  return (
    <div>
      {session ? (
        <button onClick={disconnect}>Disconnect</button>
      ) : (
        <button onClick={() => connect()}>Connect</button>
      )}
    </div>
  );
}
```

## Services

### WalletService
Core service for wallet operations and provider management.

### SessionStorageService
Handles secure session persistence and validation.

### TransactionService
Manages transaction creation, signing, and broadcasting.

### SessionValidator
Validates and monitors wallet session health.

### ErrorRecoveryService
Provides intelligent error recovery strategies.

## Configuration

The wallet system is configured through:
- `WALLETCONNECT_CONFIG` in `lib/walletconnect-config.ts`
- Environment variables in `.env`
- Feature flags in `lib/constants.ts`

## Error Handling

The system implements comprehensive error handling:
1. **Connection Errors**: Automatic retry with progressive backoff
2. **Session Errors**: Automatic cleanup and re-authentication prompts
3. **Transaction Errors**: User-friendly error messages and recovery suggestions
4. **Network Errors**: Fallback options and network switching guidance

## Testing

The wallet system includes:
- Unit tests for individual components and services
- Property-based tests for correctness validation
- Integration tests for complete wallet flows
- Error boundary testing for graceful degradation

## Browser Support

Supported browsers:
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

Mobile wallet support varies by provider and may require specific mobile apps.

For wallet and network support details, see [WALLET_NETWORK_SUPPORT.md](../../docs/WALLET_NETWORK_SUPPORT.md).
