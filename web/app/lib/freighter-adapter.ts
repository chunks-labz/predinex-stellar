/**
 * FreighterAdapter — Issue #207
 *
 * Concrete implementation of the WalletClient interface backed by the
 * Freighter browser extension for Stellar. Wires connection, account
 * retrieval, XDR signing, and error mapping through the shared abstraction
 * so UI components never import Freighter types directly.
 *
 * Freighter communicates via window.freighter (injected by the extension).
 * We call the extension API through a thin window-level shim so the module
 * remains importable in SSR (Next.js) environments where window is absent.
 */

import { WalletClient, WalletChain } from './wallet-adapter';
import { WalletErrorType, createWalletError, WalletError } from './wallet-errors';
import { createScopedLogger } from './logger';

const log = createScopedLogger('FreighterAdapter');

// ── Freighter window shim ──────────────────────────────────────────────────────

export type FreighterNetwork = 'MAINNET' | 'TESTNET' | 'FUTURENET';

interface FreighterApi {
  isConnected(): Promise<{ isConnected: boolean }>;
  getPublicKey(): Promise<string>;
  getNetwork(): Promise<{ network: string; networkUrl: string }>;
  signTransaction(
    xdr: string,
    opts?: { networkPassphrase?: string; address?: string }
  ): Promise<{ signedTxXdr: string; signerAddress: string }>;
  signAuthEntry(
    entryPreimageXdr: string,
    opts?: { address?: string }
  ): Promise<{ signedAuthEntry: string; signerAddress: string }>;
}

function getFreighterApi(): FreighterApi | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { freighter?: FreighterApi }).freighter ?? null;
}

export function isFreighterInstalled(): boolean {
  return getFreighterApi() !== null;
}

// ── Error mapping ──────────────────────────────────────────────────────────────

function mapFreighterError(err: unknown): WalletError {
  if (!isFreighterInstalled()) {
    return createWalletError(WalletErrorType.EXTENSION_NOT_FOUND, 'Freighter');
  }

  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();

  if (msg.includes('user declined') || msg.includes('rejected') || msg.includes('cancelled')) {
    return createWalletError(WalletErrorType.CONNECTION_REJECTED, 'Freighter', err instanceof Error ? err : undefined);
  }

  if (msg.includes('network') || msg.includes('timeout') || msg.includes('fetch')) {
    return createWalletError(WalletErrorType.NETWORK_ERROR, 'Freighter', err instanceof Error ? err : undefined);
  }

  return createWalletError(WalletErrorType.UNKNOWN_ERROR, 'Freighter', err instanceof Error ? err : undefined);
}

// ── FreighterAdapter ───────────────────────────────────────────────────────────

export interface FreighterWalletClient extends WalletClient {
  /** Sign a Stellar XDR transaction envelope. */
  signTransaction(
    xdr: string,
    opts?: { networkPassphrase?: string; address?: string }
  ): Promise<string>;
  /** Sign a Soroban authorization entry. */
  signAuthEntry(
    entryPreimageXdr: string,
    opts?: { address?: string }
  ): Promise<string>;
  /** Return the active Freighter network name. */
  getNetwork(): Promise<FreighterNetwork>;
}

/**
 * Create a reactive Freighter wallet client.
 *
 * Returns an object whose `connect`, `disconnect`, `signTransaction`,
 * and `signAuthEntry` methods can be called from UI code without importing
 * the Freighter extension API directly.
 *
 * Usage:
 * ```ts
 * import { createFreighterAdapter } from '@/app/lib/freighter-adapter';
 * const wallet = createFreighterAdapter(setWalletState);
 * await wallet.connect();
 * ```
 */
export function createFreighterAdapter(
  onStateChange: (state: Partial<FreighterWalletClient>) => void
): FreighterWalletClient {
  let _address: string | null = null;
  let _isConnected = false;
  let _isLoading = false;

  function setState(patch: Partial<FreighterWalletClient>) {
    onStateChange(patch);
  }

  const adapter: FreighterWalletClient = {
    chain: 'stacks' as WalletChain, // kept for interface compat; Freighter is Stellar
    get isLoading() { return _isLoading; },
    get isConnected() { return _isConnected; },
    get address() { return _address; },

    async connect() {
      if (!isFreighterInstalled()) {
        const err = createWalletError(WalletErrorType.EXTENSION_NOT_FOUND, 'Freighter');
        log.error(`connect failed: ${err.message}`);
        if (typeof window !== 'undefined') {
          window.open('https://www.freighter.app/', '_blank', 'noopener');
        }
        return;
      }

      _isLoading = true;
      setState({ isLoading: true } as Partial<FreighterWalletClient>);

      try {
        const api = getFreighterApi()!;
        const { isConnected } = await api.isConnected();

        if (!isConnected) {
          // Freighter requires the user to manually allow the site in its UI;
          // calling getPublicKey() triggers the permission prompt.
        }

        const publicKey = await api.getPublicKey();
        _address = publicKey;
        _isConnected = true;
        setState({ address: publicKey, isConnected: true, isLoading: false } as Partial<FreighterWalletClient>);
      } catch (err) {
        _isConnected = false;
        _address = null;
        const mapped = mapFreighterError(err);
        log.error(`connect error: ${mapped.message}`);
        setState({ isConnected: false, address: null, isLoading: false } as Partial<FreighterWalletClient>);
      } finally {
        _isLoading = false;
      }
    },

    disconnect() {
      _address = null;
      _isConnected = false;
      setState({ address: null, isConnected: false } as Partial<FreighterWalletClient>);
    },

    async signTransaction(xdr, opts) {
      const api = getFreighterApi();
      if (!api || !_isConnected) {
        throw createWalletError(WalletErrorType.EXTENSION_NOT_FOUND, 'Freighter');
      }
      try {
        const result = await api.signTransaction(xdr, {
          networkPassphrase: opts?.networkPassphrase,
          address: opts?.address ?? _address ?? undefined,
        });
        return result.signedTxXdr;
      } catch (err) {
        throw mapFreighterError(err);
      }
    },

    async signAuthEntry(entryPreimageXdr, opts) {
      const api = getFreighterApi();
      if (!api || !_isConnected) {
        throw createWalletError(WalletErrorType.EXTENSION_NOT_FOUND, 'Freighter');
      }
      try {
        const result = await api.signAuthEntry(entryPreimageXdr, {
          address: opts?.address ?? _address ?? undefined,
        });
        return result.signedAuthEntry;
      } catch (err) {
        throw mapFreighterError(err);
      }
    },

    async getNetwork(): Promise<FreighterNetwork> {
      const api = getFreighterApi();
      if (!api) {
        throw createWalletError(WalletErrorType.EXTENSION_NOT_FOUND, 'Freighter');
      }
      const { network } = await api.getNetwork();
      const normalized = network.toUpperCase() as FreighterNetwork;
      return normalized;
    },
  };

  return adapter;
}

// ── Singleton factory for app-wide usage ──────────────────────────────────────

let _singleton: FreighterWalletClient | null = null;

/**
 * Returns the shared Freighter adapter instance.
 * Call once at app root and pass `setState` from your wallet context.
 */
export function getFreighterAdapter(
  onStateChange: (state: Partial<FreighterWalletClient>) => void
): FreighterWalletClient {
  if (!_singleton) {
    _singleton = createFreighterAdapter(onStateChange);
  }
  return _singleton;
}

/** Reset the singleton (testing only). */
export function _resetFreighterAdapterForTests(): void {
  _singleton = null;
}
