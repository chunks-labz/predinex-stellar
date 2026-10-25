/**
 * #1438 — Demo-data seed CLI.
 *
 * The network resolution, argument parsing, identity lookup and idempotency
 * planning are pure and covered here; the RPC/submission paths are exercised
 * manually against a local network (`--dry-run` first).
 */
import { describe, expect, it } from 'vitest';
import { Networks } from '@stellar/stellar-sdk';
import {
  DEMO_MARKETS,
  NETWORK_PRESETS,
  parseArgs,
  planMarketSeeding,
  decodePoolStatus,
  readIdentitySecret,
  resolveNetwork,
  SeedConfigError,
  selectPoolForFixture,
} from '../../scripts/seed-demo-markets.mjs';

describe('resolveNetwork (#1438)', () => {
  it('defaults to the local standalone network', () => {
    const network = resolveNetwork({});
    expect(network.name).toBe('local');
    expect(network.rpcUrl).toBe(NETWORK_PRESETS.local.rpcUrl);
    expect(network.networkPassphrase).toBe('Standalone Network ; February 2017');
  });

  it('supports the testnet preset', () => {
    const network = resolveNetwork({ network: 'testnet' });
    expect(network.rpcUrl).toBe('https://soroban-testnet.stellar.org');
    expect(network.networkPassphrase).toBe(Networks.TESTNET);
  });

  it('refuses to seed against production', () => {
    expect(() => resolveNetwork({ network: 'mainnet' })).toThrow(SeedConfigError);
    expect(() => resolveNetwork({ network: 'public' })).toThrow(/Refusing to seed/);
    expect(() => resolveNetwork({ network: 'MAINNET' })).toThrow(/production/);
  });

  it('refuses a production passphrase or RPC URL even under another network name', () => {
    expect(() =>
      resolveNetwork({ network: 'local', passphrase: Networks.PUBLIC })
    ).toThrow(/production/);
    expect(() =>
      resolveNetwork({
        network: 'local',
        rpcUrl: 'https://horizon.stellar.org',
        passphrase: 'Custom',
      })
    ).toThrow(/production/);
    expect(() =>
      resolveNetwork({
        network: 'local',
        rpcUrl: 'http://rpc.mainnet.example',
        passphrase: 'Custom',
      })
    ).toThrow(/production/);
  });

  it('accepts a custom network when the RPC URL and passphrase are supplied', () => {
    const network = resolveNetwork({
      network: 'custom',
      rpcUrl: 'http://localhost:9999/rpc',
      passphrase: 'My Dev Network ; Testing',
    });
    expect(network.rpcUrl).toBe('http://localhost:9999/rpc');
    expect(network.networkPassphrase).toBe('My Dev Network ; Testing');
  });

  it('rejects unknown networks without coordinates', () => {
    expect(() => resolveNetwork({ network: 'custom' })).toThrow(/Unknown network/);
  });
});

describe('parseArgs (#1438)', () => {
  it('falls back to environment variables', () => {
    const options = parseArgs([], {
      PREDINEX_SEED_NETWORK: 'testnet',
      PREDINEX_CONTRACT_ID: 'CABC',
      PREDINEX_SEED_SOURCE_SECRET: 'SSOURCE',
      PREDINEX_SEED_BETTORS: 'SBET1,SBET2',
      PREDINEX_SEED_BET_AMOUNT: '2500000',
    });

    expect(options.network).toBe('testnet');
    expect(options.contractId).toBe('CABC');
    expect(options.sourceSecret).toBe('SSOURCE');
    expect(options.bettorSecrets).toEqual(['SBET1', 'SBET2']);
    expect(options.betAmountStroops).toBe(2_500_000n);
  });

  it('parses flags and repeatable bettor secrets', () => {
    const options = parseArgs([
      '--network',
      'testnet',
      '--contract-id',
      'CCONTRACT',
      '--source',
      'SSOURCE',
      '--bettor',
      'SB1',
      '--bettor',
      'SB2',
      '--bet-amount',
      '1000',
      '--deposit',
      '10000000',
      '--skip-wagers',
      '--dry-run',
      '--no-friendbot',
    ]);

    expect(options).toMatchObject({
      network: 'testnet',
      contractId: 'CCONTRACT',
      sourceSecret: 'SSOURCE',
      bettorSecrets: ['SB1', 'SB2'],
      skipWagers: true,
      dryRun: true,
      useFriendbot: false,
    });
    expect(options.betAmountStroops).toBe(1_000n);
    expect(options.depositStroops).toBe(10_000_000n);
  });

  it('rejects unknown options and missing values', () => {
    expect(() => parseArgs(['--wat'])).toThrow(/Unknown option/);
    expect(() => parseArgs(['--source'])).toThrow(/requires a value/);
    expect(() => parseArgs(['--network', '--dry-run'])).toThrow(/requires a value/);
  });
});

describe('readIdentitySecret (#1438)', () => {
  it('reads the secret_key entry from a Stellar CLI identity file', () => {
    const secret = readIdentitySecret(
      'alice',
      { STELLAR_CONFIG_DIR: '/tmp/stellar' },
      { readFileSync: () => 'name = "alice"\nsecret_key = "SSECRET"\n' }
    );
    expect(secret).toBe('SSECRET');
  });

  it('fails with guidance when the identity is missing or malformed', () => {
    expect(() =>
      readIdentitySecret('missing', {}, {
        readFileSync: () => {
          throw new Error('ENOENT');
        },
      })
    ).toThrow(/Could not read Stellar identity/);

    expect(() =>
      readIdentitySecret('bob', {}, { readFileSync: () => 'name = "bob"\n' })
    ).toThrow(/no secret_key/);
  });
});

describe('decodePoolStatus (#1438)', () => {
  it('normalizes the shapes scValToNative can produce', () => {
    expect(decodePoolStatus('Open')).toBe('Open');
    expect(decodePoolStatus(['Open'])).toBe('Open');
    expect(decodePoolStatus({ tag: 'Cancelled', values: [] })).toBe('Cancelled');
    expect(decodePoolStatus(undefined)).toBe('Unknown');
  });
});

describe('idempotency planning (#1438)', () => {
  const fixture = DEMO_MARKETS[0];

  it('plans creation for every fixture on an empty contract', () => {
    const plan = planMarketSeeding([], DEMO_MARKETS);
    expect(plan).toHaveLength(DEMO_MARKETS.length);
    expect(plan.every((item) => item.action === 'create' && item.poolId === null)).toBe(true);
  });

  it('reuses the newest usable pool with a matching title', () => {
    const pools = [
      { poolId: 2, title: fixture.title, status: 'Open' },
      { poolId: 9, title: fixture.title, status: 'Open' },
      { poolId: 3, title: fixture.title, status: 'Frozen' },
      { poolId: 1, title: 'Unrelated market', status: 'Open' },
    ];
    expect(selectPoolForFixture(pools, fixture)).toEqual({
      poolId: 9,
      title: fixture.title,
      status: 'Open',
    });
  });

  it('skips cancelled/voided pools when a live match exists', () => {
    const pools = [
      { poolId: 7, title: fixture.title, status: 'Cancelled' },
      { poolId: 4, title: fixture.title, status: 'Open' },
    ];
    expect(selectPoolForFixture(pools, fixture)?.poolId).toBe(4);
  });

  it('falls back to the newest terminal pool when nothing usable remains', () => {
    const pools = [
      { poolId: 7, title: fixture.title, status: 'Cancelled' },
      { poolId: 8, title: fixture.title, status: 'Voided' },
    ];
    expect(selectPoolForFixture(pools, fixture)?.poolId).toBe(8);
  });

  it('returns null when no pool matches the fixture title', () => {
    expect(selectPoolForFixture([{ poolId: 1, title: 'Other', status: 'Open' }], fixture)).toBeNull();
  });

  it('applies the plan per fixture, preserving order', () => {
    const pools = [
      { poolId: 11, title: DEMO_MARKETS[1].title, status: 'Open' },
      { poolId: 12, title: DEMO_MARKETS[3].title, status: 'Open' },
    ];
    const plan = planMarketSeeding(pools);
    expect(plan.map((item) => [item.fixture.key, item.action, item.poolId])).toEqual([
      ['btc-150k', 'create', null],
      ['eth-etf', 'reuse', 11],
      ['stellar-tps', 'create', null],
      ['ai-regulation', 'reuse', 12],
      ['wc-penalties', 'create', null],
    ]);
  });
});

describe('demo fixtures (#1438)', () => {
  it('have unique, [demo]-prefixed titles and positive durations', () => {
    const titles = DEMO_MARKETS.map((market) => market.title);
    expect(new Set(titles).size).toBe(titles.length);
    for (const market of DEMO_MARKETS) {
      expect(market.title.startsWith('[demo]')).toBe(true);
      expect(market.durationSeconds).toBeGreaterThan(0);
      expect(market.outcomeA).not.toBe(market.outcomeB);
    }
  });
});
