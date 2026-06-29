/**
 * @deprecated This module is deprecated and maintained for backward compatibility only.
 *
 * The Stacks/Hiro API integration is being phased out in favor of Soroban-native reads.
 * For new code, please use:
 * - `soroban-read-api.ts` for contract reads (getPool, getUserBet, getPoolCount)
 * - `soroban-event-service.ts` for user activity
 * - `predinex-read-api.ts` as the canonical adapter interface
 *
 * This file will be removed in a future release.
 */
import { STACKS_MAINNET, STACKS_TESTNET, StacksNetwork } from "@stacks/network";
import { fetchCallReadOnlyFunction, cvToValue, uintCV, principalCV, ClarityValue } from "@stacks/transactions";
import { createScopedLogger } from '@/app/lib/logger';
const log = createScopedLogger('stacks-api');
import { getRuntimeConfig } from "./runtime-config";
import { getPoolCountFromSoroban, getPoolsBatchFromSoroban } from "./soroban-read-api";

function getStacksNetwork(): StacksNetwork {
    const cfg = getRuntimeConfig();
    return cfg.network === 'testnet' ? STACKS_TESTNET : STACKS_MAINNET;
}

/**
 * Normalized prediction-market pool data shared across Stacks and Soroban read layers.
 *
 * @deprecated Prefer {@link Pool} types re-exported from `soroban-read-api.ts` for new Soroban code.
 */
export interface Pool {
    id: number;
    title: string;
    description: string;
    creator: string;
    outcomeA: string;
    outcomeB: string;
    totalA: number;
    totalB: number;
    /**
     * Per-pool bet minimum in raw token units (stroops).
     * When absent (legacy pools / older deployments), the UI falls back to defaults.
     */
    minBet?: number;
    /**
     * Per-pool bet maximum in raw token units (stroops).
     * A value of `0` may be treated as "no maximum" by the frontend.
     */
    maxBet?: number;
    settled: boolean;
    winningOutcome: number | undefined;
    expiry: number;
    status: 'active' | 'settled' | 'expired';
    /**
     * Number of unique participants who have bet in this pool.
     */
    participant_count?: number;
}

/**
 * Fetches the total number of pools via a Stacks Clarity read-only call to `get-pool-count`.
 *
 * @deprecated Use {@link getPoolCountFromSoroban} from `soroban-read-api.ts` instead.
 * @returns Total pool count, or `0` on RPC or parsing failure.
 */
export async function getPoolCount(): Promise<number> {
    try {
        const cfg = getRuntimeConfig();
        const network: StacksNetwork = getStacksNetwork();
        const result = await fetchCallReadOnlyFunction({
            contractAddress: cfg.contract.address,
            contractName: cfg.contract.name,
            functionName: 'get_pool_count',
            functionArgs: [],
            senderAddress: cfg.contract.address,
            network,
        });

        const value = cvToValue(result);
        return Number(value);
    } catch (e) {
        log.error("Failed to fetch pool count", e);
        return 0;
    }
}

/**
 * Fetches a single pool by ID via a Stacks Clarity read-only call to `get-pool`.
 *
 * @deprecated Use {@link soroban-read-api!getPoolFromSoroban} from `soroban-read-api.ts` instead.
 * @param poolId - Numeric pool identifier (1-based in the Predinex contract).
 * @returns Normalized pool data, or `null` if the pool does not exist or the read fails.
 */
export async function getPool(poolId: number): Promise<Pool | null> {
    try {
        const cfg = getRuntimeConfig();
        const network: StacksNetwork = getStacksNetwork();
        const result = await fetchCallReadOnlyFunction({
            contractAddress: cfg.contract.address,
            contractName: cfg.contract.name,
            functionName: 'get_pool',
            functionArgs: [uintCV(poolId)],
            senderAddress: cfg.contract.address,
            network,
        });

        const value = cvToValue(result, true); // true for readable format
        if (!value) return null;

        // Handle (some {...}) vs (none)
        // cvToValue with readable=true returns null for none, object for some
        return {
            id: poolId,
            title: value.title,
            description: value.description,
            creator: value.creator,
            outcomeA: value['outcome-a-name'],
            outcomeB: value['outcome-b-name'],
            totalA: Number(value['total-a']),
            totalB: Number(value['total-b']),
            settled: value.settled,
            winningOutcome: value['winning-outcome'] ?? undefined,
            expiry: Number(value.expiry ?? 0),
            status: value.settled ? 'settled' : 'active',
        };
    } catch (e) {
        log.error(`Failed to fetch pool ${poolId}`, e);
        return null;
    }
}

/**
 * Lists pools with optional settlement filtering.
 *
 * Internally delegates batch reads to Soroban (`getPoolCountFromSoroban`, `getPoolsBatchFromSoroban`)
 * rather than per-pool Stacks Clarity calls.
 *
 * @param filter - Which pools to include: `'active'`, `'settled'`, or `'all'` (default `'all'`).
 * @returns Array of matching pools; empty when count is unavailable or no pools match.
 *
 * @example
 * ```ts
 * const openMarkets = await getMarkets('active');
 * const allMarkets = await getMarkets();
 * ```
 */
export async function getMarkets(filter: 'active' | 'settled' | 'all' = 'all'): Promise<Pool[]> {
    const count = await getPoolCountFromSoroban();
    if (count === 0) return [];

    const rawPools = await getPoolsBatchFromSoroban(1, count);
    const pools: Pool[] = [];

    for (const pool of rawPools) {
        if (pool) {
            if (filter === 'active' && pool.settled) continue;
            if (filter === 'settled' && !pool.settled) continue;
            pools.push(pool);
        }
    }
    return pools;
}

/**
 * Convenience wrapper around {@link getMarkets} that returns only unsettled pools.
 *
 * @returns Active (non-settled) pools, or an empty array on failure.
 */
export async function fetchActivePools(): Promise<Pool[]> {
    try {
        return await getMarkets('active');
    } catch (e) {
        log.error('Failed to fetch active pools', e);
        return [];
    }
}

/**
 * Fetches aggregate betting volume via a Stacks Clarity read-only call to `get-total-volume`.
 *
 * @deprecated No Soroban equivalent is exposed here; prefer contract-specific reads in `soroban-read-api.ts`.
 * @returns Total volume in raw token units (stroops), or `0` on failure.
 */
export async function getTotalVolume(): Promise<number> {
    try {
        const cfg = getRuntimeConfig();
        const network = getStacksNetwork();
        const result = await fetchCallReadOnlyFunction({
            contractAddress: cfg.contract.address,
            contractName: cfg.contract.name,
            functionName: 'get-total-volume',
            functionArgs: [],
            senderAddress: cfg.contract.address,
            network,
        });

        const value = cvToValue(result);
        return Number(value);
    } catch (e) {
        log.error("Error fetching total volume:", e);
        return 0;
    }
}

/**
 * A user's stake split across both outcomes for a single pool.
 */
export interface UserBetData {
    /** Amount wagered on outcome A in raw token units (stroops). */
    amountA: number;
    /** Amount wagered on outcome B in raw token units (stroops). */
    amountB: number;
    /** Combined stake (`amountA + amountB`) in raw token units (stroops). */
    totalBet: number;
}

/**
 * Fetches a user's bet for a pool via a Stacks Clarity read-only call to `get-user-bet`.
 *
 * @deprecated Use {@link soroban-read-api!getUserBetFromSoroban} from `soroban-read-api.ts` instead.
 * @param poolId - Numeric pool identifier.
 * @param userAddress - Stacks principal address (e.g. `SP...`).
 * @returns Bet breakdown per outcome, or `null` if the user has no bet or the read fails.
 */
export async function getUserBet(poolId: number, userAddress: string): Promise<UserBetData | null> {
    try {
        const cfg = getRuntimeConfig();
        const network: StacksNetwork = getStacksNetwork();
        const result = await fetchCallReadOnlyFunction({
            contractAddress: cfg.contract.address,
            contractName: cfg.contract.name,
            functionName: 'get_user_bet',
            functionArgs: [uintCV(poolId), principalCV(userAddress)],
            senderAddress: cfg.contract.address,
            network,
        });

        const value = cvToValue(result, true) as Record<string, unknown> | null;
        if (!value) return null;

        const toNumber = (raw: unknown): number => {
            if (typeof raw === 'number') return raw;
            if (typeof raw === 'string') return Number(raw);
            if (typeof raw === 'bigint') return Number(raw);
            return Number.NaN;
        };

        return {
            amountA: toNumber((value['amount-a'] as { value?: unknown } | undefined)?.value ?? value['amount-a']),
            amountB: toNumber((value['amount-b'] as { value?: unknown } | undefined)?.value ?? value['amount-b']),
            totalBet: toNumber((value['total-bet'] as { value?: unknown } | undefined)?.value ?? value['total-bet']),
        };
    } catch (e) {
        log.error(`Failed to fetch user bet for pool ${poolId}`, e);
        return null;
    }
}

// --- Activity Feed ---

/**
 * Parsed on-chain contract event payload attached to a user activity item.
 */
export interface ActivityEvent {
    /** High-level event category derived from contract print events. */
    type: 'bet' | 'pool-creation' | 'settlement' | 'claim';
    /** Pool ID referenced by the event, when applicable. */
    poolId?: number;
    /** Human-readable pool title (pool-creation events only). */
    poolTitle?: string;
    /** Bet or claim amount in raw token units (stroops), when applicable. */
    amount?: number;
    /** Outcome index (0 = A, 1 = B) for bet events. */
    outcome?: number;
    /** Winnings claimed in raw token units (stroops), for claim events. */
    winnerAmount?: number;
}

/**
 * A single user-facing activity row built from a Stacks transaction.
 */
export interface ActivityItem {
    /** Stacks transaction ID (hex). */
    txId: string;
    /** UI-oriented activity classification. */
    type: 'bet-placed' | 'winnings-claimed' | 'pool-created' | 'contract-call';
    /** Clarity function name invoked in the contract call. */
    functionName: string;
    /** Unix timestamp (seconds) from `burn_block_time`, or current time as fallback. */
    timestamp: number;
    /** Transaction execution status mapped from Stacks `tx_status`. */
    status: 'success' | 'pending' | 'failed';
    /** Bet or claim amount in raw token units (stroops), when extractable. */
    amount?: number;
    /** Pool ID from event data or function arguments. */
    poolId?: number;
    /** Pool title from event data, when available. */
    poolTitle?: string;
    /** Full explorer URL for the transaction. */
    explorerUrl: string;
    /** Richer event payload parsed from contract print events, when present. */
    event?: ActivityEvent;
}

type StacksFunctionArg = {
    name?: string;
    repr?: string;
};

type StacksContractCall = {
    contract_id?: string;
    function_name?: string;
    function_args?: StacksFunctionArg[];
};

type StacksSmartContractEvent = {
    type?: string;
    smart_contract_event?: {
        event_name?: string;
        event_data?: Record<string, unknown>;
    };
};

type StacksTransaction = {
    tx_id: string;
    tx_status?: string;
    burn_block_time?: number;
    contract_call?: StacksContractCall;
    events?: StacksSmartContractEvent[];
};

type StacksAddressTransactionsResponse = {
    results?: StacksTransaction[];
};

function isStacksTransaction(value: unknown): value is StacksTransaction {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    return typeof record.tx_id === 'string';
}

function parseOptionalNumber(raw: unknown): number | undefined {
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'string') {
        const n = Number(raw);
        return Number.isFinite(n) ? n : undefined;
    }
    return undefined;
}

function parseOptionalString(raw: unknown): string | undefined {
    if (typeof raw === 'string' && raw.length > 0) return raw;
    return undefined;
}

function parseContractEvents(tx: StacksTransaction): ActivityEvent | undefined {
    const events = tx.events ?? [];
    
    for (const event of events) {
        if (event.type === 'smart_contract_event') {
            const eventData = event.smart_contract_event;
            const eventName = eventData?.event_name;
            
            if (eventName === 'bet-placed') {
                const parsed = eventData?.event_data ?? {};
                return {
                    type: 'bet',
                    poolId: parseOptionalNumber(parsed.pool_id),
                    amount: parseOptionalNumber(parsed.amount),
                    outcome: parseOptionalNumber(parsed.outcome),
                };
            }
            
            if (eventName === 'pool-created') {
                const parsed = eventData?.event_data ?? {};
                return {
                    type: 'pool-creation',
                    poolId: parseOptionalNumber(parsed.pool_id),
                    poolTitle: parseOptionalString(parsed.title),
                };
            }
            
            if (eventName === 'pool-settled') {
                const parsed = eventData?.event_data ?? {};
                return {
                    type: 'settlement',
                    poolId: parseOptionalNumber(parsed.pool_id),
                    outcome: parseOptionalNumber(parsed.winning_outcome),
                };
            }
            
            if (eventName === 'winnings-claimed') {
                const parsed = eventData?.event_data ?? {};
                return {
                    type: 'claim',
                    poolId: parseOptionalNumber(parsed.pool_id),
                    winnerAmount: parseOptionalNumber(parsed.amount),
                };
            }
        }
    }
    
    return undefined;
}

function parseUintRepr(repr: string): number | undefined {
    // Expected: strings like "u1000000" from Clarity uints
    const normalized = repr.startsWith('u') ? repr.slice(1) : repr;
    const n = Number(normalized);
    return Number.isFinite(n) ? n : undefined;
}

function extractPoolInfo(args: StacksFunctionArg[]): { amount?: number; poolId?: number } {
    let amount: number | undefined;
    let poolId: number | undefined;

    for (const arg of args) {
        if (arg.name === 'amount' && arg.repr) {
            amount = parseUintRepr(arg.repr);
        }
        if (arg.name === 'pool-id' && arg.repr) {
            poolId = parseUintRepr(arg.repr);
        }
    }
    
    return { amount, poolId };
}

/**
 * Injectable configuration for {@link getUserActivity}, enabling test isolation.
 *
 * @deprecated User activity is migrating to `soroban-event-service.ts` for Soroban deployments.
 */
export interface ActivityConfig {
    /** Base URL for the Stacks API, e.g. `https://api.testnet.hiro.so`. */
    apiBaseUrl: string;
    /** Explorer base URL used to build transaction links. */
    explorerUrl: string;
    /** Contract address used to filter Predinex transactions. */
    contractAddress: string;
}

/**
 * Fetches recent on-chain activity for a user by querying the Hiro Stacks API
 * for contract-call transactions targeting the Predinex contract.
 *
 * Enriches each row with contract print events and function-argument parsing when available.
 *
 * @deprecated Use `soroban-event-service.ts` for Soroban-native activity feeds.
 * @param userAddress - Stacks principal to query.
 * @param limit - Maximum number of transactions to fetch (default `20`).
 * @param config - Optional injectable config; falls back to `getRuntimeConfig()` when omitted.
 * @returns Chronologically mapped activity items; empty array on API or network failure.
 *
 * @example
 * ```ts
 * const activity = await getUserActivity('SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKQZML1T', 10);
 * const testActivity = await getUserActivity('SP...', 5, {
 *   apiBaseUrl: 'https://api.testnet.hiro.so',
 *   explorerUrl: 'https://explorer.hiro.so',
 *   contractAddress: 'SP...',
 * });
 * ```
 */
export async function getUserActivity(
    userAddress: string,
    limit: number = 20,
    config?: Partial<ActivityConfig>
): Promise<ActivityItem[]> {
    try {
        // Use injected config when provided (enables test isolation), otherwise fall back to runtime config
        let explorerBase: string;
        let apiBaseUrl: string;
        let contractAddress: string;

        if (config && config.apiBaseUrl && config.contractAddress) {
            // Guard: if explorerUrl is missing/empty, bail out early
            if (!config.explorerUrl) return [];
            explorerBase = config.explorerUrl;
            apiBaseUrl = config.apiBaseUrl;
            contractAddress = config.contractAddress;
        } else {
            const cfg = getRuntimeConfig();
            explorerBase = cfg.api.explorerUrl;
            apiBaseUrl = cfg.api.coreApiUrl;
            contractAddress = cfg.contract.address;
        }

        const url = `${apiBaseUrl}/extended/v1/address/${userAddress}/transactions?limit=${limit}&type=contract_call`;
        const response = await fetch(url);

        if (!response.ok) {
            log.error(`Stacks API error: ${response.status}`);
            return [];
        }

        const data: unknown = await response.json();
        const dataRecord = (data && typeof data === 'object' ? (data as Record<string, unknown>) : {}) as Record<
            string,
            unknown
        >;
        const maybeResults = dataRecord['results'];
        const results = Array.isArray(maybeResults) ? maybeResults.filter(isStacksTransaction) : [];

        const predinexTxs = results.filter((tx) => {
            const callInfo = tx.contract_call;
            return typeof callInfo?.contract_id === 'string' && callInfo.contract_id.includes(contractAddress);
        });

        return predinexTxs.map((tx): ActivityItem => {
            const callInfo = tx.contract_call;
            const fnName: string = callInfo?.function_name || 'unknown';

            let type: ActivityItem['type'] = 'contract-call';
            if (fnName === 'place_bet') type = 'bet-placed';
            else if (fnName === 'claim_winnings') type = 'winnings-claimed';
            else if (fnName === 'create_pool') type = 'pool-created';

            let status: ActivityItem['status'] = 'pending';
            if (tx.tx_status === 'success') status = 'success';
            else if (tx.tx_status === 'abort_by_response' || tx.tx_status === 'abort_by_post_condition') status = 'failed';

            // Parse contract events for richer data
            const event = parseContractEvents(tx);

            // Extract amount from function args if available
            const args: StacksFunctionArg[] = callInfo?.function_args ?? [];
            const { amount, poolId } = extractPoolInfo(args);

            return {
                txId: tx.tx_id,
                type,
                functionName: fnName,
                timestamp: tx.burn_block_time ?? Math.floor(Date.now() / 1000),
                status,
                amount: event?.amount || event?.winnerAmount || amount,
                poolId: event?.poolId || poolId,
                poolTitle: event?.poolTitle,
                explorerUrl: `${explorerBase}/txid/${tx.tx_id}`,
                event,
            };
        });
    } catch (e) {
        log.error('Failed to fetch user activity', e);
        return [];
    }
}
