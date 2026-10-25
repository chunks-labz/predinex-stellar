/**
 * @deprecated `AuthGuard` only checks wallet connectivity and performs no
 * authorization. Import `WalletConnectGate` for connection gating, or
 * `AdminGuard` for admin pages.
 */
export { default } from './WalletConnectGate';
export type { WalletConnectGateProps as AuthGuardProps } from './WalletConnectGate';
