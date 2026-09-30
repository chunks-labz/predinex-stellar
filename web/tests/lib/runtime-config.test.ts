import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getRuntimeConfig, __resetRuntimeConfigForTests } from '../../app/lib/runtime-config';
import { WALLETCONNECT_CONFIG } from '../../app/lib/walletconnect-config';

describe('runtime-config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    __resetRuntimeConfigForTests();
    process.env = { ...originalEnv };
  });

  it('resolves typed config for mainnet', () => {
    process.env.NEXT_PUBLIC_NETWORK = 'mainnet';

    const cfg = getRuntimeConfig();

    expect(cfg.network).toBe('mainnet');
    expect(cfg.contract.id).toContain('.');
    expect(cfg.contract.address).toBeTypeOf('string');
    expect(cfg.contract.name).toBeTypeOf('string');

    // API URLs should be present (from walletconnect-config).
    expect(cfg.api.coreApiUrl).toBeTypeOf('string');
    expect(cfg.api.coreApiUrl.length).toBeGreaterThan(0);
    expect(cfg.api.explorerUrl).toBeTypeOf('string');
    expect(cfg.api.rpcUrl).toBeTypeOf('string');
  });

  it('defaults to testnet when NEXT_PUBLIC_NETWORK is missing', () => {
    delete process.env.NEXT_PUBLIC_NETWORK;

    expect(getRuntimeConfig().network).toBe('testnet');
  });

  it('fails fast with actionable error when NEXT_PUBLIC_NETWORK is invalid', () => {
    process.env.NEXT_PUBLIC_NETWORK = 'devnet';

    expect(() => getRuntimeConfig()).toThrow(/Invalid config NEXT_PUBLIC_NETWORK/i);
  });

  it('fails early when wallet API configuration is missing for the active network', () => {
    process.env.NEXT_PUBLIC_NETWORK = 'mainnet';
    const originalRpcUrl = WALLETCONNECT_CONFIG.networks.mainnet.rpcUrl;
    // Simulate a missing required wallet endpoint.
    (WALLETCONNECT_CONFIG.networks.mainnet as any).rpcUrl = '';

    __resetRuntimeConfigForTests();
    expect(() => getRuntimeConfig()).toThrow(/Missing Stacks API URLs for network 'mainnet'/i);

    (WALLETCONNECT_CONFIG.networks.mainnet as any).rpcUrl = originalRpcUrl;
  });

  it('fails early when Soroban RPC configuration is missing for the active network', () => {
    process.env.NEXT_PUBLIC_NETWORK = 'mainnet';
    const originalSorobanRpcUrl = WALLETCONNECT_CONFIG.soroban.mainnet.rpcUrl;
    (WALLETCONNECT_CONFIG.soroban.mainnet as any).rpcUrl = '';

    __resetRuntimeConfigForTests();
    expect(() => getRuntimeConfig()).toThrow(/Missing Soroban RPC URLs for network 'mainnet'/i);

    (WALLETCONNECT_CONFIG.soroban.mainnet as any).rpcUrl = originalSorobanRpcUrl;
  });
});

// #1308 — NEXT_PUBLIC_SOROBAN_CONTRACT_ID and the deprecated
// NEXT_PUBLIC_CONTRACT_ADDRESS previously fed different config fields, so a
// deployment that set only one could have contract reads and Soroban event
// reads pointed at two different contracts.
describe('runtime-config contract id consolidation (#1308)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    __resetRuntimeConfigForTests();
    process.env = { ...originalEnv };
    process.env.NEXT_PUBLIC_NETWORK = 'testnet';
    delete process.env.NEXT_PUBLIC_SOROBAN_CONTRACT_ID;
    delete process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;
    delete process.env.NEXT_PUBLIC_CONTRACT_NAME;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('feeds both contract.address and soroban.contractId from the canonical name', () => {
    process.env.NEXT_PUBLIC_SOROBAN_CONTRACT_ID = 'CABC123';

    const cfg = getRuntimeConfig();

    expect(cfg.contract.address).toBe('CABC123');
    expect(cfg.contract.id).toBe('CABC123');
    expect(cfg.soroban.contractId).toBe('CABC123');
  });

  it('still honours the deprecated alias, and now feeds both fields', () => {
    process.env.NEXT_PUBLIC_CONTRACT_ADDRESS = 'CLEGACY99';

    const cfg = getRuntimeConfig();

    expect(cfg.contract.address).toBe('CLEGACY99');
    expect(cfg.soroban.contractId).toBe('CLEGACY99');
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('NEXT_PUBLIC_CONTRACT_ADDRESS is deprecated')
    );
  });

  it('lets the canonical name win when both are set', () => {
    process.env.NEXT_PUBLIC_SOROBAN_CONTRACT_ID = 'CCANON';
    process.env.NEXT_PUBLIC_CONTRACT_ADDRESS = 'CLEGACY';

    expect(getRuntimeConfig().soroban.contractId).toBe('CCANON');
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('NEXT_PUBLIC_CONTRACT_ADDRESS is deprecated')
    );
  });

  it('preserves the legacy ADDRESS.NAME id form', () => {
    process.env.NEXT_PUBLIC_SOROBAN_CONTRACT_ID = 'SP2WWKKF25SED3K5P6ETY7MDDNBQH50GPSP8EJM8N';
    process.env.NEXT_PUBLIC_CONTRACT_NAME = 'predinex-contract';

    const cfg = getRuntimeConfig();

    expect(cfg.contract.id).toBe('SP2WWKKF25SED3K5P6ETY7MDDNBQH50GPSP8EJM8N.predinex-contract');
    expect(cfg.contract.name).toBe('predinex-contract');
  });

  it('rejects CONTRACT_NAME on its own with an actionable message', () => {
    process.env.NEXT_PUBLIC_CONTRACT_NAME = 'predinex-contract';

    expect(() => getRuntimeConfig()).toThrow(/NEXT_PUBLIC_CONTRACT_NAME must not be set on its own/);
    expect(() => getRuntimeConfig()).toThrow(/NEXT_PUBLIC_SOROBAN_CONTRACT_ID/);
  });

  it('falls back to empty contract coordinates when no id is configured', () => {
    const cfg = getRuntimeConfig();

    expect(cfg.soroban.contractId).toBe('');
    expect(cfg.contract.address).toBeTypeOf('string');
  });
});

