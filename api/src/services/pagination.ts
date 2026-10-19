/**
 * Offset/limit pagination helpers (Issue #1420).
 * page/pageSize helpers (Issue #1445).
 *
 * `parsePagination` validates raw query values; `buildPageMeta` produces the
 * metadata block returned alongside every paginated list response.
 *
 * `parsePagePagination` validates `page` / `pageSize` query values and
 * translates them to the internal `offset` / `limit` representation so all
 * downstream code stays unchanged.  `pageSize` values above `MAX_PAGE_LIMIT`
 * are *clamped* (not rejected) to keep the endpoint usable for callers who
 * pass a large value to mean "give me everything".
 */

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

export interface PageParams {
  limit: number;
  offset: number;
  /**
   * 1-based page number derived from `page`/`pageSize` query params.
   * Undefined when the caller used `limit`/`offset` directly.
   */
  page?: number;
  /**
   * Effective page size requested via `pageSize` query param (after clamping).
   * Undefined when the caller used `limit`/`offset` directly.
   */
  pageSize?: number;
}

export interface PageMeta {
  /** Total number of items across all pages. */
  total: number;
  /** Effective page size (after capping at MAX_PAGE_LIMIT). */
  limit: number;
  /** Zero-based index of the first item on this page. */
  offset: number;
  /** Number of items actually returned on this page. */
  count: number;
  /** True when another page exists after this one. */
  hasMore: boolean;
  /** Offset for the next page, or null on the last (or an out-of-range) page. */
  nextOffset: number | null;
  /** Offset for the previous page, or null on the first page. */
  prevOffset: number | null;
  /**
   * 1-based current page number.  Present when the request used `page`/`pageSize`
   * params; also back-computed from `offset`/`limit` so it is always included
   * in the response for convenience.
   */
  page: number;
  /**
   * Effective page size used for this response.  Mirrors `limit` but uses the
   * name callers using `page`/`pageSize` expect.
   */
  pageSize: number;
}

export type PaginationResult =
  | { ok: true; params: PageParams }
  | { ok: false; errors: string[] };

function parseNonNegativeInt(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Validates `limit` and `offset` query values.
 *
 * - Both are optional; defaults are `limit = DEFAULT_PAGE_LIMIT`, `offset = 0`.
 * - Both must be base-10 non-negative integers; `limit` must be at least 1.
 * - A `limit` above `MAX_PAGE_LIMIT` is capped rather than rejected so
 *   clients asking for "everything" still get a bounded response.
 */
export function parsePagination(
  query: Record<string, unknown>,
  defaults: { limit?: number; maxLimit?: number } = {}
): PaginationResult {
  const defaultLimit = defaults.limit ?? DEFAULT_PAGE_LIMIT;
  const maxLimit = defaults.maxLimit ?? MAX_PAGE_LIMIT;
  const errors: string[] = [];

  let limit = defaultLimit;
  if (query.limit !== undefined) {
    const parsed = parseNonNegativeInt(query.limit);
    if (parsed === null || parsed < 1) {
      errors.push('limit must be a positive integer');
    } else {
      limit = Math.min(parsed, maxLimit);
    }
  }

  let offset = 0;
  if (query.offset !== undefined) {
    const parsed = parseNonNegativeInt(query.offset);
    if (parsed === null) {
      errors.push('offset must be a non-negative integer');
    } else {
      offset = parsed;
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, params: { limit, offset } };
}

export function buildPageMeta(total: number, params: PageParams, count: number): PageMeta {
  const { limit, offset } = params;
  const end = offset + count;
  const hasMore = end < total;
  // Compute 1-based page number: floor((offset / limit) + 1), clamped to >= 1.
  const page = limit > 0 ? Math.floor(offset / limit) + 1 : 1;
  return {
    total,
    limit,
    offset,
    count,
    hasMore,
    nextOffset: hasMore ? end : null,
    prevOffset: offset > 0 ? Math.max(0, Math.min(offset, total) - limit) : null,
    page,
    pageSize: limit,
  };
}

// ---------------------------------------------------------------------------
// page / pageSize helpers (Issue #1445)
// ---------------------------------------------------------------------------

/**
 * Validates `page` and `pageSize` query values and translates them to the
 * internal `offset` / `limit` representation.
 *
 * Rules:
 *  - `page`     defaults to 1; must be a positive integer (≥ 1).
 *  - `pageSize` defaults to `DEFAULT_PAGE_LIMIT`; must be a positive integer.
 *              Values above `MAX_PAGE_LIMIT` are **clamped** rather than
 *              rejected so callers asking for "everything" still get a
 *              bounded, valid response.
 */
export function parsePagePagination(
  query: Record<string, unknown>,
  defaults: { pageSize?: number; maxPageSize?: number } = {}
): PaginationResult {
  const defaultPageSize = defaults.pageSize ?? DEFAULT_PAGE_LIMIT;
  const maxPageSize = defaults.maxPageSize ?? MAX_PAGE_LIMIT;
  const errors: string[] = [];

  let pageSize = defaultPageSize;
  if (query.pageSize !== undefined) {
    const parsed = parseNonNegativeInt(query.pageSize);
    if (parsed === null || parsed < 1) {
      errors.push('pageSize must be a positive integer');
    } else {
      // Clamp — never reject — so oversized values are handled gracefully.
      pageSize = Math.min(parsed, maxPageSize);
    }
  }

  let page = 1;
  if (query.page !== undefined) {
    const parsed = parseNonNegativeInt(query.page);
    if (parsed === null || parsed < 1) {
      errors.push('page must be a positive integer (≥ 1)');
    } else {
      page = parsed;
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const offset = (page - 1) * pageSize;
  return {
    ok: true,
    params: { limit: pageSize, offset, page, pageSize },
  };
}
