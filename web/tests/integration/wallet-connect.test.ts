/**
 * FreighterAdapter integration tests — Issue #469
 *
 * Verifies connection, disconnection, signing, and error-handling behaviour
 * of the FreighterAdapter by fully mocking window.freighter so no live
 * browser extension is required.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isFreighterInstalled,
  createFreighterAdapter,
  _resetFreighterAdapterForTests,
} from '@/app/lib/freighter-adapter';
import { WalletErrorType } from '@/app/lib/wallet-errors';

// ── Types ──────────────────────────────────────────────────────────────────────

interface FreighterApiMock {
  isConnected: ReturnType<typeof vi.fn>;
  getPublicKey: ReturnType<typeof vi.fn>;
  getNetwork: ReturnType<typeof vi.fn>;
  signTransaction: ReturnType<typeof vi.fn>;
  signAuthEntry: ReturnType<typeof vi.fn>;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const TEST_PUBLIC_KEY = 'GBVZJZZWYTMPXMKRYVT5R5JCGWXQ6BZFWB7DLPVNBKD4A5YXZJXZQ7A';

function buildFreighterMock(overrides?: Partial<FreighterApiMock>): FreighterApiMock {
  return {
    isConnected: vi.fn().mockResolvedValue({ isConnected: true }),
    getPublicKey: vi.fn().mockResolvedValue(TEST_PUBLIC_KEY),
    getNetwork: vi.fn().mockResolvedValue({ network: 'testnet', networkUrl: 'https://horizon-testnet.stellar.org' }),
    signTransaction: vi.fn().mockResolvedValue({ signedTxXdr: 'signed-xdr-result', signerAddress: TEST_PUBLIC_KEY }),
    signAuthEntry: vi.fn().mockResolvedValue({ signedAuthEntry: 'signed-auth-result', signerAddress: TEST_PUBLIC_KEY }),
    ...overrides,
  };
}

function installFreighterMock(mock: FreighterApiMock) {
  Object.defineProperty(window, 'freighter', {
    value: mock,
    configurable: true,
    writable: true,
  });
}

function removeFreighterMock() {
  Object.defineProperty(window, 'freighter', {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

// ── Test suite ─────────────────────────────────────────────────────────────────

describe('FreighterAdapter integration', () => {
  beforeEach(() => {
    _resetFreighterAdapterForTests();
  });

  afterEach(() => {
    removeFreighterMock();
    vi.restoreAllMocks();
  });

  // ── isFreighterInstalled ───────────────────────────────────────────────────

  it('isFreighterInstalled returns false when window.freighter is absent', () => {
    removeFreighterMock();
    expect(isFreighterInstalled()).toBe(false);
  });

  it('isFreighterInstalled returns true when window.freighter is present', () => {
    installFreighterMock(buildFreighterMock());
    expect(isFreighterInstalled()).toBe(true);
  });

  // ── connect() ─────────────────────────────────────────────────────────────

  it('connect() sets isConnected and address when Freighter responds', async () => {
    installFreighterMock(buildFreighterMock());

    const stateChanges: object[] = [];
    const adapter = createFreighterAdapter((patch) => stateChanges.push(patch));

    await adapter.connect();

    expect(adapter.isConnected).toBe(true);
    expect(adapter.address).toBe(TEST_PUBLIC_KEY);

    const finalState = stateChanges.find(
      (s): s is { isConnected: boolean; address: string } =>
        typeof s === 'object' && 'isConnected' in s && (s as { isConnected: boolean }).isConnected === true
    );
    expect(finalState).toBeDefined();
    expect((finalState as { address: string }).address).toBe(TEST_PUBLIC_KEY);
  });

  it('connect() opens install page when Freighter is not installed', async () => {
    removeFreighterMock();

    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    const adapter = createFreighterAdapter(vi.fn());

    await adapter.connect();

    expect(openSpy).toHaveBeenCalledWith(
      'https://www.freighter.app/',
      '_blank',
      'noopener'
    );
  });

  it('connect() handles rejection gracefully', async () => {
    installFreighterMock(
      buildFreighterMock({
        getPublicKey: vi.fn().mockRejectedValue(new Error('user declined the request')),
      })
    );

    const adapter = createFreighterAdapter(vi.fn());
    await adapter.connect();

    expect(adapter.isConnected).toBe(false);
    expect(adapter.address).toBeNull();
  });

  // ── disconnect() ──────────────────────────────────────────────────────────

  it('disconnect() clears address and isConnected', async () => {
    installFreighterMock(buildFreighterMock());

    const stateChanges: object[] = [];
    const adapter = createFreighterAdapter((patch) => stateChanges.push(patch));

    await adapter.connect();
    expect(adapter.isConnected).toBe(true);

    adapter.disconnect();

    expect(adapter.isConnected).toBe(false);
    expect(adapter.address).toBeNull();
  });

  // ── signTransaction() ─────────────────────────────────────────────────────

  it('signTransaction() returns signed XDR', async () => {
    installFreighterMock(buildFreighterMock());

    const adapter = createFreighterAdapter(vi.fn());
    await adapter.connect();

    const result = await adapter.signTransaction('test-xdr');
    expect(result).toBe('signed-xdr-result');
  });

  it('signTransaction() throws when not connected', async () => {
    installFreighterMock(buildFreighterMock());

    const adapter = createFreighterAdapter(vi.fn());
    // Intentionally skip connect()

    await expect(adapter.signTransaction('test-xdr')).rejects.toMatchObject({
      type: WalletErrorType.EXTENSION_NOT_FOUND,
    });
  });

  // ── getNetwork() ──────────────────────────────────────────────────────────

  it('getNetwork() returns normalized network name', async () => {
    installFreighterMock(
      buildFreighterMock({
        getNetwork: vi.fn().mockResolvedValue({ network: 'testnet', networkUrl: 'https://horizon-testnet.stellar.org' }),
      })
    );

    const adapter = createFreighterAdapter(vi.fn());
    const network = await adapter.getNetwork();

    expect(network).toBe('TESTNET');
  });

  it('signTransaction() reports disconnect and clears connection state', async () => {
    installFreighterMock(
      buildFreighterMock({
        signTransaction: vi.fn().mockRejectedValue(new Error('Wallet disconnected while waiting for signature')),
      })
    );

    const stateChanges: Array<{ isConnected?: boolean; address?: string | null; isLoading?: boolean }> = [];
    const adapter = createFreighterAdapter((patch) => stateChanges.push(patch));
    await adapter.connect();

    await expect(adapter.signTransaction('test-xdr')).rejects.toMatchObject({
      type: WalletErrorType.WALLET_DISCONNECTED,
      message: /Reconnect your wallet and try again/,
    });
    expect(adapter.isConnected).toBe(false);
    expect(adapter.address).toBeNull();
    expect(adapter.isLoading).toBe(false);
    expect(stateChanges).toContainEqual(expect.objectContaining({ isConnected: false, address: null }));
    expect(stateChanges).toContainEqual(expect.objectContaining({ isLoading: false }));
  });

  it('signAuthEntry() reports disconnect and clears connection state', async () => {
    installFreighterMock(
      buildFreighterMock({
        signAuthEntry: vi.fn().mockRejectedValue(new Error('Wallet disconnected')),
      })
    );

    const adapter = createFreighterAdapter(vi.fn());
    await adapter.connect();

    await expect(adapter.signAuthEntry('test-auth-entry')).rejects.toMatchObject({
      type: WalletErrorType.WALLET_DISCONNECTED,
    });
    expect(adapter.isConnected).toBe(false);
    expect(adapter.address).toBeNull();
    expect(adapter.isLoading).toBe(false);
  });

  it('signTransaction() reports an explicit disconnect while signing', async () => {
    installFreighterMock(buildFreighterMock());

    const adapter = createFreighterAdapter(vi.fn());
    await adapter.connect();

    let resolveSign!: (value: { signedTxXdr: string; signerAddress: string }) => void;
    const pendingSign = new Promise<{ signedTxXdr: string; signerAddress: string }>((resolve) => {
      resolveSign = resolve;
    });
    const freighter = (window as unknown as { freighter: FreighterApiMock }).freighter;
    vi.mocked(freighter.signTransaction).mockReturnValueOnce(pendingSign);

    const signPromise = adapter.signTransaction('test-xdr');
    adapter.disconnect();
    resolveSign({ signedTxXdr: 'signed-xdr-result', signerAddress: TEST_PUBLIC_KEY });

    await expect(signPromise).rejects.toMatchObject({ type: WalletErrorType.WALLET_DISCONNECTED });
    expect(adapter.isConnected).toBe(false);
    expect(adapter.isLoading).toBe(false);
  });

  it('signTransaction() preserves user rejection as CONNECTION_REJECTED', async () => {
    installFreighterMock(
      buildFreighterMock({
        signTransaction: vi.fn().mockRejectedValue(new Error('User rejected the request')),
      })
    );

    const adapter = createFreighterAdapter(vi.fn());
    await adapter.connect();

    await expect(adapter.signTransaction('test-xdr')).rejects.toMatchObject({
      type: WalletErrorType.CONNECTION_REJECTED,
    });
    expect(adapter.isConnected).toBe(true);
    expect(adapter.address).toBe(TEST_PUBLIC_KEY);
    expect(adapter.isLoading).toBe(false);
  });

  it('signTransaction() returns signed XDR and resets loading state', async () => {
    installFreighterMock(buildFreighterMock());

    const stateChanges: Array<{ isLoading?: boolean }> = [];
    const adapter = createFreighterAdapter((patch) => stateChanges.push(patch));
    await adapter.connect();

    await expect(adapter.signTransaction('test-xdr')).resolves.toBe('signed-xdr-result');
    expect(adapter.isConnected).toBe(true);
    expect(adapter.isLoading).toBe(false);
    expect(stateChanges.some((patch) => patch.isLoading === true)).toBe(true);
    expect(stateChanges.some((patch) => patch.isLoading === false)).toBe(true);
  });
});
