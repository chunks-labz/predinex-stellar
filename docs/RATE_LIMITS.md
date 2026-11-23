# API Rate Limits

This page describes how the public API limits request rates, which headers it returns, and how clients should retry. It reflects the code in `api/src/middleware/rate-limit.ts` and the route mounts in `api/src/routes/`.

## Limit tiers

| Tier | Applies to | Default limit | Config variable |
|---|---|---|---|
| General | Every route that mounts `rateLimitMiddleware` (app-wide, see `api/src/app.ts`) | 100 requests per 60 s window | `RATE_LIMIT_MAX_REQUESTS` |
| Strict | Specific state-changing or emergency routes that mount `strictRateLimitMiddleware` | 20 requests per 60 s window | `RATE_LIMIT_STRICT_MAX_REQUESTS` |

The window length is shared by both tiers and set with `RATE_LIMIT_WINDOW_MS` (default `60000`). Each variable falls back to its default when it is unset, blank, or not a positive integer.

Examples of strict-tier routes: `POST /api/insurance/quote`, `POST /api/insurance/purchase`, `POST /api/insurance/claim`, `POST /api/markets/admin/archive-resolved`, and the `/api/emergency/*` mutations.

## Scopes: who shares a bucket

- **Registered API key.** A request whose `x-api-key` header is a registered key (see [API Authentication](./API_AUTHENTICATION.md)) has its own bucket, keyed by a SHA-256 prefix of the key. Raw keys are not stored.
- **Everyone else.** Requests without a registered key share a bucket per client IP address. Proxy headers are only trusted when the deployment configures trusted proxy hops; otherwise the socket address is used.

Buckets are kept in process memory. Each API instance counts separately, so a load-balanced deployment allows up to `instances × limit` requests per window.

## Which requests count against write limits

The strict tier is opted in per route, not per HTTP method. A route only counts against the strict limit if it mounts `strictRateLimitMiddleware`.

- Read routes (`GET`) that do not mount the strict middleware use only the general limit.
- Mutating routes that do not mount the strict middleware use only the general limit.
- Strict routes also count against the general limit, because the general middleware runs first for every route.

When you need the current list of strict routes, search the routers for `strictRateLimitMiddleware` rather than relying on this page.

## Response headers

Every response from a rate-limited route includes:

| Header | Meaning |
|---|---|
| `RateLimit-Limit` | Requests allowed in the current window for this tier |
| `RateLimit-Remaining` | Requests left in the current window |
| `RateLimit-Reset` | Whole seconds until the window resets |

A throttled request also gets `Retry-After` (whole seconds, at least `1`).

## Throttled response

When a bucket is exhausted the API returns `429 Too Many Requests`:

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests, please retry later",
    "retryAfter": 42
  },
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

## Retry guidance

1. Read `Retry-After` and wait at least that long before retrying the same request.
2. Do not retry a `429` immediately or in a tight loop. Use exponential backoff with jitter if `Retry-After` is missing.
3. For a `POST`, retry only if the request is safe to repeat. The API supports idempotency keys on routes that use the idempotency middleware (`api/src/middleware/idempotency.ts`).
4. Use `RateLimit-Remaining` to slow down before you hit the limit.

## Related

- [API Authentication](./API_AUTHENTICATION.md) — how registered keys get their own bucket.
- [Environment Variables and Secrets](./ENVIRONMENT_VARIABLES.md) — where the limit variables are set.
