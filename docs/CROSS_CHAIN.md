# Cross-Chain Pool Mirroring

## Overview

Predinex supports cross-chain pool mirroring, allowing prediction markets created on Stellar to have mirrored counterparts on other supported chains. Users can participate from any supported chain, and outcomes are settled based on the source chain's result.

## Supported Chains

| Chain ID | Name     | Status    |
|----------|----------|-----------|
| 0        | Stellar  | Active    |
| 1        | Ethereum | Planned   |
| 2        | Polygon  | Planned   |
| 3        | Arbitrum | Planned   |
| 4        | Solana   | Planned   |

## Architecture

### Pool Mirroring Flow

1. **Source Pool Creation**: A pool is created on Stellar via `create_pool`
2. **Mirror Creation**: Admin calls `create_pool_mirror` with source pool ID, source/target chain IDs, and bridge contract address
3. **Unified Pool ID**: Each mirror gets a unique `unified_pool_id` that identifies the pool across all chains
4. **Cross-Chain Betting**: Users place bets on their preferred chain via the bridge contract
5. **Settlement**: When the source pool settles, admin calls `settle_mirror_from_source` to propagate the result

### Bridge Integration

The bridge contract address is stored per-mirror and is responsible for:
- Relaying bet placements from the target chain to Stellar
- Propagating settlement results back to the target chain
- Handling cross-chain asset transfers

### Security

- **Source Verification**: Mirrored pools can only be settled after verifying the source chain settlement
- **Bridge Timeout**: Configurable timeout (`set_bridge_timeout`) prevents stale settlements (default: 24 hours)
- **Dispute Window**: Configurable dispute period (`set_cross_chain_dispute_window`) for cross-chain settlements (default: 7 days)
- **Admin-Only Operations**: Only the treasury recipient can create mirrors and trigger cross-chain settlements

## Contract Functions

### Admin Functions

| Function | Description |
|----------|-------------|
| `create_pool_mirror(source_pool_id, source_chain, target_chain, bridge_contract)` | Create a mirror for an existing pool |
| `settle_mirror_from_source(source_pool_id, winning_outcome)` | Settle a mirror based on source chain result |
| `set_bridge_timeout(timeout_secs)` | Set bridge timeout (default: 86400s) |
| `set_cross_chain_dispute_window(window_secs)` | Set dispute window (default: 7 days) |

### View Functions

| Function | Description |
|----------|-------------|
| `get_pool_mirror(source_pool_id)` | Get mirror config for a pool |
| `get_mirror_by_unified_id(unified_id)` | Get mirror config by unified ID |
| `get_bridge_timeout()` | Get current bridge timeout |
| `get_cross_chain_dispute_window()` | Get current dispute window |

### Events

| Event | Description |
|-------|-------------|
| `mirror_created` | Emitted when a new pool mirror is created |
| `cross_chain_settled` | Emitted when a mirror is settled from source |
| `bridge_timeout_set` | Emitted when bridge timeout is updated |
| `cross_chain_dispute_window_set` | Emitted when dispute window is updated |

## Adding a New Supported Chain

To add support for a new chain:

1. **Add Chain ID**: Add a new variant to the `ChainId` enum in `contracts/predinex/src/lib.rs`
2. **Deploy Bridge Contract**: Deploy a bridge contract on the target chain that implements the Predinex bridge interface
3. **Register Bridge**: Use `create_pool_mirror` with the new chain ID and bridge contract address
4. **Frontend**: Add the chain to the `CHAINS` array in `web/components/CrossChainFilter.tsx`
5. **Test**: Add integration tests for the new chain's bridge contract

## Frontend Integration

The `CrossChainFilter` component (`web/components/CrossChainFilter.tsx`) provides a chain selector UI. Use it on pool listing pages to filter pools by their source or target chain.

```tsx
import CrossChainFilter, { useCrossChainFilter } from '@/components/CrossChainFilter';

function PoolsPage() {
  const { selectedChain, setSelectedChain } = useCrossChainFilter();

  return (
    <div>
      <CrossChainFilter selected={selectedChain} onSelect={setSelectedChain} />
      {/* Filter pools based on selectedChain */}
    </div>
  );
}
```
