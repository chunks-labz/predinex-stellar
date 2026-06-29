import { describe, it, expect } from 'vitest';
import {
  stellarNetworks,
  SUPPORTED_NETWORK_IDS,
  appKitMetadata,
  WALLETCONNECT_PROJECT_ID,
} from '@/lib/appkit-config';

describe('appkit-config — issue #210', () => {
  it('exposes only Stellar CAIP-2 chain ids', () => {
    expect(stellarNetworks.mainnet.id).toBe('stellar:pubnet');
    expect(stellarNetworks.testnet.id).toBe('stellar:testnet');
    expect(SUPPORTED_NETWORK_IDS).toEqual(['stellar:pubnet', 'stellar:testnet']);
  });

  it('does not export any Stacks chain ids in active config', () => {
    const serialized = JSON.stringify(stellarNetworks).toLowerCase();
    expect(serialized).not.toContain('stacks:mainnet');
    expect(serialized).not.toContain('stacks:testnet');
    for (const net of Object.values(stellarNetworks)) {
      expect(net.chainNamespace).toBe('stellar');
      expect(net.id.startsWith('stellar:')).toBe(true);
      expect(net.nativeCurrency.symbol).toBe('XLM');
    }
  });

  it('uses Stellar RPC endpoints (no Hiro/Stacks RPC URLs)', () => {
    for (const net of Object.values(stellarNetworks)) {
      for (const url of net.rpcUrls.default.http) {
        expect(url).not.toContain('hiro.so');
        expect(url).not.toContain('stacks');
      }
      expect(net.blockExplorers.default.url).toContain('stellar.expert');
    }
  });

  it('keeps WalletConnect project id and metadata exported', () => {
    expect(typeof WALLETCONNECT_PROJECT_ID).toBe('string');
    expect(WALLETCONNECT_PROJECT_ID.length).toBeGreaterThan(0);
    expect(appKitMetadata.name).toBe('Predinex');
    expect(appKitMetadata.description.toLowerCase()).toContain('stellar');
  });
});
