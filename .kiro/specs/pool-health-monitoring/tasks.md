# Implementation Plan: Pool Health Monitoring

## Overview

Implement a continuous server-side monitoring system for Predinex prediction market pools. The system runs as an in-process singleton inside the existing Next.js application, polling Soroban RPC on a configurable interval, classifying pool health states, evaluating four alert rules, delivering signed webhook notifications, persisting alert history, and exposing a `/monitoring` dashboard page with three supporting API routes.

All new code lives under `web/app/lib/monitoring/`, `web/app/api/health/`, `web/app/monitoring/`, and `web/tests/lib/monitoring/`. Existing utilities (`webhook-service.ts` HMAC pattern, `retry.ts` `withRetry()`, `logger.ts` `createScopedLogger()`, `soroban-read-api.ts`, `soroban-event-service.ts`, `runtime-config.ts`) are reused throughout.

---

## Tasks

- [ ] 1. Define shared types and monitoring configuration
  - [ ] 1.1 Create `web/app/lib/monitoring/types.ts` with all shared types
    - Export `HealthState` union type (7 values: `active`, `expired`, `stuck`, `frozen`, `voided`, `settled`, `scheduled`)
    - Export `AlertSeverity` (`'critical' | 'warning'`) and `AlertRuleName` union
    - Export `PoolMetric`, `PoolHealthEntry`, `AlertRecord`, and all four `*Payload` interfaces (`SettlementOverduePayload`, `TvlDropPayload`, `HighErrorRatePayload`, `OraclePriceDeviationPayload`)
    - Export `AlertPayload` discriminated union and `MonitoringConfig` interface
    - Use `bigint` for `tvl_stroops`, `cumulative_volume_stroops`, `recent_tx_volume_stroops`, and `previous_tvl_stroops`/`current_tvl_stroops` in payloads
    - _Requirements: 1.2, 2.3, 3.1, 4.2, 5.2, 6.2, 7.2, 8.2, 10.2_

  - [ ] 1.2 Create `web/app/lib/monitoring/config.ts` with `getMonitoringConfig()`
    - Implement `parseIntEnv(name, default, min, max)` and `parseFloatEnv(name, default, min, max)` helpers that log invalid values via `createScopedLogger('monitoring:config')` and fall back to defaults
    - Implement `parseUrlList(name)` that splits a comma-separated env var into a `string[]`, filtering empty strings
    - Implement `getMonitoringConfig(): MonitoringConfig` reading all 9 env vars listed in Requirement 10.2 with the documented defaults and valid ranges
    - _Requirements: 10.1, 10.2, 10.3_

- [ ] 2. Implement `pool-classifier.ts` and its property tests
  - [ ] 2.1 Create `web/app/lib/monitoring/pool-classifier.ts`
    - Implement `classifyPoolHealthState(status: string, expiry: number, nowSecs: number, gracePeriodSecs: number): HealthState` as a pure function with no side effects
    - Handle all seven contract statuses: `Open`, `Settled`, `Voided`, `Cancelled`, `Frozen`, `Disputed`, `Scheduled`; unknown statuses default to `active`
    - For `Open` pools: return `active` when `nowSecs < expiry`, `expired` when `expiry <= nowSecs < expiry + gracePeriodSecs`, `stuck` when `nowSecs >= expiry + gracePeriodSecs`
    - _Requirements: 3.1, 3.2, 3.3_

  - [ ]* 2.2 Write property tests for `pool-classifier` in `web/tests/lib/monitoring/pool-classifier.test.ts`
    - **Property 6: Health state classification is total and valid** — `fc.constantFrom('Open','Settled','Voided','Frozen','Disputed','Scheduled','Cancelled','Unknown')` × `fc.integer` × `fc.integer` × `fc.nat(86400)` → result is always one of the 7 valid `HealthState` values; `numRuns: 100`
    - **Property 7: Expired and stuck classification boundaries** — generate Open pools with `fc.tuple(fc.nat(), fc.nat(1, 86400))` for `(expiry, grace)` and three `now` regions; assert `active`/`expired`/`stuck` boundaries hold exactly
    - Include concrete example tests for each of the 7 health states for documentation clarity
    - **Validates: Requirements 3.1, 3.2, 3.3**

- [ ] 3. Implement `error-rate-tracker.ts` and its property tests
  - [ ] 3.1 Create `web/app/lib/monitoring/error-rate-tracker.ts`
    - Export `TxOutcome` interface (`{ timestamp: number; success: boolean }`)
    - Implement `ErrorRateTracker` class with `private windows = new Map<number, TxOutcome[]>()` and `windowSecs = 3600`
    - Implement `record(poolId: number, outcome: TxOutcome): void` — appends to the pool's window array
    - Implement `getErrorRate(poolId: number, nowSecs?: number): number` — prunes events older than `windowSecs`, computes `Math.round((failed / total) * 10000) / 100`, returns `0.00` when total is 0
    - Implement `ingestEvents(poolId: number, events: DecodedSorobanEvent[]): void` — maps Soroban events to `TxOutcome` records using the event type field to determine success/failure
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [ ]* 3.2 Write property tests for `error-rate-tracker` in `web/tests/lib/monitoring/error-rate-tracker.test.ts`
    - **Property 8: Rolling window excludes stale events** — generate events with timestamps spanning > 1 hour; verify `getErrorRate()` only counts events within the window; `numRuns: 100`
    - **Property 9: Error rate formula correctness** — `fc.tuple(fc.nat(), fc.nat({ min: 1, max: 10000 }))` for `(failed, total)` where `failed <= total`; verify formula `Math.round((failed/total)*10000)/100`; verify zero-transaction case returns `0.00`
    - **Validates: Requirements 4.1, 4.2, 4.3**

- [ ] 4. Implement `alert-store.ts` and its property tests
  - [ ] 4.1 Create `web/app/lib/monitoring/alert-store.ts`
    - Implement `AlertStore` class with `private buffer: AlertRecord[] = []`, `private maxSize = 1000`, and `private logPath: string`
    - Implement `add(alert: AlertRecord): void` — appends to buffer, evicts oldest entry when `buffer.length > maxSize`, calls `appendToFile` if `logPath` is set
    - Implement `query(opts: { limit?: number; poolId?: number; rule?: AlertRuleName }): AlertRecord[]` — filters by `poolId` and/or `rule`, returns the most recent `limit` entries (default 50) in reverse chronological order
    - Implement `private appendToFile(alert: AlertRecord): void` — uses `fs.appendFileSync` with NDJSON format; catches and logs errors without throwing; serialize `bigint` fields as strings
    - Use `createScopedLogger('monitoring:alert-store')` for error logging
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

  - [ ]* 4.2 Write property tests for `alert-store` in `web/tests/lib/monitoring/alert-store.test.ts`
    - **Property 21: Ring buffer eviction** — add N > 1000 alerts; verify exactly 1000 remain and they are the N most recently added; `numRuns: 50`
    - **Property 22: NDJSON round-trip** — generate `AlertRecord` with `fc.record(...)` including bigint fields; serialize to JSON string and parse back; verify all fields preserved (bigint fields round-trip as strings)
    - **Property 23: Query limit is respected** — `fc.integer({ min: 1, max: 500 })` for limit; verify `query({ limit: n }).length <= n`
    - **Property 24: pool_id filter correctness** — generate alerts with mixed pool IDs; filter by one; verify all returned alerts have matching `pool_id`
    - **Property 25: rule filter correctness** — generate alerts with mixed rules; filter by one; verify all returned alerts have matching `rule`
    - **Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5**

- [ ] 5. Implement `notification-service.ts` and its property tests
  - [ ] 5.1 Create `web/app/lib/monitoring/notification-service.ts`
    - Implement `NotificationService` class using `createScopedLogger('monitoring:notification')`
    - Implement `private async sign(body: string, secret: string): Promise<string>` using SubtleCrypto HMAC-SHA256 (same pattern as `webhook-service.ts`'s `generateSignature`), returning the hex digest
    - Implement `private formatSlackMessage(alert: AlertRecord): string` returning Slack Block Kit JSON with a `section` block (mrkdwn text with rule name and pool title), a `context` block (pool ID + `fired_at`), and a color attachment (`danger` for `critical`, `warning` for `warning`)
    - Implement `private async deliverToUrl(alert: AlertRecord, url: string, secret: string): Promise<void>` — detects Slack URLs via `url.includes('hooks.slack.com')`, builds body accordingly, calls `withRetry` with `maxAttempts: 4`, `baseDelayMs: 5000`, `backoffFactor: 2`, `maxDelayMs: 40000`; sets `X-Predinex-Signature: sha256=<hmac>` and `X-Predinex-Alert-Rule: <rule>` headers; throws on non-2xx; logs final failure with rule, pool ID, status, and timestamp
    - Implement `async deliver(alert: AlertRecord, config: MonitoringConfig): Promise<void>` — maps `config.webhookUrls` to `deliverToUrl` calls and awaits `Promise.allSettled`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_

  - [ ]* 5.2 Write property tests for `notification-service` in `web/tests/lib/monitoring/notification-service.test.ts`
    - **Property 16: HMAC signature correctness** — `fc.tuple(fc.string(), fc.string({ minLength: 1, maxLength: 64 }))` for `(payload, secret)`; verify `X-Predinex-Signature` equals `sha256=<expected-hmac>`; `numRuns: 100`
    - **Property 17: Alert rule header matches alert rule** — generate alerts with any `AlertRuleName`; mock fetch; verify `X-Predinex-Alert-Rule` header equals `alert.rule`
    - **Property 18: Retry on non-2xx** — mock fetch returning non-2xx; verify exactly 4 fetch calls made (1 initial + 3 retries)
    - **Property 19: Independent multi-URL delivery** — `fc.array(fc.webUrl(), { minLength: 2, maxLength: 5 })` with some URLs mocked to fail; verify all URLs receive a POST request
    - **Property 20: Slack Block Kit format** — generate alerts delivered to a `hooks.slack.com` URL; verify request body is valid JSON with a `blocks` array containing at least one block, and includes `alert.rule` and `pool_title` in the text
    - **Validates: Requirements 9.2, 9.3, 9.4, 9.6, 9.8**

- [ ] 6. Checkpoint — core modules complete
  - Ensure all tests pass for `pool-classifier`, `error-rate-tracker`, `alert-store`, and `notification-service`. Ask the user if questions arise.

- [ ] 7. Implement `alert-engine.ts` and its property tests
  - [ ] 7.1 Create `web/app/lib/monitoring/alert-engine.ts`
    - Implement `AlertEngine` class with `private cooldowns = new Map<string, number>()` keyed as `` `${rule}:${poolId}` ``
    - Implement `private isCoolingDown(rule: AlertRuleName, poolId: number, cooldownSecs: number, now: number): boolean` and `private recordFiring(rule: AlertRuleName, poolId: number, now: number): void`
    - Implement `private checkSettlementOverdue(pool, config, now): AlertRecord | null` — fires when `pool.health_state === 'stuck'`; cooldown 3600 s; severity `warning`; payload includes `expiry`, `grace_period_secs`, `overdue_by_secs`
    - Implement `private checkTvlDrop(pool, config, now): AlertRecord | null` — finds the oldest snapshot within `tvlDropWindowSecs` in `pool.tvl_history`; fires when `(prev - curr) / prev * 100 > tvlDropThresholdPct`; cooldown 300 s; severity `critical`
    - Implement `private checkHighErrorRate(pool, config, now): AlertRecord | null` — fires when `pool.latest_metric.error_rate_pct > errorRateThresholdPct`; cooldown 3600 s; severity `warning`
    - Implement `private async checkOraclePriceDeviation(pool, config, now): Promise<AlertRecord | null>` — skips when `config.secondaryOracleUrl` is empty; fetches secondary price with 5-second `AbortController` timeout; skips silently on fetch/parse error; fires when `|primary - secondary| / secondary * 100 > oracleDeviationThresholdPct`; cooldown 900 s; severity `critical`
    - Implement `evaluateAll(pools: PoolHealthEntry[], config: MonitoringConfig, nowSecs?: number): Promise<AlertRecord[]>` — iterates all pools, collects results from all four checks, records cooldowns for fired alerts, returns the full list
    - Generate alert IDs with `crypto.randomUUID()`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.2, 8.3, 8.4, 8.5_

  - [ ]* 7.2 Write property tests for `alert-engine` in `web/tests/lib/monitoring/alert-engine.test.ts`
    - **Property 10: Settlement overdue fires for all stuck pools** — generate `PoolHealthEntry[]` with mixed `health_state` values, no active cooldowns; verify `evaluateAll()` includes exactly one `settlement_overdue` per stuck pool and none for non-stuck pools; `numRuns: 100`
    - **Property 11: Alert payload completeness and severity** — for each rule, generate a triggering pool; verify all required payload fields are present with correct types and `severity` matches the rule's defined value
    - **Property 12: Cooldown prevents re-firing** — `fc.record({ rule: fc.constantFrom(...rules), poolId: fc.nat(), cooldownSecs: fc.nat({ min: 1, max: 86400 }) })`; fire alert at time T; call `evaluateAll` at T + cooldownSecs - 1; verify no second alert for same rule+pool
    - **Property 13: TVL drop alert fires when threshold exceeded** — generate TVL histories with drops above/below threshold; verify alert fires iff `(prev - curr) / prev * 100 > threshold`
    - **Property 14: High error rate alert fires when threshold exceeded** — generate `error_rate_pct` values above/below `errorRateThresholdPct`; verify alert fires iff rate exceeds threshold
    - **Property 15: Oracle deviation alert fires when threshold exceeded** — generate `(primaryPrice, secondaryPrice)` pairs; mock secondary URL fetch; verify alert fires iff `|primary - secondary| / secondary * 100 > threshold`
    - **Validates: Requirements 5.1, 5.4, 6.1, 6.5, 7.1, 7.5, 8.1, 8.5**

- [ ] 8. Implement `health-monitor.ts` singleton
  - [ ] 8.1 Create `web/app/lib/monitoring/health-monitor.ts` with the `HealthMonitor` class
    - Constructor accepts `MonitoringConfig`; initializes `AlertEngine`, `NotificationService`, `AlertStore`, and `ErrorRateTracker` instances
    - Implement `start(): void` — guards against double-start with `this.running` flag; calls `scheduleNextCycle()`
    - Implement `stop(): void` — clears the timer and sets `running = false`
    - Implement `getPoolHealthMap(): ReadonlyMap<number, PoolHealthEntry>` and `getLastCollectedAt(): number | null`
    - Implement `private scheduleNextCycle(): void` using `setTimeout` (not `setInterval`) so the next cycle starts after the previous one completes
    - Implement `private async runCycle(): Promise<void>`:
      1. Fetch pool count via `soroban-read-api.ts`; abort cycle and log on failure
      2. Batch-read all pools; wrap each call with a 5-second `AbortController` timeout; on per-pool error, retain previous `PoolHealthEntry` and log with pool ID
      3. Call `errorRateTracker.ingestEvents()` with events from `soroban-event-service.ts` `getEvents`; on failure, log and continue
      4. For each successfully fetched pool: compute `PoolMetric`, call `classifyPoolHealthState()`, append to `tvl_history` (cap at 100 entries, prune entries older than `tvlDropWindowSecs`), update `poolHealthMap`
      5. Call `alertEngine.evaluateAll()` with current pool entries
      6. For each new alert: call `notificationService.deliver()` and `alertStore.add()`
      7. Update `lastCollectedAt`
    - Export module-level singleton: `const _monitor = new HealthMonitor(getMonitoringConfig()); _monitor.start(); export const monitor = _monitor;`
    - Use `createScopedLogger('monitoring:health-monitor')`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [ ] 8.2 Write unit tests for `health-monitor` in `web/tests/lib/monitoring/health-monitor.test.ts`
    - Test that `start()` is idempotent (calling twice does not create two poll loops)
    - Test that `stop()` prevents further cycles from running
    - Test that a per-pool RPC error retains the previous `PoolHealthEntry` and does not abort the cycle for other pools (validates Property 2)
    - Mock `soroban-read-api.ts` and `soroban-event-service.ts` using `vi.mock`
    - _Requirements: 1.4, 1.6_

- [ ] 9. Implement API routes
  - [ ] 9.1 Create `web/app/api/health/pools/route.ts` — `GET /api/health/pools`
    - Add `export const runtime = 'nodejs'` and `export const dynamic = 'force-dynamic'`
    - Import `monitor` from `health-monitor.ts` (triggers singleton initialization)
    - Return 503 `{ message: "metrics not yet collected" }` when `monitor.getLastCollectedAt()` is null
    - When `?pool_id=<n>` is present: validate it is a valid integer (400 on invalid); look up in `poolHealthMap`; return 404 if not found or `health_state` is `settled`/`voided`; return single-pool `PoolsResponse`
    - Otherwise: filter `poolHealthMap` to entries where `health_state` is not `settled` or `voided`; return full `PoolsResponse`
    - Serialize all `bigint` fields as decimal strings in the JSON response
    - Set `Cache-Control: no-store` on all responses
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.4_

  - [ ] 9.2 Create `web/app/api/health/alerts/route.ts` — `GET /api/health/alerts`
    - Add `export const runtime = 'nodejs'` and `export const dynamic = 'force-dynamic'`
    - Parse `?limit=<n>` (default 50, clamp to [1, 500]); parse optional `?pool_id=<n>` and `?rule=<name>` filters
    - Call `monitor.alertStore.query({ limit, poolId, rule })` (expose `alertStore` as a public getter on `HealthMonitor`)
    - Serialize `bigint` fields as strings; set `Cache-Control: no-store`
    - Return `{ alerts: AlertRecordResponse[], total: number }`
    - _Requirements: 12.3, 12.4, 12.5_

  - [ ] 9.3 Create `web/app/api/health/config/route.ts` — `GET /api/health/config`
    - Add `export const runtime = 'nodejs'` and `export const dynamic = 'force-dynamic'`
    - Call `getMonitoringConfig()`, replace `webhookSecret` with `'[REDACTED]'`, return as JSON
    - Set `Cache-Control: no-store`
    - _Requirements: 10.4_

  - [ ]* 9.4 Write integration tests for API routes in `web/tests/lib/monitoring/api/`
    - `health-pools.test.ts`: mock `monitor` singleton; test 503 on cold start, 200 with correct shape, 404 for unknown pool_id, 400 for invalid pool_id, `Cache-Control: no-store` header, single-pool filter (validates Property 3, Property 4, Property 5)
    - `health-alerts.test.ts`: test default limit 50, `?limit=200`, `?pool_id=X` filter, `?rule=tvl_drop` filter
    - `health-config.test.ts`: verify `webhookSecret` is always `'[REDACTED]'`; verify all other config fields present
    - **Validates: Requirements 2.1–2.7, 10.4, 12.3–12.5**

- [ ] 10. Checkpoint — API layer complete
  - Ensure all tests pass for `health-monitor`, all three API routes, and their integration tests. Ask the user if questions arise.

- [ ] 11. Implement the `/monitoring` dashboard page and components
  - [ ] 11.1 Create the page shell `web/app/monitoring/page.tsx`
    - Export `runtime = 'nodejs'` (not edge-compatible)
    - Render a `<main>` container with heading "Pool Health Monitoring"
    - Wrap `<MonitoringDashboard />` in `<Suspense fallback={<DashboardSkeleton />}>`
    - `DashboardSkeleton` renders placeholder `Skeleton` components matching the dashboard layout
    - _Requirements: 11.1, 11.8_

  - [ ] 11.2 Create `web/app/monitoring/components/MonitoringDashboard.tsx` (client component)
    - Mark `'use client'`
    - Use `useQuery` from `@tanstack/react-query` with `queryKey: ['health', 'pools']`, `queryFn: fetch('/api/health/pools')`, `refetchInterval: 30_000`, `staleTime: 25_000`
    - Use a second `useQuery` for `['health', 'alerts', { limit: 50 }]` with the same `refetchInterval`
    - Manage `selectedPoolId: number | null` with `useState`
    - Render `<SummaryPanel>`, `<PoolStatusTable>`, `<AlertsTimeline>`, and conditionally `<PoolDetailPanel>` when `selectedPoolId` is set
    - Show a stale-data indicator when either query is in error state
    - _Requirements: 11.2, 11.3, 11.4, 11.6_

  - [ ] 11.3 Create `web/app/monitoring/components/SummaryPanel.tsx`
    - Accept `pools: PoolEntryResponse[]` and `collectedAt: number` as props
    - Count pools by `health_state` and display each count using `Badge` from `web/components/ui/`
    - Display `collectedAt` as a human-readable timestamp (e.g. "Last updated: 14:32:01")
    - _Requirements: 11.2_

  - [ ] 11.4 Create `web/app/monitoring/components/PoolStatusTable.tsx`
    - Accept `pools: PoolEntryResponse[]` and `onSelectPool: (id: number) => void` as props
    - Render a sortable table with columns: Pool ID, Title, Health State, TVL (formatted as XLM), Error Rate (%), Active Alerts
    - Default sort order: `stuck → frozen → expired → active → scheduled → voided → settled`
    - Use `StatusBadge` for health state (color-coded) and `Badge` for each active alert name
    - Clicking a row calls `onSelectPool(pool.pool_id)`
    - _Requirements: 11.3_

  - [ ] 11.5 Create `web/app/monitoring/components/AlertsTimeline.tsx`
    - Accept `alerts: AlertRecordResponse[]` as props
    - Render the 50 most recent alerts in reverse chronological order
    - Each entry shows: relative timestamp (e.g. "2 min ago"), rule name, pool ID + title, severity badge, and key metric value extracted from `payload`
    - Use a red `Badge` variant for `critical` severity and a yellow `Badge` variant for `warning` severity
    - _Requirements: 11.4, 11.7_

  - [ ] 11.6 Create `web/app/monitoring/components/PoolDetailPanel.tsx`
    - Accept `poolId: number` and `onClose: () => void` as props
    - Fetch `GET /api/health/pools?pool_id=<id>` and `GET /api/health/alerts?pool_id=<id>&limit=100` using `useQuery`
    - Render `Skeleton` components while loading
    - Display a metric history table (timestamp, TVL, error rate, participant count) and an alert history list for the last 24 hours
    - Include a link to `/markets/[poolId]` using the existing market page route
    - Render inline below the selected row (not a modal)
    - _Requirements: 11.5_

  - [ ]* 11.7 Write component tests in `web/tests/components/monitoring/`
    - `SummaryPanel.test.tsx`: renders correct counts per health state using `renderWithProviders`
    - `PoolStatusTable.test.tsx`: renders all pool rows; clicking a row calls `onSelectPool` with correct pool ID
    - `AlertsTimeline.test.tsx`: renders red badge for `critical`, yellow badge for `warning`
    - `PoolDetailPanel.test.tsx`: renders `Skeleton` while loading; renders metrics table when data arrives
    - **Validates: Requirements 11.2–11.5, 11.7**

- [ ] 12. Add documentation
  - [ ] 12.1 Create `web/docs/MONITORING.md`
    - Document all 9 environment variables with type, valid range, default value, and description (matching the table in the design document)
    - Document all 4 alert rules: `settlement_overdue`, `tvl_drop`, `high_error_rate`, `oracle_price_deviation` — trigger conditions, default thresholds, cooldown periods, and severity
    - Document the webhook payload schema for each alert rule (field names, types, example values)
    - Include instructions for verifying the `X-Predinex-Signature` HMAC-SHA256 header, with a Node.js code example
    - Include example webhook receiver code for Slack (parsing Block Kit) and Telegram (sending a message via Bot API)
    - Include a step-by-step deployment guide: environment variable setup, running `next start`, confirming the `/monitoring` route is accessible, and verifying the `/api/health/config` endpoint
    - _Requirements: 13.1, 13.2, 13.3_

- [ ] 13. Final checkpoint — full feature complete
  - Ensure all tests pass (`vitest --run`). Verify the TypeScript compiler reports no errors (`tsc --noEmit`). Ask the user if questions arise.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP; all core implementation tasks are required.
- Each task references specific requirements for traceability.
- `bigint` fields must be serialized as decimal strings in all JSON API responses; clients parse them with `BigInt()` or display them as strings.
- The `HealthMonitor` singleton is initialized at module load time when any API route is first imported. This is intentional and works correctly with `next start` (persistent Node.js process). Hot-reload reinitializations in development are acceptable.
- All API routes must export `runtime = 'nodejs'` — the monitoring system is not compatible with the Edge runtime.
- Property tests use `fast-check` (already in `devDependencies` at `^4.5.2`) with `numRuns: 100` unless otherwise noted. Tag each property test with `// Feature: pool-health-monitoring, Property N: <description>`.
- Test files live under `web/tests/lib/monitoring/` (unit/property) and `web/tests/lib/monitoring/api/` (integration), and `web/tests/components/monitoring/` (component tests), matching the existing project test layout.

---

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "3.1", "4.1", "5.1"] },
    { "id": 2, "tasks": ["2.2", "3.2", "4.2", "5.2"] },
    { "id": 3, "tasks": ["7.1"] },
    { "id": 4, "tasks": ["7.2"] },
    { "id": 5, "tasks": ["8.1"] },
    { "id": 6, "tasks": ["8.2", "9.1", "9.2", "9.3"] },
    { "id": 7, "tasks": ["9.4"] },
    { "id": 8, "tasks": ["11.1", "11.2", "11.3", "11.4", "11.5", "11.6"] },
    { "id": 9, "tasks": ["11.7", "12.1"] }
  ]
}
```
