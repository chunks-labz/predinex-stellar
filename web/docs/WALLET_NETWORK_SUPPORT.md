# Wallet and Network Support

This page is the single source of truth for wallet, network, and migration support in the Predinex web app.

## Current Support

### Wallets

| Wallet | Status | Notes |
| --- | --- | --- |
| WalletConnect | Supported | This is the active wallet entry point in the current UI. |
| Leather | Unsupported | The legacy connector path exists in code, but the wallet modal disables it. |
| Xverse | Unsupported | The legacy connector path exists in code, but the wallet modal disables it. |
| Freighter | Unsupported in the current UI | A Freighter adapter exists in the repository, but it is not wired into the active wallet flow. |

### Networks

| Network | Status | Notes |
| --- | --- | --- |
| Stellar Mainnet | Supported | Exposed in AppKit as `stellar:pubnet`. |
| Stellar Testnet | Supported | Exposed in AppKit as `stellar:testnet`. |
| Devnet | Unsupported for the product runtime | Present in low-level helper code only; `NEXT_PUBLIC_NETWORK` does not accept `devnet`. |

## Migration Status

The frontend is still mid-migration from the older Stacks-oriented implementation to the Stellar/Soroban product surface.

What is live today:

- Stellar mainnet/testnet are the supported product networks.
- The wallet chooser currently exposes WalletConnect as the active option.
- The network switcher and AppKit metadata are already Stellar-based.

What remains legacy or internal:

- Stacks-specific helper modules and endpoints still exist in the repository.
- Freighter, Leather, and Xverse are represented in legacy code paths but are not supported by the current wallet modal.
- `devnet` exists in helper configuration for local experimentation, not as a supported production environment.

## Known Limitations

- Do not assume any wallet listed in older README files is still supported unless this page says so.
- Do not use `devnet` for product documentation, onboarding, or release notes.
- If you see Hiro or other Stacks endpoints in helper code, treat them as migration artifacts unless this page explicitly says otherwise.

## Unsupported Combinations

- Leather or Xverse in the current wallet modal.
- Freighter as a first-class product wallet until it is wired into the active connection flow.
- `NEXT_PUBLIC_NETWORK=devnet`.
- Any documentation that describes the live product as Stacks-only or Freighter-first.

## Source Links

- Wallet modal implementation: [`web/app/components/WalletModal.tsx`](../app/components/WalletModal.tsx)
- Wallet adapter bridge: [`web/app/components/WalletAdapterProvider.tsx`](../app/components/WalletAdapterProvider.tsx)
- Stellar network metadata: [`web/lib/appkit-config.ts`](../lib/appkit-config.ts)
- Runtime network config: [`web/app/lib/runtime-config.ts`](../app/lib/runtime-config.ts)
