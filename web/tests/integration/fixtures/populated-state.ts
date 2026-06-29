/**
 * Populated-state fixtures — deterministic data for a fully active market.
 * All IDs, amounts, and addresses are fake but structurally valid.
 */

import type { Pool } from '../../../app/lib/stacks-api';
import type { UserBetData } from '../../../app/lib/soroban-read-api';

export const TEST_CONTRACT_ID = 'CTEST_PREDINEX_CONTRACT_ADDRESS_123456789012345678901234';
export const TEST_USER_ADDRESS = 'GBTEST_USER_ADDRESS_00000000000000000000000000000000000';
export const TEST_SETTLER_ADDRESS = 'GBTEST_SETTLER_ADDRESS_0000000000000000000000000000000';

export const ACTIVE_POOL = {
  id: 1,
  creator: TEST_USER_ADDRESS,
  title: 'Will ETH close above $4 000 on 1 Jul 2026?',
  description: 'Settlement based on CoinGecko 00:00 UTC closing price.',
  outcomeA: 'Yes',
  outcomeB: 'No',
  totalA: 500_000_000,
  totalB: 300_000_000,
  settled: false,
  winningOutcome: undefined,
  expiry: Math.floor(Date.now() / 1000) + 3600,
  status: 'active',
} as unknown as Pool;

export const SETTLED_POOL = {
  ...ACTIVE_POOL,
  id: 2,
  settled: true,
  winningOutcome: 0,
  status: 'settled',
} as unknown as Pool;

export const EXPIRED_UNSETTLED_POOL = {
  ...ACTIVE_POOL,
  id: 3,
  settled: false,
  expiry: Math.floor(Date.now() / 1000) - 3600,
  status: 'expired',
} as unknown as Pool;

export const POPULATED_MARKETS: Pool[] = [ACTIVE_POOL, SETTLED_POOL, EXPIRED_UNSETTLED_POOL];

/** The test user has bet on outcome A of pool #1. */
export const USER_BET_ON_ACTIVE_POOL: UserBetData = {
  amountA: 50_000_000,
  amountB: 0,
  totalBet: 50_000_000,
};

/** The test user won pool #2 (outcome A was the winner). */
export const USER_BET_ON_SETTLED_POOL: UserBetData = {
  amountA: 100_000_000,
  amountB: 0,
  totalBet: 100_000_000,
};

export const USER_BETS = [USER_BET_ON_ACTIVE_POOL, USER_BET_ON_SETTLED_POOL];

/** Mock Soroban RPC response for a successful place_bet invocation. */
export const PLACE_BET_SUCCESS_RPC = {
  result: {
    status: 'SUCCESS',
    returnValue: { type: 'bool', value: true },
    latestLedger: 10001,
  },
};

/** Mock Soroban RPC response for a successful settle_pool invocation. */
export const SETTLE_POOL_SUCCESS_RPC = {
  result: {
    status: 'SUCCESS',
    returnValue: { type: 'void' },
    latestLedger: 10050,
  },
};

/** Mock Soroban RPC response for a successful claim_winnings invocation. */
export const CLAIM_WINNINGS_SUCCESS_RPC = {
  result: {
    status: 'SUCCESS',
    returnValue: { type: 'i128', value: '145000000' }, // ~14.5 XLM net payout
    latestLedger: 10100,
  },
};

/** Mock Soroban RPC 400 error — wallet rejection (user cancelled). */
export const WALLET_REJECTED_ERROR = {
  code: -32000,
  message: 'User rejected the request',
};

/** Mock Soroban RPC error — insufficient balance. */
export const INSUFFICIENT_BALANCE_ERROR = {
  code: -32002,
  message: 'account balance insufficient',
};

/** Mock network error — Horizon/RPC unreachable. */
export const NETWORK_ERROR = new Error('Failed to fetch');
