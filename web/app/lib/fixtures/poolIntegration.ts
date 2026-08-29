/**
 * Fixtures for PoolIntegration component.
 *
 * The PoolIntegration component fetches live data from the Soroban blockchain.
 * This file is retained for test compatibility and provides
 * a single source-of-truth re-export of the `Pool` type alongside an empty
 * mock list.
 */

import type { Pool } from '../market-types';

export type { Pool };

/**
 * Empty mock pools array.
 * The component uses live blockchain data; this is kept for tests that need
 * to import a ready-made empty baseline.
 */
export const mockPools: Pool[] = [];
