/**
 * Market list query parsing (Issues #1436, #1437).
 *
 * `parseMarketListQuery` validates the `status`, `sort` and `order` query
 * values of `GET /api/markets`. Statuses may be supplied as a comma-separated
 * list (`status=open,settled`) and/or repeated parameters
 * (`status=open&status=settled`); the parsed query is applied by the market
 * source after its cancelled-market visibility rules, so callers can combine
 * a status filter with pagination and sorting.
 */

/** Lifecycle status of a market record. */
export type MarketStatus = 'open' | 'settled' | 'voided' | 'cancelled' | 'archived';

/** Every status accepted by the `status` query parameter. */
export const MARKET_STATUSES: readonly MarketStatus[] = [
  'open',
  'settled',
  'voided',
  'cancelled',
  'archived',
];

/** Fields the market list can be sorted by. */
export const MARKET_SORT_FIELDS = ['id', 'expiry', 'volume', 'title'] as const;
export type MarketSortField = (typeof MARKET_SORT_FIELDS)[number];

export type SortOrder = 'asc' | 'desc';

export interface MarketListQuery {
  /**
   * Statuses to include. `undefined` means "all non-cancelled statuses", so
   * the default listing never exposes soft-deleted markets.
   */
  statuses?: MarketStatus[];
  /** Sort field; defaults to `id`. */
  sortBy: MarketSortField;
  /** Sort direction; defaults to `asc`. */
  order: SortOrder;
}

export type MarketListQueryResult =
  | { ok: true; params: MarketListQuery }
  | { ok: false; errors: string[] };

const DEFAULT_SORT: MarketSortField = 'id';
const DEFAULT_ORDER: SortOrder = 'asc';

function collectValues(raw: unknown): string[] | null {
  if (typeof raw === 'string') return [raw];
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === 'string');
  return null;
}

/** Parse the `status` parameter into a de-duplicated list of known statuses. */
function parseStatuses(raw: unknown, errors: string[]): MarketStatus[] | undefined {
  if (raw === undefined) return undefined;

  const values = collectValues(raw);
  if (values === null) {
    errors.push('status must be a string or an array of strings');
    return undefined;
  }

  const statuses: MarketStatus[] = [];
  for (const value of values) {
    for (const part of value.split(',')) {
      const candidate = part.trim().toLowerCase();
      if (candidate.length === 0) {
        errors.push('status must not contain empty values');
        continue;
      }
      if (!MARKET_STATUSES.includes(candidate as MarketStatus)) {
        errors.push(
          `status must be one of: ${MARKET_STATUSES.join(', ')} (got "${part.trim()}")`
        );
        continue;
      }
      const status = candidate as MarketStatus;
      if (!statuses.includes(status)) statuses.push(status);
    }
  }

  return statuses;
}

function parseSort(raw: unknown, errors: string[]): MarketSortField {
  if (raw === undefined) return DEFAULT_SORT;

  const values = collectValues(raw);
  if (values === null || values.length !== 1) {
    errors.push('sort must be a single value');
    return DEFAULT_SORT;
  }

  const candidate = values[0].trim().toLowerCase();
  if (!MARKET_SORT_FIELDS.includes(candidate as MarketSortField)) {
    errors.push(
      `sort must be one of: ${MARKET_SORT_FIELDS.join(', ')} (got "${values[0]}")`
    );
    return DEFAULT_SORT;
  }
  return candidate as MarketSortField;
}

function parseOrder(raw: unknown, errors: string[]): SortOrder {
  if (raw === undefined) return DEFAULT_ORDER;

  const values = collectValues(raw);
  if (values === null || values.length !== 1) {
    errors.push('order must be a single value');
    return DEFAULT_ORDER;
  }

  const candidate = values[0].trim().toLowerCase();
  if (candidate !== 'asc' && candidate !== 'desc') {
    errors.push(`order must be one of: asc, desc (got "${values[0]}")`);
    return DEFAULT_ORDER;
  }
  return candidate;
}

/**
 * Validates the market list query parameters.
 *
 * - `status` accepts one or more statuses (comma-separated and/or repeated)
 *   and is validated against {@link MARKET_STATUSES}.
 * - `sort` accepts `id` (default), `expiry`, `volume` or `title`.
 * - `order` accepts `asc` (default) or `desc`.
 *
 * Every invalid value is reported so a caller can fix the whole query at
 * once. When validation fails the defaults are returned alongside the errors;
 * callers must not use the parameters unless `ok` is true.
 */
export function parseMarketListQuery(query: Record<string, unknown>): MarketListQueryResult {
  const errors: string[] = [];

  const statuses = parseStatuses(query.status, errors);
  const sortBy = parseSort(query.sort, errors);
  const order = parseOrder(query.order, errors);

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, params: { statuses, sortBy, order } };
}
