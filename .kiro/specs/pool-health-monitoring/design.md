# Design Document: Pool Health Monitoring

## Overview

The Pool Health Monitoring feature adds a continuous server-side monitoring system for Predinex prediction market pools on the Stellar/Soroban blockchain. A background polling singleton collects on-chain metrics every N seconds, classifies each pool into a health state, evaluates four alert rules, and delivers signed webhook notifications to configured endpoints. A `/monitoring` dashboard page provides operators with a real-time overview.

The system runs entirely within the existing Next.js application — no additional infrastructure is required. The background poller is a module-level singleton initialized on first import of any API route in the Node.js runtime. All state is held in-memory with optional NDJSON file persistence for alert history.

### Key Design Decisions

- **In-process singleton over a separate service**: Avoids operational complexity. The Next.js Node.js runtime keeps the module alive between requests in a long-running server deployment (e.g., `next start`). This is explicitly not compatible with serverless/edge deployments — the routes must run in the Node.js runtime.
- **Read-only Soroban access**: All pool data is fetched via `simulateTransaction` (existing `soroban-read-api.ts`) and `getEvents` (existing `soroban-event-service.ts`). No write transactions are issued.
- **Reuse existing patterns**: HMAC signing reuses `webhook-service.ts`'s SubtleCrypto pattern; retry uses `retry.ts`'s `withRetry()`; logging uses `createScopedLogger()`.


## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Next.js Node.js Runtime (long-running server)                      │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  HealthMonitor (module-level singleton)                      │   │
│  │                                                              │   │
│  │  ┌─────────────────┐    ┌──────────────────────────────┐    │   │
│  │  │  Poll Loop       │    │  In-Memory Store             │    │   │
│  │  │  (setInterval)   │───▶│  poolHealthMap               │    │   │
│  │  │                  │    │  Map<poolId, PoolHealthEntry> │    │   │
│  │  └────────┬─────────┘    └──────────────────────────────┘    │   │
│  │           │                                                   │   │
│  │           ▼                                                   │   │
│  │  ┌─────────────────┐    ┌──────────────────────────────┐    │   │
│  │  │  AlertEngine     │───▶│  AlertStore (ring buffer)    │    │   │
│  │  │  evaluateAll()   │    │  max 1000 entries            │    │   │
│  │  └────────┬─────────┘    └──────────────────────────────┘    │   │
│  │           │                                                   │   │
│  │           ▼                                                   │   │
│  │  ┌─────────────────┐                                         │   │
│  │  │ NotificationSvc  │──▶ Webhook URLs (HTTP POST)            │   │
│  │  │ deliver()        │──▶ Slack Block Kit (if slack URL)      │   │
│  │  └─────────────────┘                                         │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  API Routes (read from shared in-memory store)               │   │
│  │  GET /api/health/pools   ──▶ poolHealthMap                   │   │
│  │  GET /api/health/alerts  ──▶ AlertStore                      │   │
│  │  GET /api/health/config  ──▶ MonitoringConfig                │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
         ▲                              ▲
         │ Soroban RPC                  │ HTTP poll (30s)
         │ simulateTransaction          │
         │ getEvents                    │
┌────────┴──────────┐        ┌──────────┴──────────────┐
│  Stellar/Soroban  │        │  /monitoring Dashboard   │
│  Blockchain RPC   │        │  (React, TanStack Query) │
└───────────────────┘        └─────────────────────────┘
```

### Singleton Initialization

The `HealthMonitor` singleton is initialized lazily on first import. Each API route (`/api/health/pools`, `/api/health/alerts`, `/api/health/config`) imports from `health-monitor.ts`, which triggers initialization at module load time. The singleton starts its poll loop immediately and keeps running for the lifetime of the Node.js process.

```
// health-monitor.ts (module level)
const monitor = new HealthMonitor(getMonitoringConfig());
monitor.start();
export { monitor };
```

This pattern works correctly in `next start` (persistent Node.js process). In development with hot reload, the module may reinitialize — this is acceptable since monitoring is an operational concern.


## Data Models

All types live in `web/app/lib/monitoring/types.ts`.

### HealthState

```typescript
export type HealthState =
  | 'active'      // Open, within expiry
  | 'expired'     // Open, past expiry, within grace period
  | 'stuck'       // Open, past expiry + grace period
  | 'frozen'      // Frozen or Disputed contract status
  | 'voided'      // Voided or Cancelled contract status
  | 'settled'     // Settled contract status
  | 'scheduled';  // Scheduled contract status
```

### AlertSeverity and AlertRuleName

```typescript
export type AlertSeverity = 'critical' | 'warning';

export type AlertRuleName =
  | 'settlement_overdue'
  | 'tvl_drop'
  | 'high_error_rate'
  | 'oracle_price_deviation';
```

### PoolMetric

A single snapshot captured per poll cycle per pool.

```typescript
export interface PoolMetric {
  pool_id: number;
  collected_at: number;          // Unix timestamp (seconds)
  tvl_stroops: bigint;           // total_a + total_b
  participant_count: number;
  cumulative_volume_stroops: bigint;
  status: string;                // Raw contract status: Open | Settled | Voided | Frozen | Disputed | Scheduled
  expiry: number;                // Unix timestamp (seconds)
  error_rate_pct: number;        // Rounded to 2 decimal places
  recent_tx_volume_stroops: bigint; // Rolling 5-minute window
}
```

### PoolHealthEntry

The current state of a pool, combining the latest metric snapshot with derived fields.

```typescript
export interface PoolHealthEntry {
  pool_id: number;
  pool_title: string;
  health_state: HealthState;
  latest_metric: PoolMetric;
  /** Ring buffer of recent snapshots for TVL drop detection (max 100 entries) */
  tvl_history: Array<{ timestamp: number; tvl_stroops: bigint }>;
  /** Names of currently active (unfired-cooldown) alert rules */
  active_alerts: AlertRuleName[];
  /** Timestamp of last successful metric collection */
  last_collected_at: number;
}
```

### AlertRecord

A fired alert with full payload.

```typescript
export interface AlertRecord {
  id: string;                    // UUID v4
  rule: AlertRuleName;
  severity: AlertSeverity;
  pool_id: number;
  pool_title: string;
  fired_at: number;              // Unix timestamp (seconds)
  /** Rule-specific payload fields */
  payload: AlertPayload;
}

export type AlertPayload =
  | SettlementOverduePayload
  | TvlDropPayload
  | HighErrorRatePayload
  | OraclePriceDeviationPayload;

export interface SettlementOverduePayload {
  rule: 'settlement_overdue';
  pool_id: number;
  pool_title: string;
  expiry: number;
  grace_period_secs: number;
  overdue_by_secs: number;
  severity: 'warning';
}

export interface TvlDropPayload {
  rule: 'tvl_drop';
  pool_id: number;
  pool_title: string;
  previous_tvl_stroops: bigint;
  current_tvl_stroops: bigint;
  drop_pct: number;
  window_secs: number;
  severity: 'critical';
}

export interface HighErrorRatePayload {
  rule: 'high_error_rate';
  pool_id: number;
  pool_title: string;
  error_rate_pct: number;
  threshold_pct: number;
  window_secs: number;
  severity: 'warning';
}

export interface OraclePriceDeviationPayload {
  rule: 'oracle_price_deviation';
  pool_id: number;
  pool_title: string;
  primary_price: number;
  secondary_price: number;
  deviation_pct: number;
  threshold_pct: number;
  severity: 'critical';
}
```

### MonitoringConfig

```typescript
export interface MonitoringConfig {
  pollIntervalSecs: number;           // Default: 60
  gracePeriodSecs: number;            // Default: 3600
  tvlDropThresholdPct: number;        // Default: 10
  tvlDropWindowSecs: number;          // Default: 300
  errorRateThresholdPct: number;      // Default: 5
  oracleDeviationThresholdPct: number; // Default: 2
  webhookUrls: string[];              // Default: []
  webhookSecret: string;              // Default: ""
  secondaryOracleUrl: string;         // Default: ""
  alertLogPath: string;               // Default: ""
}
```


## File Structure

```
web/
├── app/
│   ├── lib/
│   │   └── monitoring/
│   │       ├── types.ts                  — All shared types and interfaces
│   │       ├── config.ts                 — Parse env vars → MonitoringConfig
│   │       ├── health-monitor.ts         — HealthMonitor singleton (poll loop)
│   │       ├── alert-engine.ts           — AlertEngine (rule evaluation + cooldowns)
│   │       ├── notification-service.ts   — NotificationService (webhook delivery)
│   │       ├── alert-store.ts            — AlertStore (ring buffer + file persistence)
│   │       ├── pool-classifier.ts        — classifyPoolHealthState() pure function
│   │       └── error-rate-tracker.ts     — Rolling window error rate computation
│   │
│   ├── api/
│   │   └── health/
│   │       ├── pools/
│   │       │   └── route.ts              — GET /api/health/pools
│   │       ├── alerts/
│   │       │   └── route.ts              — GET /api/health/alerts
│   │       └── config/
│   │           └── route.ts              — GET /api/health/config
│   │
│   └── monitoring/
│       ├── page.tsx                      — /monitoring dashboard (RSC shell)
│       └── components/
│           ├── SummaryPanel.tsx          — Health state counts + last collected_at
│           ├── PoolStatusTable.tsx       — Sortable pool table
│           ├── AlertsTimeline.tsx        — Last 50 alerts with severity badges
│           └── PoolDetailPanel.tsx       — Per-pool detail (metrics + alerts)
│
└── __tests__/
    └── monitoring/
        ├── pool-classifier.test.ts
        ├── alert-engine.test.ts
        ├── error-rate-tracker.test.ts
        ├── notification-service.test.ts
        └── api/
            ├── health-pools.test.ts
            ├── health-alerts.test.ts
            └── health-config.test.ts
```


## Components and Interfaces

### config.ts

Parses environment variables and returns a validated `MonitoringConfig`. Invalid values are logged and replaced with defaults.

```typescript
// web/app/lib/monitoring/config.ts
import { createScopedLogger } from '../logger';

const log = createScopedLogger('monitoring:config');

export function getMonitoringConfig(): MonitoringConfig {
  return {
    pollIntervalSecs: parseIntEnv('MONITORING_POLL_INTERVAL_SECS', 60, 10, 3600),
    gracePeriodSecs: parseIntEnv('MONITORING_GRACE_PERIOD_SECS', 3600, 1, 86400),
    tvlDropThresholdPct: parseFloatEnv('MONITORING_TVL_DROP_THRESHOLD_PCT', 10, 0.01, 100),
    tvlDropWindowSecs: parseIntEnv('MONITORING_TVL_DROP_WINDOW_SECS', 300, 60, 86400),
    errorRateThresholdPct: parseFloatEnv('MONITORING_ERROR_RATE_THRESHOLD_PCT', 5, 0.01, 100),
    oracleDeviationThresholdPct: parseFloatEnv('MONITORING_ORACLE_DEVIATION_THRESHOLD_PCT', 2, 0.01, 100),
    webhookUrls: parseUrlList('MONITORING_WEBHOOK_URLS'),
    webhookSecret: process.env.MONITORING_WEBHOOK_SECRET ?? '',
    secondaryOracleUrl: process.env.MONITORING_SECONDARY_ORACLE_URL ?? '',
    alertLogPath: process.env.MONITORING_ALERT_LOG_PATH ?? '',
  };
}
```

### pool-classifier.ts

A pure function with no side effects. Takes a raw pool snapshot and config, returns a `HealthState`.

```typescript
// web/app/lib/monitoring/pool-classifier.ts
export function classifyPoolHealthState(
  status: string,
  expiry: number,
  nowSecs: number,
  gracePeriodSecs: number
): HealthState {
  switch (status) {
    case 'Settled':   return 'settled';
    case 'Voided':
    case 'Cancelled': return 'voided';
    case 'Frozen':
    case 'Disputed':  return 'frozen';
    case 'Scheduled': return 'scheduled';
    case 'Open':
      if (nowSecs < expiry) return 'active';
      if (nowSecs < expiry + gracePeriodSecs) return 'expired';
      return 'stuck';
    default:          return 'active'; // unknown status treated as active
  }
}
```

### error-rate-tracker.ts

Maintains a per-pool rolling window of transaction outcomes. Events older than the window are pruned on each access.

```typescript
// web/app/lib/monitoring/error-rate-tracker.ts
export interface TxOutcome {
  timestamp: number;  // Unix seconds
  success: boolean;
}

export class ErrorRateTracker {
  // Map<poolId, TxOutcome[]>
  private windows = new Map<number, TxOutcome[]>();
  private windowSecs = 3600; // 1 hour

  record(poolId: number, outcome: TxOutcome): void { /* ... */ }
  
  getErrorRate(poolId: number, nowSecs?: number): number {
    // Prune old events, compute (failed / total) * 100, round to 2dp
    // Returns 0.00 when total === 0
  }

  /** Called by HealthMonitor after fetching events from getEvents RPC */
  ingestEvents(poolId: number, events: DecodedSorobanEvent[]): void { /* ... */ }
}
```

### health-monitor.ts

The central singleton. Owns the poll loop, the `poolHealthMap`, and coordinates all subsystems.

```typescript
// web/app/lib/monitoring/health-monitor.ts
export class HealthMonitor {
  private config: MonitoringConfig;
  private poolHealthMap = new Map<number, PoolHealthEntry>();
  private alertEngine: AlertEngine;
  private notificationService: NotificationService;
  private alertStore: AlertStore;
  private errorRateTracker: ErrorRateTracker;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private log = createScopedLogger('monitoring:health-monitor');

  constructor(config: MonitoringConfig) { /* ... */ }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNextCycle();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
  }

  getPoolHealthMap(): ReadonlyMap<number, PoolHealthEntry> {
    return this.poolHealthMap;
  }

  getLastCollectedAt(): number | null { /* ... */ }

  private scheduleNextCycle(): void {
    this.timer = setTimeout(async () => {
      await this.runCycle();
      if (this.running) this.scheduleNextCycle();
    }, this.config.pollIntervalSecs * 1000);
  }

  private async runCycle(): Promise<void> {
    // 1. Fetch pool count
    // 2. Batch-read all pools (with 5s AbortController timeout per pool)
    // 3. Ingest events for error rate tracking
    // 4. Compute metrics + classify health state
    // 5. Update poolHealthMap (retain previous snapshot on RPC error)
    // 6. Run alert engine
    // 7. Deliver notifications for new alerts
    // 8. Persist new alerts to AlertStore
  }
}

// Module-level singleton — initialized once on first import
const _monitor = new HealthMonitor(getMonitoringConfig());
_monitor.start();
export const monitor = _monitor;
```

**Per-pool RPC timeout**: Each `getPoolFromSoroban` call is wrapped with an `AbortController` with a 5-second timeout. On timeout or error, the previous `PoolHealthEntry` is retained unchanged and the error is logged.

**TVL history ring buffer**: Each `PoolHealthEntry` maintains a `tvl_history` array capped at 100 entries. On each poll cycle, the current TVL snapshot is appended and entries older than `tvlDropWindowSecs` are pruned before the alert engine runs.

### alert-engine.ts

Stateless evaluation function plus a cooldown map. The cooldown map is owned by the `AlertEngine` instance (which is owned by `HealthMonitor`).

```typescript
// web/app/lib/monitoring/alert-engine.ts
export class AlertEngine {
  // Key: `${rule}:${poolId}`, Value: Unix timestamp of last firing
  private cooldowns = new Map<string, number>();

  evaluateAll(
    pools: PoolHealthEntry[],
    config: MonitoringConfig,
    nowSecs?: number
  ): AlertRecord[] {
    const now = nowSecs ?? Math.floor(Date.now() / 1000);
    const alerts: AlertRecord[] = [];
    for (const pool of pools) {
      alerts.push(...this.evaluatePool(pool, config, now));
    }
    return alerts;
  }

  private evaluatePool(pool: PoolHealthEntry, config: MonitoringConfig, now: number): AlertRecord[] { /* ... */ }
  private checkSettlementOverdue(pool: PoolHealthEntry, config: MonitoringConfig, now: number): AlertRecord | null { /* ... */ }
  private checkTvlDrop(pool: PoolHealthEntry, config: MonitoringConfig, now: number): AlertRecord | null { /* ... */ }
  private checkHighErrorRate(pool: PoolHealthEntry, config: MonitoringConfig, now: number): AlertRecord | null { /* ... */ }
  private checkOraclePriceDeviation(pool: PoolHealthEntry, config: MonitoringConfig, now: number): Promise<AlertRecord | null> { /* ... */ }

  private isCoolingDown(rule: AlertRuleName, poolId: number, cooldownSecs: number, now: number): boolean { /* ... */ }
  private recordFiring(rule: AlertRuleName, poolId: number, now: number): void { /* ... */ }
}
```

**Cooldown periods**:
- `settlement_overdue`: 3600 seconds (1 hour)
- `tvl_drop`: 300 seconds (5 minutes)
- `high_error_rate`: 3600 seconds (1 hour)
- `oracle_price_deviation`: 900 seconds (15 minutes)

**Oracle deviation**: Fetches `config.secondaryOracleUrl` with a 5-second timeout. If the URL is empty, the fetch fails, or the response cannot be parsed as a number, the check is skipped silently.

### notification-service.ts

Delivers alerts to all configured webhook URLs independently.

```typescript
// web/app/lib/monitoring/notification-service.ts
export class NotificationService {
  private log = createScopedLogger('monitoring:notification');

  async deliver(alert: AlertRecord, config: MonitoringConfig): Promise<void> {
    const deliveries = config.webhookUrls.map(url =>
      this.deliverToUrl(alert, url, config.webhookSecret)
    );
    // All deliveries run independently — Promise.allSettled
    await Promise.allSettled(deliveries);
  }

  private async deliverToUrl(alert: AlertRecord, url: string, secret: string): Promise<void> {
    const isSlack = url.includes('hooks.slack.com');
    const body = isSlack ? this.formatSlackMessage(alert) : JSON.stringify(alert);

    await withRetry(
      async () => {
        const signature = await this.sign(body, secret);
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Predinex-Signature': `sha256=${signature}`,
            'X-Predinex-Alert-Rule': alert.rule,
          },
          body,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      },
      {
        maxAttempts: 4,       // 1 initial + 3 retries
        baseDelayMs: 5000,    // 5s → 10s → 20s (cap 40s)
        backoffFactor: 2,
        maxDelayMs: 40000,
        onRetry: (attempt, err) => this.log.warn(`Retry ${attempt} for ${url}`, err),
      }
    );
  }

  private async sign(body: string, secret: string): Promise<string> {
    // SubtleCrypto HMAC-SHA256 — same pattern as webhook-service.ts
  }

  private formatSlackMessage(alert: AlertRecord): string {
    // Returns Slack Block Kit JSON with severity color, rule name, pool title, key metrics
  }
}
```

**Slack Block Kit format**: The message uses a `section` block with a `mrkdwn` text field containing the alert summary, a `context` block with the pool ID and fired_at timestamp, and a color attachment (`danger` for critical, `warning` for warning severity).

### alert-store.ts

```typescript
// web/app/lib/monitoring/alert-store.ts
export class AlertStore {
  private buffer: AlertRecord[] = [];
  private maxSize = 1000;
  private logPath: string;
  private log = createScopedLogger('monitoring:alert-store');

  constructor(logPath: string) { this.logPath = logPath; }

  add(alert: AlertRecord): void {
    this.buffer.push(alert);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift(); // evict oldest
    }
    if (this.logPath) this.appendToFile(alert);
  }

  query(opts: { limit?: number; poolId?: number; rule?: AlertRuleName }): AlertRecord[] {
    // Filter by poolId and/or rule, return most recent `limit` entries
  }

  private appendToFile(alert: AlertRecord): void {
    // fs.appendFileSync(this.logPath, JSON.stringify(alert) + '\n')
    // Errors are logged but do not throw
  }
}
```


## API Route Design

All routes import `monitor` from `health-monitor.ts`, which triggers singleton initialization. All routes set `Cache-Control: no-store` and run in the Node.js runtime (not edge).

### GET /api/health/pools

**File**: `web/app/api/health/pools/route.ts`

**Query parameters**: `?pool_id=<number>` (optional)

**Response shape**:
```typescript
// 200 OK
interface PoolsResponse {
  collected_at: number;  // Unix timestamp of last poll cycle
  pools: PoolEntryResponse[];
}

interface PoolEntryResponse {
  pool_id: number;
  pool_title: string;
  status: string;
  health_state: HealthState;
  tvl_stroops: string;           // bigint serialized as string
  participant_count: number;
  cumulative_volume_stroops: string;
  expiry: number;
  error_rate_pct: number;
  recent_tx_volume_stroops: string;
  alerts: AlertRuleName[];
  last_collected_at: number;
}

// 503 — no data yet
interface NotReadyResponse { message: string; }

// 404 — pool_id not found or not active
interface NotFoundResponse { message: string; }
```

**Logic**:
1. If `monitor.getLastCollectedAt()` is null → 503 `{ message: "metrics not yet collected" }`.
2. If `pool_id` query param is present:
   - Look up in `poolHealthMap`. If not found or health_state is `settled`/`voided` → 404.
   - Return single-pool `PoolsResponse` with `pools: [entry]`.
3. Otherwise, return all entries where `health_state` is not `settled` or `voided`.
4. Always set `Cache-Control: no-store`.

**Error cases**:
- `pool_id` is not a valid integer → 400 `{ message: "invalid pool_id" }`.
- Unexpected error → 500 `{ message: "internal error" }`.

### GET /api/health/alerts

**File**: `web/app/api/health/alerts/route.ts`

**Query parameters**: `?limit=<number>` (default 50, max 500), `?pool_id=<number>`, `?rule=<AlertRuleName>`

**Response shape**:
```typescript
// 200 OK
interface AlertsResponse {
  alerts: AlertRecordResponse[];
  total: number;
}

interface AlertRecordResponse {
  id: string;
  rule: AlertRuleName;
  severity: AlertSeverity;
  pool_id: number;
  pool_title: string;
  fired_at: number;
  payload: Record<string, unknown>; // bigint fields serialized as strings
}
```

**Logic**:
1. Parse and clamp `limit` to [1, 500], default 50.
2. Call `alertStore.query({ limit, poolId, rule })`.
3. Serialize bigint fields as strings in the response.
4. Always set `Cache-Control: no-store`.

### GET /api/health/config

**File**: `web/app/api/health/config/route.ts`

**Response shape**:
```typescript
// 200 OK
interface ConfigResponse {
  pollIntervalSecs: number;
  gracePeriodSecs: number;
  tvlDropThresholdPct: number;
  tvlDropWindowSecs: number;
  errorRateThresholdPct: number;
  oracleDeviationThresholdPct: number;
  webhookUrls: string[];
  webhookSecret: '[REDACTED]';   // always redacted
  secondaryOracleUrl: string;
  alertLogPath: string;
}
```

**Logic**: Return `getMonitoringConfig()` with `webhookSecret` replaced by `'[REDACTED]'`. Always set `Cache-Control: no-store`.


## Dashboard Design

### Page Shell (`web/app/monitoring/page.tsx`)

A React Server Component that renders the page layout and imports client components. No data fetching at the RSC level — all data is fetched client-side via TanStack Query to enable auto-refresh.

```tsx
// web/app/monitoring/page.tsx
import { Suspense } from 'react';
import MonitoringDashboard from './components/MonitoringDashboard';

export const runtime = 'nodejs'; // Required — not edge compatible

export default function MonitoringPage() {
  return (
    <main className="container mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-6">Pool Health Monitoring</h1>
      <Suspense fallback={<DashboardSkeleton />}>
        <MonitoringDashboard />
      </Suspense>
    </main>
  );
}
```

### MonitoringDashboard (Client Component)

The root client component. Uses `useQuery` with `refetchInterval: 30_000`. On fetch error, renders `StaleDataIndicator` with `forceStale`.

```tsx
'use client';
import { useQuery } from '@tanstack/react-query';

export default function MonitoringDashboard() {
  const poolsQuery = useQuery({
    queryKey: ['health', 'pools'],
    queryFn: () => fetch('/api/health/pools').then(r => r.json()),
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  const alertsQuery = useQuery({
    queryKey: ['health', 'alerts', { limit: 50 }],
    queryFn: () => fetch('/api/health/alerts?limit=50').then(r => r.json()),
    refetchInterval: 30_000,
  });

  const [selectedPoolId, setSelectedPoolId] = useState<number | null>(null);

  // ...render SummaryPanel, PoolStatusTable, AlertsTimeline, PoolDetailPanel
}
```

### SummaryPanel

Displays counts by `health_state` and the `collected_at` timestamp. Uses `Card` and `Badge` from `web/components/ui/`.

```
┌─────────────────────────────────────────────────────┐
│  Pool Health Summary          Last updated: 14:32:01 │
│                                                     │
│  Active: 12   Expired: 2   Stuck: 1   Frozen: 0    │
│  Voided: 3    Settled: 45  Scheduled: 4             │
└─────────────────────────────────────────────────────┘
```

### PoolStatusTable

Sortable table with columns: Pool ID, Title, Health State, TVL (XLM), Error Rate, Active Alerts. Clicking a row sets `selectedPoolId` to open `PoolDetailPanel`. Uses `StatusBadge` for health state, `Badge` for alert names.

Sorting is client-side. Default sort: health_state priority (stuck → frozen → expired → active → scheduled → voided → settled).

### AlertsTimeline

Renders the last 50 alerts from `GET /api/health/alerts?limit=50` in reverse chronological order. Each entry shows:
- Timestamp (relative, e.g. "2 min ago")
- Rule name
- Pool ID + title
- Severity badge: red `Badge` for `critical`, yellow for `warning` (using existing `Badge` component variants)
- Key metric value (e.g. "drop: 15.3%", "error rate: 8.2%")

### PoolDetailPanel

Rendered as an inline expand below the selected row (not a modal). Fetches:
- `GET /api/health/pools?pool_id=<id>` — current metrics
- `GET /api/health/alerts?pool_id=<id>&limit=100` — pool-specific alert history

Displays:
- 24-hour metric history as a simple table (timestamp, TVL, error rate, participant count)
- All alerts for this pool in the last 24 hours
- Link to `/markets/[id]` using the existing market page route

Uses `Skeleton` component while loading. Uses `StaleDataIndicator` on fetch error.


## Configuration

All configuration is read from environment variables at startup via `getMonitoringConfig()`. Invalid values are logged with `createScopedLogger('monitoring:config')` and replaced with defaults.

| Variable | Type | Default | Valid Range | Description |
|---|---|---|---|---|
| `MONITORING_POLL_INTERVAL_SECS` | integer | `60` | 10–3600 | Seconds between end of one poll cycle and start of next |
| `MONITORING_GRACE_PERIOD_SECS` | integer | `3600` | 1–86400 | Seconds after expiry before a pool is classified as `stuck` |
| `MONITORING_TVL_DROP_THRESHOLD_PCT` | float | `10` | 0.01–100 | Minimum TVL drop percentage to trigger `tvl_drop` alert |
| `MONITORING_TVL_DROP_WINDOW_SECS` | integer | `300` | 60–86400 | Observation window for TVL drop detection |
| `MONITORING_ERROR_RATE_THRESHOLD_PCT` | float | `5` | 0.01–100 | Error rate percentage threshold for `high_error_rate` alert |
| `MONITORING_ORACLE_DEVIATION_THRESHOLD_PCT` | float | `2` | 0.01–100 | Oracle price deviation percentage threshold |
| `MONITORING_WEBHOOK_URLS` | string (comma-sep) | `""` | Valid HTTP(S) URLs | Comma-separated list of webhook delivery endpoints |
| `MONITORING_WEBHOOK_SECRET` | string | `""` | Any non-empty string | Shared secret for HMAC-SHA256 signing |
| `MONITORING_SECONDARY_ORACLE_URL` | string | `""` | Valid HTTP(S) URL | Secondary price source for oracle deviation checks |
| `MONITORING_ALERT_LOG_PATH` | string | `""` | Valid file path | If set, alerts are appended as NDJSON to this file |


## Error Handling

### RPC Errors

- Per-pool RPC timeout: 5-second `AbortController`. On timeout, the previous `PoolHealthEntry` is retained and the error is logged with pool ID.
- If `getPoolCountFromSoroban` fails, the cycle is aborted and rescheduled. The error is logged.
- If `getEvents` fails for error rate tracking, the error rate for affected pools is not updated (previous value retained).

### Alert Delivery Errors

- Each webhook URL is delivered to independently via `Promise.allSettled`. One URL failing does not block others.
- After 3 retries (4 total attempts), the failure is logged with rule, pool ID, final HTTP status, and timestamp.
- Oracle price fetch failures (timeout, non-200, parse error) silently skip the oracle check for that cycle.

### File Persistence Errors

- `fs.appendFileSync` errors are caught and logged. They do not throw or affect the in-memory store.

### API Route Errors

- Cold start (no data collected yet): 503 with `{ message: "metrics not yet collected" }`.
- Invalid query parameters: 400 with descriptive message.
- Unexpected errors: 500 with `{ message: "internal error" }` (no stack trace in response).

### BigInt Serialization

`bigint` values (TVL, volume) cannot be serialized by `JSON.stringify` directly. All API responses serialize bigint fields as decimal strings. Clients must parse these with `BigInt()` or treat them as strings for display.


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

The following properties are derived from the acceptance criteria. Property-based testing is applicable here because the core logic modules (`pool-classifier.ts`, `alert-engine.ts`, `error-rate-tracker.ts`, `notification-service.ts`) are pure or near-pure functions whose behavior varies meaningfully with input, and running 100+ iterations with generated inputs will surface edge cases that hand-written examples miss.

**Property reflection**: After reviewing all testable criteria, several payload-shape properties (5.2, 6.2, 7.2, 8.2) can be consolidated into a single "alert payload completeness" property per rule. Similarly, cooldown properties (5.4, 6.5, 7.5, 8.5) share the same structure and are consolidated into a single cooldown property. Classification properties (3.1, 3.2, 3.3) are consolidated into two properties covering the full classification space.

---

### Property 1: TVL computation is additive

*For any* two non-negative bigint values `total_a` and `total_b`, `computeTvl(total_a, total_b)` equals `total_a + total_b`.

**Validates: Requirements 1.2**

---

### Property 2: RPC error isolation

*For any* set of pool IDs where a subset of RPC calls fail, the pools that succeed should still appear in the result map with valid metrics, and the failed pools should retain their previous snapshot (or be absent if no previous snapshot exists).

**Validates: Requirements 1.4**

---

### Property 3: Pool status filter correctness

*For any* collection of `PoolHealthEntry` values with varying `health_state` values, the pools API response should contain exactly those entries whose `health_state` is not `settled` or `voided`.

**Validates: Requirements 2.2**

---

### Property 4: Pool entry response shape completeness

*For any* `PoolHealthEntry` in the store, the corresponding entry in the `GET /api/health/pools` response must contain all required fields: `pool_id`, `status`, `health_state`, `tvl_stroops`, `participant_count`, `cumulative_volume_stroops`, `expiry`, `error_rate_pct`, `recent_tx_volume_stroops`, and `alerts`.

**Validates: Requirements 2.3, 3.4**

---

### Property 5: Single-pool filter returns exactly one entry

*For any* `pool_id` present in the store with an active health state, querying `GET /api/health/pools?pool_id=<id>` returns a response with exactly one pool entry whose `pool_id` matches the requested ID.

**Validates: Requirements 2.4**

---

### Property 6: Health state classification is total and valid

*For any* combination of contract `status` string, `expiry` timestamp, current time, and `gracePeriodSecs`, `classifyPoolHealthState()` returns exactly one of the seven valid `HealthState` values and never returns `null`, `undefined`, or an unlisted value.

**Validates: Requirements 3.1**

---

### Property 7: Expired and stuck classification boundaries

*For any* Open pool and any `gracePeriodSecs > 0`:
- When `now < expiry`, classification is `active`.
- When `expiry <= now < expiry + gracePeriodSecs`, classification is `expired`.
- When `now >= expiry + gracePeriodSecs`, classification is `stuck`.

**Validates: Requirements 3.2, 3.3**

---

### Property 8: Rolling window excludes stale events

*For any* set of transaction outcome events where some have timestamps older than 1 hour, `getErrorRate()` should only count events within the 1-hour window. Events outside the window must not affect the computed rate.

**Validates: Requirements 4.1**

---

### Property 9: Error rate formula correctness

*For any* `failedCount` in [0, N] and `totalCount` N > 0, `computeErrorRate(failedCount, totalCount)` equals `Math.round((failedCount / totalCount) * 10000) / 100` (i.e., `(failed/total)*100` rounded to 2 decimal places). When `totalCount === 0`, the result is `0.00`.

**Validates: Requirements 4.2, 4.3**

---

### Property 10: Settlement overdue alert fires for all stuck pools

*For any* collection of `PoolHealthEntry` values where some have `health_state === 'stuck'` and no cooldown is active, `evaluateAll()` must include a `settlement_overdue` alert for every stuck pool, and must not include a `settlement_overdue` alert for any non-stuck pool.

**Validates: Requirements 5.1**

---

### Property 11: Alert payload completeness and severity

*For any* fired alert of each rule type, the payload must contain all required fields with correct types, and the `severity` must match the rule's defined severity (`warning` for `settlement_overdue` and `high_error_rate`; `critical` for `tvl_drop` and `oracle_price_deviation`).

**Validates: Requirements 5.2, 6.2, 7.2, 8.2**

---

### Property 12: Alert cooldown prevents re-firing

*For any* pool and any alert rule, if an alert was fired at time T, then calling `evaluateAll()` at any time T' where `T' - T < cooldownSecs` for that rule must not produce another alert of the same rule for the same pool.

**Validates: Requirements 5.4, 6.5, 7.5, 8.5**

---

### Property 13: TVL drop alert fires when threshold exceeded

*For any* pool with a TVL history where the oldest snapshot within the window has TVL `prev` and the current TVL is `curr`, if `(prev - curr) / prev * 100 > threshold` and no cooldown is active, `evaluateAll()` must include a `tvl_drop` alert for that pool.

**Validates: Requirements 6.1**

---

### Property 14: High error rate alert fires when threshold exceeded

*For any* pool where `error_rate_pct > errorRateThresholdPct` and the rolling window contains at least one transaction, `evaluateAll()` must include a `high_error_rate` alert for that pool (when no cooldown is active).

**Validates: Requirements 7.1**

---

### Property 15: Oracle deviation alert fires when threshold exceeded

*For any* `primaryPrice` and `secondaryPrice` where `|primaryPrice - secondaryPrice| / secondaryPrice * 100 > oracleDeviationThresholdPct`, the oracle deviation check must produce an `oracle_price_deviation` alert (when no cooldown is active and a secondary URL is configured).

**Validates: Requirements 8.1**

---

### Property 16: HMAC signature correctness

*For any* alert payload string and webhook secret, the `X-Predinex-Signature` header value must equal `sha256=<hex>` where `<hex>` is the HMAC-SHA256 hex digest of the payload computed with the given secret. Verifying the signature with the same secret must succeed.

**Validates: Requirements 9.2**

---

### Property 17: Alert rule header matches alert rule

*For any* alert delivered to a webhook URL, the `X-Predinex-Alert-Rule` header value must equal `alert.rule`.

**Validates: Requirements 9.3**

---

### Property 18: Retry on non-2xx response

*For any* non-2xx HTTP status code returned by a webhook endpoint, the notification service must attempt delivery exactly 4 times total (1 initial + 3 retries) before giving up.

**Validates: Requirements 9.4**

---

### Property 19: Independent multi-URL delivery

*For any* set of N webhook URLs where some return errors, all N URLs must receive a POST request. The failure of one URL must not prevent delivery to the others.

**Validates: Requirements 9.6**

---

### Property 20: Slack Block Kit format for Slack URLs

*For any* alert delivered to a URL containing `hooks.slack.com`, the request body must be valid JSON containing a `blocks` array with at least one block, and must include the alert rule name and pool title in the message text.

**Validates: Requirements 9.8**

---

### Property 21: Alert store ring buffer eviction

*For any* sequence of N alerts added to the `AlertStore` where N > 1000, the store must contain exactly 1000 entries, and those entries must be the N most recently added alerts (oldest evicted first).

**Validates: Requirements 12.1**

---

### Property 22: Alert NDJSON round-trip

*For any* `AlertRecord`, serializing it to a JSON string and parsing it back must produce an equivalent record (all fields preserved, bigint fields round-trip correctly as strings).

**Validates: Requirements 12.2**

---

### Property 23: Alert query limit is respected

*For any* limit value `n` in [1, 500], `alertStore.query({ limit: n })` must return at most `n` alerts.

**Validates: Requirements 12.3**

---

### Property 24: Alert pool_id filter correctness

*For any* `pool_id` filter value, all alerts returned by `alertStore.query({ poolId })` must have `pool_id` equal to the filter value.

**Validates: Requirements 12.4**

---

### Property 25: Alert rule filter correctness

*For any* `rule` filter value, all alerts returned by `alertStore.query({ rule })` must have `rule` equal to the filter value.

**Validates: Requirements 12.5**


## Testing Strategy

### Property-Based Testing Library

Use **[fast-check](https://github.com/dubzzz/fast-check)** (already compatible with Vitest). Configure each property test to run a minimum of 100 iterations (`numRuns: 100`).

Tag format for each property test:
```typescript
// Feature: pool-health-monitoring, Property N: <property_text>
```

### Unit Tests

**`pool-classifier.test.ts`** — Pure function, all 7 states:
- Property 6: `fc.record({ status: fc.constantFrom('Open','Settled','Voided','Frozen','Disputed','Scheduled','Cancelled'), expiry: fc.integer(), now: fc.integer(), grace: fc.nat() })` → result is one of 7 valid states.
- Property 7: Generate Open pools with expiry/now combinations covering all three boundary regions.
- Example tests: one concrete case per health state for documentation clarity.

**`error-rate-tracker.test.ts`** — Rolling window:
- Property 8: Generate events with timestamps spanning more than 1 hour; verify stale events are excluded.
- Property 9: `fc.tuple(fc.nat(), fc.nat(1, 10000))` for (failed, total) → verify formula.
- Edge case: zero transactions → 0.00.

**`alert-engine.test.ts`** — Each rule + cooldown:
- Property 10: Generate pools with mixed health states; verify settlement_overdue fires for all stuck, none for others.
- Property 11: For each rule, generate a triggering pool; verify all payload fields present with correct severity.
- Property 12: `fc.record({ rule: fc.constantFrom(...rules), poolId: fc.nat(), cooldownSecs: fc.nat(1, 86400) })` → fire alert, re-evaluate within cooldown, verify no second alert.
- Property 13: Generate TVL histories with drops above/below threshold.
- Property 14: Generate error rates above/below threshold.
- Property 15: Generate price pairs with deviation above/below threshold.

**`notification-service.test.ts`** — Mock fetch:
- Property 16: `fc.tuple(fc.string(), fc.string(1, 64))` for (payload, secret) → verify HMAC.
- Property 17: Generate alerts with any rule name; verify header matches.
- Property 18: Mock fetch returning non-2xx; verify exactly 4 calls made.
- Property 19: `fc.array(fc.webUrl(), { minLength: 1, maxLength: 10 })` → verify all URLs receive POST.
- Property 20: Generate alerts; verify Slack body contains `blocks` array.

**`alert-store.test.ts`**:
- Property 21: Add N > 1000 alerts; verify exactly 1000 remain, oldest evicted.
- Property 22: `fc.record(...)` for AlertRecord → serialize/parse round-trip.
- Property 23: `fc.integer({ min: 1, max: 500 })` for limit → verify response length ≤ limit.
- Property 24: Generate alerts with mixed pool IDs; filter by one → all match.
- Property 25: Generate alerts with mixed rules; filter by one → all match.

### Integration Tests

**`health-pools.test.ts`** — Mock `monitor` singleton:
- 503 when no data collected.
- 200 with correct shape when data present.
- 404 for unknown pool_id.
- `Cache-Control: no-store` header present on all responses.
- `pool_id` filter returns single entry.

**`health-alerts.test.ts`**:
- Default limit 50.
- `?limit=200` returns up to 200.
- `?pool_id=X` filters correctly.
- `?rule=tvl_drop` filters correctly.

**`health-config.test.ts`**:
- `webhookSecret` is always `'[REDACTED]'` in response.
- All other config fields present.

### Component Tests

Dashboard components use the existing `renderWithProviders` helper (wraps with `QueryClientProvider`):
- `SummaryPanel`: renders correct counts per health state.
- `PoolStatusTable`: renders all pool rows; clicking a row triggers `onSelectPool`.
- `AlertsTimeline`: renders red badge for critical, yellow for warning.
- `PoolDetailPanel`: renders skeleton while loading; renders metrics table when data arrives.

### Test Configuration

```typescript
// vitest.config.ts addition (if not already present)
// No changes needed — fast-check works with Vitest out of the box

// Example property test structure:
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

describe('pool-classifier', () => {
  it('Property 6: classification is always a valid HealthState', () => {
    // Feature: pool-health-monitoring, Property 6: health state classification is total and valid
    fc.assert(
      fc.property(
        fc.constantFrom('Open', 'Settled', 'Voided', 'Frozen', 'Disputed', 'Scheduled', 'Cancelled', 'Unknown'),
        fc.integer({ min: 0, max: 9999999999 }),
        fc.integer({ min: 0, max: 9999999999 }),
        fc.nat(86400),
        (status, expiry, now, grace) => {
          const result = classifyPoolHealthState(status, expiry, now, grace);
          const valid: HealthState[] = ['active', 'expired', 'stuck', 'frozen', 'voided', 'settled', 'scheduled'];
          expect(valid).toContain(result);
        }
      ),
      { numRuns: 100 }
    );
  });
});
```

