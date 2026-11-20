#!/usr/bin/env node
/**
 * Seed demo markets (and wagers) into a locally deployed Predinex contract
 * (Issue #1438).
 *
 * The script creates a fixed set of `[demo]`-prefixed markets and places one
 * demo wager per market from each configured bettor. It is designed to be
 * re-run safely:
 *
 * - **Idempotent** — markets are matched by title against the pools already
 *   on-chain, and wagers are skipped when `get_user_bet` already has a
 *   position, so re-running never duplicates data.
 * - **Safe against non-local networks** — `mainnet`/`public` is refused
 *   outright, and the network defaults to the local standalone node.
 * - **Prints created IDs** — every created market id and transaction hash is
 *   printed (and repeated in the summary).
 *
 * Usage:
 *   node web/scripts/seed-demo-markets.mjs --contract-id <C...> --source <S...>
 *
 * Run `node web/scripts/seed-demo-markets.mjs --help` for all options, or use
 * the repository-root wrapper: `./scripts/seed-demo-markets.sh --help`.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  nativeToScVal,
  rpc,
  scValToNative,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Demo markets created by the script. Titles are stable and unique: they are
 * the idempotency key used to detect markets seeded by a previous run.
 */
export const DEMO_MARKETS = [
  {
    key: 'btc-150k',
    title: '[demo] Will BTC close above $150k this year?',
    description: 'Seeded demo market — replace or settle freely.',
    outcomeA: 'Yes',
    outcomeB: 'No',
    durationSeconds: 30 * 86_400,
  },
  {
    key: 'eth-etf',
    title: '[demo] Will an ETH spot ETF launch before December?',
    description: 'Seeded demo market — replace or settle freely.',
    outcomeA: 'Yes',
    outcomeB: 'No',
    durationSeconds: 45 * 86_400,
  },
  {
    key: 'stellar-tps',
    title: '[demo] Will Stellar exceed 10,000 TPS in a public benchmark?',
    description: 'Seeded demo market — replace or settle freely.',
    outcomeA: 'Yes',
    outcomeB: 'No',
    durationSeconds: 60 * 86_400,
  },
  {
    key: 'ai-regulation',
    title: '[demo] Will the EU pass new AI regulation this year?',
    description: 'Seeded demo market — replace or settle freely.',
    outcomeA: 'Yes',
    outcomeB: 'No',
    durationSeconds: 21 * 86_400,
  },
  {
    key: 'wc-penalties',
    title: '[demo] Will the next World Cup final go to penalties?',
    description: 'Seeded demo market — replace or settle freely.',
    outcomeA: 'Yes',
    outcomeB: 'No',
    durationSeconds: 90 * 86_400,
  },
];

/** Default creator deposit per market, in stroops (contract minimum). */
export const DEMO_DEPOSIT_STROOPS = 10_000_000n;

/** Default wager size per market and bettor, in stroops (0.5 XLM). */
export const DEMO_BET_STROOPS = 5_000_000n;

/** Network presets. `mainnet` is intentionally absent: seeding is refused. */
export const NETWORK_PRESETS = {
  local: {
    rpcUrl: 'http://localhost:8000/soroban/rpc',
    networkPassphrase: 'Standalone Network ; February 2017',
    friendbotUrl: 'http://localhost:8000/friendbot',
  },
  standalone: {
    rpcUrl: 'http://localhost:8000/soroban/rpc',
    networkPassphrase: 'Standalone Network ; February 2017',
    friendbotUrl: 'http://localhost:8000/friendbot',
  },
  testnet: {
    rpcUrl: 'https://soroban-testnet.stellar.org',
    networkPassphrase: Networks.TESTNET,
    friendbotUrl: Networks.FRIENDBOT_URL,
  },
};

const PRODUCTION_NETWORKS = new Set(['mainnet', 'public', 'pubnet']);
const PRODUCTION_HINT = /mainnet|pubnet|horizon\.stellar\.org/i;

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested without a network)
// ---------------------------------------------------------------------------

export class SeedConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SeedConfigError';
  }
}

/**
 * Resolve the target network, refusing production.
 *
 * @throws {SeedConfigError} when the network is mainnet/public, when the
 *   passphrase or RPC URL points at production, or when no RPC endpoint can
 *   be determined.
 */
export function resolveNetwork(options = {}) {
  const requested = String(options.network ?? 'local').toLowerCase();
  if (PRODUCTION_NETWORKS.has(requested)) {
    throw new SeedConfigError(
      `Refusing to seed demo data against production ('${requested}'). ` +
        'Use --network local or --network testnet.'
    );
  }

  const preset = NETWORK_PRESETS[requested];
  const rpcUrl = options.rpcUrl ?? preset?.rpcUrl;
  const networkPassphrase = options.passphrase ?? preset?.networkPassphrase;

  if (!rpcUrl) {
    throw new SeedConfigError(
      `Unknown network '${requested}': pass --rpc-url and --passphrase, or use ` +
        '--network local / --network testnet.'
    );
  }
  if (!networkPassphrase) {
    throw new SeedConfigError(
      `Unknown network '${requested}': pass --passphrase alongside --rpc-url.`
    );
  }
  if (networkPassphrase === Networks.PUBLIC || PRODUCTION_HINT.test(rpcUrl)) {
    throw new SeedConfigError(
      'Refusing to seed demo data against production (the network passphrase ' +
        'or RPC URL points at mainnet).'
    );
  }

  return {
    name: requested,
    rpcUrl,
    networkPassphrase,
    friendbotUrl: options.friendbotUrl ?? preset?.friendbotUrl,
  };
}

/**
 * Parse CLI arguments (with environment fallbacks). Throws on unknown
 * options and options missing their value.
 */
export function parseArgs(argv, env = process.env) {
  const options = {
    network: env.PREDINEX_SEED_NETWORK ?? 'local',
    rpcUrl: env.PREDINEX_SOROBAN_RPC_URL ?? env.SOROBAN_RPC_URL,
    passphrase: env.PREDINEX_NETWORK_PASSPHRASE,
    contractId: env.PREDINEX_CONTRACT_ID ?? env.CONTRACT_ID ?? env.NEXT_PUBLIC_SOROBAN_CONTRACT_ID,
    sourceSecret: env.PREDINEX_SEED_SOURCE_SECRET ?? env.SOROBAN_SECRET_KEY,
    bettorSecrets: [],
    friendbotUrl: env.PREDINEX_FRIENDBOT_URL,
    useFriendbot: true,
    betAmountStroops: env.PREDINEX_SEED_BET_AMOUNT
      ? BigInt(env.PREDINEX_SEED_BET_AMOUNT)
      : DEMO_BET_STROOPS,
    depositStroops: env.PREDINEX_SEED_DEPOSIT
      ? BigInt(env.PREDINEX_SEED_DEPOSIT)
      : DEMO_DEPOSIT_STROOPS,
    skipWagers: false,
    dryRun: false,
    help: false,
  };

  const readValue = (flag, index) => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new SeedConfigError(`${flag} requires a value`);
    }
    return value;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--network':
        options.network = readValue(arg, i);
        i += 1;
        break;
      case '--rpc-url':
        options.rpcUrl = readValue(arg, i);
        i += 1;
        break;
      case '--passphrase':
        options.passphrase = readValue(arg, i);
        i += 1;
        break;
      case '--contract-id':
        options.contractId = readValue(arg, i);
        i += 1;
        break;
      case '--source':
        options.sourceSecret = readValue(arg, i);
        i += 1;
        break;
      case '--source-identity': {
        options.sourceSecret = readIdentitySecret(readValue(arg, i), env);
        i += 1;
        break;
      }
      case '--bettor':
        options.bettorSecrets.push(readValue(arg, i));
        i += 1;
        break;
      case '--bet-amount':
        options.betAmountStroops = BigInt(readValue(arg, i));
        i += 1;
        break;
      case '--deposit':
        options.depositStroops = BigInt(readValue(arg, i));
        i += 1;
        break;
      case '--friendbot-url':
        options.friendbotUrl = readValue(arg, i);
        i += 1;
        break;
      case '--no-friendbot':
        options.useFriendbot = false;
        break;
      case '--skip-wagers':
        options.skipWagers = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new SeedConfigError(`Unknown option: ${arg}`);
    }
  }

  if (options.bettorSecrets.length === 0 && env.PREDINEX_SEED_BETTORS) {
    options.bettorSecrets = env.PREDINEX_SEED_BETTORS.split(',')
      .map((secret) => secret.trim())
      .filter(Boolean);
  }

  return options;
}

/**
 * Read a Stellar CLI identity secret from `~/.config/stellar/identity/<name>.toml`
 * (or `$STELLAR_CONFIG_DIR`), so contributors can pass `--source-identity alice`
 * instead of exporting a secret.
 */
export function readIdentitySecret(name, env = process.env, fs = { readFileSync }) {
  const configDir =
    env.STELLAR_CONFIG_DIR ?? path.join(homedir(), '.config', 'stellar');
  const file = path.join(configDir, 'identity', `${name}.toml`);
  let contents;
  try {
    contents = fs.readFileSync(file, 'utf8');
  } catch {
    throw new SeedConfigError(
      `Could not read Stellar identity '${name}' at ${file}. ` +
        'Pass --source <secret> instead.'
    );
  }
  const match = contents.match(/secret_key\s*=\s*"([^"]+)"/);
  if (!match) {
    throw new SeedConfigError(
      `Identity '${name}' at ${file} has no secret_key entry.`
    );
  }
  return match[1];
}

/** Normalize a decoded contract status (`'Open'`, `{ tag }`, `['Open']`). */
export function decodePoolStatus(status) {
  if (typeof status === 'string') return status;
  if (Array.isArray(status) && status.length > 0) return String(status[0]);
  if (status && typeof status === 'object' && 'tag' in status) return String(status.tag);
  return 'Unknown';
}

const TERMINAL_STATUSES = new Set(['Cancelled', 'Voided']);

/**
 * Pick the pool that represents a fixture: the newest title match whose
 * status is not terminal. Terminal matches are only reused when nothing else
 * exists (so a cancelled demo market does not leave a dangling title).
 */
export function selectPoolForFixture(pools, fixture) {
  const matches = pools.filter((pool) => pool.title === fixture.title);
  if (matches.length === 0) return null;
  const usable = matches.filter((pool) => !TERMINAL_STATUSES.has(pool.status));
  const candidates = usable.length > 0 ? usable : matches;
  return [...candidates].sort((a, b) => b.poolId - a.poolId)[0];
}

/**
 * Compute the market-seeding plan: which fixtures already exist on-chain and
 * which need to be created. Pure, so it is unit-tested directly.
 */
export function planMarketSeeding(pools, fixtures = DEMO_MARKETS) {
  return fixtures.map((fixture) => {
    const existing = selectPoolForFixture(pools, fixture);
    return {
      fixture,
      action: existing ? 'reuse' : 'create',
      poolId: existing ? existing.poolId : null,
    };
  });
}

// ---------------------------------------------------------------------------
// RPC helpers
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createServer(rpcUrl) {
  return new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith('http://') });
}

async function simulateRead(server, networkPassphrase, contractId, sourcePublicKey, method, ...args) {
  const contract = new Contract(contractId);
  const tx = new TransactionBuilder(new Account(sourcePublicKey, '0'), {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(0)
    .build();

  const simulation = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(`${method} simulation failed: ${simulation.error}`);
  }
  if (!simulation.result || simulation.result.retval === undefined) return null;
  return scValToNative(simulation.result.retval);
}

async function submitInvocation(server, networkPassphrase, contractId, keypair, method, ...args) {
  const contract = new Contract(contractId);
  const account = await server.getAccount(keypair.publicKey());
  let tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const simulation = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(`${method} simulation failed: ${simulation.error}`);
  }
  tx = rpc.assembleTransaction(tx, simulation).build();
  tx.sign(keypair);

  const sent = await server.sendTransaction(tx);
  if (sent.status === 'ERROR') {
    throw new Error(`${method} submission failed: ${JSON.stringify(sent.errorResult)}`);
  }

  const confirmed = await waitForTransaction(server, sent.hash);
  if (confirmed.status !== 'SUCCESS') {
    throw new Error(`${method} failed on-chain with status ${confirmed.status}`);
  }

  const returnValue = confirmed.returnValue === undefined
    ? null
    : scValToNative(confirmed.returnValue);
  return { hash: sent.hash, returnValue, response: confirmed };
}

async function waitForTransaction(server, hash, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await server.getTransaction(hash);
    if (result.status !== 'NOT_FOUND') return result;
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for transaction ${hash}`);
}

async function readPools(server, networkPassphrase, contractId, sourcePublicKey) {
  const count = Number(
    (await simulateRead(server, networkPassphrase, contractId, sourcePublicKey, 'get_pool_count')) ?? 0
  );
  if (count === 0) return [];

  const pools = [];
  const chunkSize = 50;
  for (let start = 1; start <= count; start += chunkSize) {
    const size = Math.min(chunkSize, count - start + 1);
    const batch = await simulateRead(
      server,
      networkPassphrase,
      contractId,
      sourcePublicKey,
      'get_pools_batch',
      nativeToScVal(start, { type: 'u32' }),
      nativeToScVal(size, { type: 'u32' })
    );
    (batch ?? []).forEach((raw, index) => {
      if (!raw) return;
      pools.push({
        poolId: start + index,
        title: raw.title ?? '',
        status: decodePoolStatus(raw.status),
      });
    });
  }
  return pools;
}

async function readUserBet(server, networkPassphrase, contractId, sourcePublicKey, poolId, address) {
  const bet = await simulateRead(
    server,
    networkPassphrase,
    contractId,
    sourcePublicKey,
    'get_user_bet',
    nativeToScVal(poolId, { type: 'u32' }),
    new Address(address).toScVal()
  );
  return bet ?? null;
}

async function fundWithFriendbot(friendbotUrl, address) {
  const url = `${friendbotUrl.replace(/\/$/, '')}?addr=${encodeURIComponent(address)}`;
  const response = await fetch(url);
  return response.ok;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printUsage() {
  console.log(`Seed demo markets and wagers into a Predinex contract (issue #1438).

Usage:
  node web/scripts/seed-demo-markets.mjs [options]

Options:
  --network <local|standalone|testnet>  Target network (default: local).
                                        mainnet/public is always refused.
  --rpc-url <url>                       Soroban RPC endpoint (default depends on --network)
  --passphrase <value>                  Network passphrase (default depends on --network)
  --contract-id <C...>                  Predinex contract id (required)
  --source <S...>                       Creator secret key (required)
  --source-identity <name>              Read the secret from a Stellar CLI identity
  --bettor <S...>                       Bettor secret key (repeatable; default: one
                                        generated, friendbot-funded account)
  --bet-amount <stroops>                Wager size per market (default ${DEMO_BET_STROOPS})
  --deposit <stroops>                   Creator deposit per market (default ${DEMO_DEPOSIT_STROOPS})
  --friendbot-url <url>                 Friendbot base URL for auto-funding bettors
  --no-friendbot                        Never call friendbot
  --skip-wagers                         Only seed markets
  --dry-run                             Print the seed plan without submitting
  --help                                Show this help

Environment fallbacks:
  PREDINEX_SEED_NETWORK, PREDINEX_SOROBAN_RPC_URL, PREDINEX_NETWORK_PASSPHRASE,
  PREDINEX_CONTRACT_ID / CONTRACT_ID, PREDINEX_SEED_SOURCE_SECRET /
  SOROBAN_SECRET_KEY, PREDINEX_SEED_BETTORS (comma-separated),
  PREDINEX_SEED_BET_AMOUNT, PREDINEX_SEED_DEPOSIT, PREDINEX_FRIENDBOT_URL

Examples:
  # Local standalone node (stellar container start), source from a CLI identity
  node web/scripts/seed-demo-markets.mjs \\
    --contract-id C... --source-identity alice

  # Testnet, two explicit bettors
  node web/scripts/seed-demo-markets.mjs --network testnet \\
    --contract-id C... --source S... --bettor S... --bettor S...
`);
}

async function resolveBettors(options) {
  if (options.skipWagers) return [];
  if (options.bettorSecrets.length > 0) {
    return options.bettorSecrets.map((secret) => ({
      keypair: Keypair.fromSecret(secret),
      generated: false,
    }));
  }
  return [{ keypair: Keypair.random(), generated: true }];
}

async function ensureFunded(server, bettor, options) {
  try {
    await server.getAccount(bettor.keypair.publicKey());
    return true;
  } catch {
    // Account does not exist yet; try friendbot below.
  }

  if (options.useFriendbot && options.friendbotUrl) {
    try {
      if (await fundWithFriendbot(options.friendbotUrl, bettor.keypair.publicKey())) {
        console.log(`  funded bettor ${bettor.keypair.publicKey()}`);
        return true;
      }
    } catch (error) {
      console.warn(`  friendbot request failed: ${error.message}`);
    }
  }

  if (bettor.generated) {
    console.warn(
      `  generated bettor ${bettor.keypair.publicKey()} is unfunded; ` +
        `fund it (or pass --bettor <secret>) and re-run to seed wagers.`
    );
  } else {
    console.warn(`  bettor ${bettor.keypair.publicKey()} is unfunded; skipping its wagers.`);
  }
  return false;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printUsage();
    return;
  }

  if (!options.contractId) {
    throw new SeedConfigError(
      'Missing contract id. Pass --contract-id <C...> or set PREDINEX_CONTRACT_ID.'
    );
  }
  if (!options.sourceSecret) {
    throw new SeedConfigError(
      'Missing source secret. Pass --source <S...> (or --source-identity <name>), ' +
        'or set PREDINEX_SEED_SOURCE_SECRET.'
    );
  }

  const network = resolveNetwork(options);
  const source = Keypair.fromSecret(options.sourceSecret);
  const server = createServer(network.rpcUrl);

  console.log(`Predinex demo seed — ${network.name} (${network.rpcUrl})`);
  console.log(`  contract: ${options.contractId}`);
  console.log(`  source:   ${source.publicKey()}`);

  // Fail fast with a clear message when the creator account is not funded.
  try {
    await server.getAccount(source.publicKey());
  } catch {
    throw new Error(
      `Source account ${source.publicKey()} was not found on ${network.name}. ` +
        `Fund it first (e.g. stellar keys fund / friendbot ${network.friendbotUrl ?? ''}).`
    );
  }

  const existingPools = await readPools(
    server,
    network.networkPassphrase,
    options.contractId,
    source.publicKey()
  );
  const plan = planMarketSeeding(existingPools);

  const bettors = await resolveBettors(options);
  const usableBettors = [];
  for (const bettor of bettors) {
    if (await ensureFunded(server, bettor, options)) usableBettors.push(bettor);
  }

  console.log(
    `\nPlan: ${plan.filter((item) => item.action === 'create').length} market(s) to create, ` +
      `${plan.filter((item) => item.action === 'reuse').length} to reuse, ` +
      `${usableBettors.length} bettor(s).`
  );
  for (const item of plan) {
    const suffix = item.poolId ? ` (pool ${item.poolId})` : '';
    console.log(`  ${item.action === 'create' ? '+' : '='} ${item.fixture.title}${suffix}`);
  }

  if (options.dryRun) {
    console.log('\nDry run: no transactions submitted.');
    return;
  }

  const createdMarketIds = [];
  const poolIdByFixtureKey = new Map();
  for (const item of plan) {
    if (item.action === 'reuse') {
      poolIdByFixtureKey.set(item.fixture.key, item.poolId);
      continue;
    }
    const { hash, returnValue } = await submitInvocation(
      server,
      network.networkPassphrase,
      options.contractId,
      source,
      'create_pool',
      new Address(source.publicKey()).toScVal(),
      nativeToScVal(item.fixture.title, { type: 'string' }),
      nativeToScVal(item.fixture.description, { type: 'string' }),
      nativeToScVal(item.fixture.outcomeA, { type: 'string' }),
      nativeToScVal(item.fixture.outcomeB, { type: 'string' }),
      nativeToScVal(item.fixture.durationSeconds, { type: 'u64' }),
      nativeToScVal(options.depositStroops, { type: 'i128' }),
      xdr.ScVal.scvVoid()
    );
    const poolId = Number(returnValue);
    poolIdByFixtureKey.set(item.fixture.key, poolId);
    createdMarketIds.push({ poolId, title: item.fixture.title, hash });
    console.log(`  + created market ${poolId}: ${item.fixture.title} (tx ${hash})`);
  }

  const wagerResults = [];
  const failures = [];
  for (const item of plan) {
    const poolId = poolIdByFixtureKey.get(item.fixture.key);
    if (!poolId) continue;
    for (const [bettorIndex, bettor] of usableBettors.entries()) {
      const address = bettor.keypair.publicKey();
      try {
        const existingBet = await readUserBet(
          server,
          network.networkPassphrase,
          options.contractId,
          source.publicKey(),
          poolId,
          address
        );
        if (existingBet && BigInt(existingBet.total_bet ?? 0) > 0n) {
          wagerResults.push({ poolId, address, action: 'skip' });
          console.log(`  = wager by ${address} on ${poolId} already exists (skipped)`);
          continue;
        }

        const outcome = bettorIndex % 2;
        const { hash } = await submitInvocation(
          server,
          network.networkPassphrase,
          options.contractId,
          bettor.keypair,
          'place_bet',
          new Address(address).toScVal(),
          nativeToScVal(poolId, { type: 'u32' }),
          nativeToScVal(outcome, { type: 'u32' }),
          nativeToScVal(options.betAmountStroops, { type: 'i128' }),
          xdr.ScVal.scvVoid()
        );
        wagerResults.push({ poolId, address, action: 'placed', hash });
        console.log(
          `  + wager ${options.betAmountStroops} stroops on ${poolId} ` +
            `outcome ${outcome === 0 ? 'A' : 'B'} by ${address} (tx ${hash})`
        );
      } catch (error) {
        failures.push(`wager on market ${poolId} by ${address}: ${error.message}`);
        console.warn(`  ! wager on market ${poolId} by ${address} failed: ${error.message}`);
      }
    }
  }

  const placed = wagerResults.filter((entry) => entry.action === 'placed').length;
  const skipped = wagerResults.filter((entry) => entry.action === 'skip').length;

  console.log('\nSummary');
  console.log(`  markets created: ${createdMarketIds.length}`);
  for (const market of createdMarketIds) {
    console.log(`    - pool ${market.poolId}: ${market.title} (tx ${market.hash})`);
  }
  console.log(`  markets reused:  ${plan.filter((item) => item.action === 'reuse').length}`);
  console.log(`  wagers placed:   ${placed}`);
  console.log(`  wagers skipped:  ${skipped}`);
  if (failures.length > 0) {
    console.log(`  failures:        ${failures.length}`);
    for (const failure of failures) console.log(`    - ${failure}`);
    process.exitCode = 1;
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`\n✖ Seed failed: ${error.message}`);
    process.exitCode = 1;
  });
}
