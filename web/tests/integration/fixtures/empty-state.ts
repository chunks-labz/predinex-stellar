/**
 * Empty-state fixtures — used when no pools exist yet.
 * These shapes match the real contract response types so
 * tests are deterministic without hitting the Stellar network.
 */

import type { Pool } from '../../../app/lib/stacks-api';
import type { UserBetData } from '../../../app/lib/soroban-read-api';
import type { SorobanRpcEvent } from '../../helpers/mock-surfaces';

export const EMPTY_MARKETS: Pool[] = [];

export const EMPTY_USER_BETS: UserBetData[] = [];

export const EMPTY_SOROBAN_EVENTS: SorobanRpcEvent[] = [];

/** RPC response wrapper for an empty events page. */
export const EMPTY_SOROBAN_EVENTS_RPC = {
  result: { events: EMPTY_SOROBAN_EVENTS },
};

/** Disconnected wallet state — no public key. */
export const DISCONNECTED_WALLET = {
  publicKey: null as null,
  connected: false,
  network: 'testnet' as const,
};

/** A valid connected wallet with zero balance. */
export const CONNECTED_WALLET_ZERO_BALANCE = {
  publicKey: 'GBUSER_ZERO_BALANCE_TEST_ADDRESS_000000000000000000000000000',
  connected: true,
  network: 'testnet' as const,
};