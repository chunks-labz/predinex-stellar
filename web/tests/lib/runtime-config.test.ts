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

