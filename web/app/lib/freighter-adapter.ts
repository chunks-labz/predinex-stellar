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

function errorMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).toLowerCase();
}

function isRejectionError(err: unknown): boolean {
  const msg = errorMessage(err);
  return ['user declined', 'user rejected', 'rejected', 'cancelled', 'canceled', 'denied'].some(
    (phrase) => msg.includes(phrase)
  );
}

function isDisconnectError(err: unknown): boolean {
  const msg = errorMessage(err);
  return [
    'disconnected',
    'disconnect',
    'wallet not connected',
    'not connected',
    'no account',
    'account not found',
  ].some((phrase) => msg.includes(phrase));
}

function mapFreighterError(err: unknown): WalletError {
  if (isRejectionError(err)) {
    return createWalletError(WalletErrorType.CONNECTION_REJECTED, 'Freighter', err instanceof Error ? err : undefined);
  }

  if (isDisconnectError(err)) {
    return createWalletError(WalletErrorType.WALLET_DISCONNECTED, 'Freighter', err instanceof Error ? err : undefined);
  }

  if (!isFreighterInstalled()) {
    return createWalletError(WalletErrorType.EXTENSION_NOT_FOUND, 'Freighter');
  }

  if (errorMessage(err).includes('network') || errorMessage(err).includes('timeout') || errorMessage(err).includes('fetch')) {
    return createWalletError(WalletErrorType.NETWORK_ERROR, 'Freighter', err instanceof Error ? err : undefined);
  }

  return createWalletError(WalletErrorType.UNKNOWN_ERROR, 'Freighter', err instanceof Error ? err : undefined);
}

async function isFreighterStillConnected(api: FreighterApi | null): Promise<boolean> {
  if (!api) return false;
  try {
    const { isConnected } = await api.isConnected();
    return isConnected;
  } catch {
    return false;
  }
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
  let _connectionGeneration = 0;

  function setState(patch: Partial<FreighterWalletClient>) {
    onStateChange(patch);
  }

  function clearConnectionState() {
    _address = null;
    _isConnected = false;
    _connectionGeneration += 1;
    setState({ address: null, isConnected: false, isLoading: false } as Partial<FreighterWalletClient>);
  }

  async function withSigning<T>(sign: (api: FreighterApi) => Promise<T>): Promise<T> {
    const api = getFreighterApi();
    if (!api || !_isConnected) {
      throw createWalletError(WalletErrorType.EXTENSION_NOT_FOUND, 'Freighter');
    }

    const generation = _connectionGeneration;
    _isLoading = true;
    setState({ isLoading: true } as Partial<FreighterWalletClient>);

    try {
      const result = await sign(api);
      if (generation !== _connectionGeneration || !_isConnected) {
        throw createWalletError(WalletErrorType.WALLET_DISCONNECTED, 'Freighter');
      }
      if (!(await isFreighterStillConnected(api))) {
        throw createWalletError(WalletErrorType.WALLET_DISCONNECTED, 'Freighter');
      }
      return result;
    } catch (err) {
      if (err instanceof WalletError && err.type === WalletErrorType.WALLET_DISCONNECTED) {
        clearConnectionState();
        throw err;
      }
      if (
        !isRejectionError(err) &&
        (isDisconnectError(err) ||
          generation !== _connectionGeneration ||
          !_isConnected ||
          !(await isFreighterStillConnected(api)))
      ) {
        clearConnectionState();
        throw createWalletError(WalletErrorType.WALLET_DISCONNECTED, 'Freighter', err instanceof Error ? err : undefined);
      }
      throw mapFreighterError(err);
    } finally {
      _isLoading = false;
      setState({ isLoading: false } as Partial<FreighterWalletClient>);
    }
  }

  const adapter: FreighterWalletClient = {
    chain: 'stellar' as WalletChain,
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
      clearConnectionState();
    },

    signTransaction(xdr, opts) {
      return withSigning((api) =>
        api.signTransaction(xdr, {
          networkPassphrase: opts?.networkPassphrase,
          address: opts?.address ?? _address ?? undefined,
        }).then((result) => result.signedTxXdr)
      );
    },

    signAuthEntry(entryPreimageXdr, opts) {
      return withSigning((api) =>
        api.signAuthEntry(entryPreimageXdr, {
          address: opts?.address ?? _address ?? undefined,
        }).then((result) => result.signedAuthEntry)
      );
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
