import { describe, it, expect, beforeEach } from 'vitest';
import { getRuntimeConfig, __resetRuntimeConfigForTests } from '../../app/lib/runtime-config';

/**
 * #1308 — `NEXT_PUBLIC_SOROBAN_CONTRACT_ID` is the single canonical name for the
 * deployed contract. `NEXT_PUBLIC_CONTRACT_ADDRESS` survives as a deprecated
 * alias and `NEXT_PUBLIC_CONTRACT_NAME` as an optional legacy field.
 *
 * These cover the two properties that matter operationally: the two config
 * surfaces can never disagree about which contract is in play, and a deployment
 * still using the old variable names must not silently change contracts.
 */

const CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';

describe('contract configuration resolution (#1308)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    __resetRuntimeConfigForTests();
    process.env = { ...originalEnv };
    delete process.env.NEXT_PUBLIC_SOROBAN_CONTRACT_ID;
    delete process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;
    delete process.env.NEXT_PUBLIC_CONTRACT_NAME;
  });

  it('resolves the contract id from the canonical variable', () => {
    process.env.NEXT_PUBLIC_SOROBAN_CONTRACT_ID = CONTRACT_ID;

    const cfg = getRuntimeConfig();

    expect(cfg.contract.id).toBe(CONTRACT_ID);
    expect(cfg.contract.address).toBe(CONTRACT_ID);
    expect(cfg.soroban.contractId).toBe(CONTRACT_ID);
  });

  it('keeps both config surfaces pointed at the same contract', () => {
    process.env.NEXT_PUBLIC_SOROBAN_CONTRACT_ID = CONTRACT_ID;

    const cfg = getRuntimeConfig();

    // A drift here means the Soroban adapters read a different contract than
    // the config object, which is the bug #1308 describes.
    expect(cfg.soroban.contractId).toBe(cfg.contract.address);
  });

  it('still honours the deprecated alias so existing deployments do not change contract', () => {
    process.env.NEXT_PUBLIC_CONTRACT_ADDRESS = CONTRACT_ID;

    const cfg = getRuntimeConfig();

    expect(cfg.contract.address).toBe(CONTRACT_ID);
    expect(cfg.soroban.contractId).toBe(CONTRACT_ID);
  });

  it('prefers the canonical variable when both are set', () => {
    process.env.NEXT_PUBLIC_SOROBAN_CONTRACT_ID = CONTRACT_ID;
    process.env.NEXT_PUBLIC_CONTRACT_ADDRESS = 'CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB4A';

    const cfg = getRuntimeConfig();

    expect(cfg.contract.address).toBe(CONTRACT_ID);
    expect(cfg.soroban.contractId).toBe(CONTRACT_ID);
  });

  it('no longer requires the legacy contract name alongside the id', () => {
    process.env.NEXT_PUBLIC_SOROBAN_CONTRACT_ID = CONTRACT_ID;

    // Previously this combination threw "must both be set when overriding
    // contract coordinates", which is what forced operators to set two names
    // for one contract.
    expect(() => getRuntimeConfig()).not.toThrow();
    expect(getRuntimeConfig().contract.name).toBe('');
  });

  it('passes through the legacy contract name when it is still supplied', () => {
    process.env.NEXT_PUBLIC_SOROBAN_CONTRACT_ID = CONTRACT_ID;
    process.env.NEXT_PUBLIC_CONTRACT_NAME = 'predinex';

    expect(getRuntimeConfig().contract.name).toBe('predinex');
  });

  it('trims surrounding whitespace from a configured contract id', () => {
    process.env.NEXT_PUBLIC_SOROBAN_CONTRACT_ID = `  ${CONTRACT_ID}  `;

    expect(getRuntimeConfig().contract.address).toBe(CONTRACT_ID);
  });

  it('rejects a contract value that is not a Soroban contract id', () => {
    process.env.NEXT_PUBLIC_SOROBAN_CONTRACT_ID = 'not-a-contract-id';

    expect(() => getRuntimeConfig()).toThrow(/Invalid contract id/i);
  });

  it('degrades to an empty contract id when nothing is configured', () => {
    const cfg = getRuntimeConfig();

    expect(cfg.contract.address).toBe('');
    expect(cfg.soroban.contractId).toBe('');
  });
});
