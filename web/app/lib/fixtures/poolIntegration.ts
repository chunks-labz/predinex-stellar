/**
 * Fixtures for PoolIntegration component.
 *
 * The PoolIntegration component fetches live data from the Stacks blockchain
 * via `stacks-api.ts`. This file is retained for test compatibility and provides
 * a single source-of-truth re-export of the `Pool` type alongside an empty
 * mock list.
 *
 * Do NOT duplicate the Pool interface here — import it from stacks-api instead
 * so both stay in sync automatically.
 */

import type { Pool } from '../stacks-api';

export type { Pool };

/**
 * Empty mock pools array.
 * The component uses live blockchain data; this is kept for tests that need
 * to import a ready-made empty baseline.
 */
export const mockPools: Pool[] = [];
