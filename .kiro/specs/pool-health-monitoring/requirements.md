# Requirements Document

## Introduction

This feature adds a monitoring and alerting system for deployed Predinex prediction market pools on the Stellar/Soroban blockchain. The system continuously tracks key health metrics for all active pools, evaluates configurable alert rules, and notifies operators via webhook (Slack, Telegram, or any HTTP endpoint) when anomalies are detected. A dashboard page, deployable alongside the existing Next.js web frontend, provides operators with a real-time overview of pool health, a timeline of recent alerts, and per-pool detail views.

## Glossary

- **Health_Monitor**: The server-side service (Next.js API route + background polling) responsible for collecting pool metrics and evaluating alert rules.
- **Alert_Engine**: The subsystem within the Health_Monitor that evaluates alert rules against current metrics and dispatches notifications.
- **Notification_Service**: The subsystem that delivers alert payloads to configured webhook endpoints (Slack, Telegram, or generic HTTP).
- **Health_Dashboard**: The operator-facing web page at `/monitoring` that displays real-time pool status, alert history, and per-pool detail.
- **Pool_Metric**: A single measured data point for a pool at a point in time (e.g., TVL, error rate, transaction volume).
- **Alert_Rule**: A named, configurable condition that, when met, causes the Alert_Engine to emit an alert.
- **Alert**: A structured notification record produced when an Alert_Rule fires, containing severity, pool ID, rule name, current value, and threshold.
- **TVL**: Total Value Locked — the sum of all staked tokens across both outcomes of a pool, expressed in stroops.
- **Error_Rate**: The ratio of failed transactions to total transactions for a pool within a rolling time window, expressed as a percentage.
- **Grace_Period**: A configurable duration added to a pool's expiry timestamp before the settlement-overdue alert fires.
- **Webhook_Endpoint**: An HTTP URL that receives POST requests containing alert payloads, signed with HMAC-SHA256.
- **Operator**: A privileged user who configures and monitors the health system; not a regular bettor.
- **Soroban_RPC**: The Stellar Soroban JSON-RPC endpoint used to read on-chain pool state.
- **Pool_Status**: The lifecycle state of a pool as reported by the contract: `Open`, `Settled`, `Voided`, `Frozen`, `Disputed`, `Cancelled`, or `Scheduled`.

---

## Requirements

### Requirement 1: Health Metrics Collection

**User Story:** As an operator, I want the system to continuously collect health metrics for all active pools, so that I have up-to-date data to detect anomalies.

#### Acceptance Criteria

1. WHEN the Health_Monitor polling cycle runs, THE Health_Monitor SHALL query the Soroban_RPC to retrieve the current state of every pool with a `Pool_Status` of `Open` or `Scheduled`.
2. THE Health_Monitor SHALL compute the following Pool_Metric values for each active pool: TVL (sum of `total_a` and `total_b` in stroops), `participant_count`, `cumulative_volume`, `Pool_Status`, and `expiry` timestamp.
3. THE Health_Monitor SHALL record a `collected_at` Unix timestamp alongside each set of Pool_Metric values.
4. WHEN the Soroban_RPC returns an error for a pool read, THE Health_Monitor SHALL log the error with the pool ID and continue collecting metrics for remaining pools without aborting the cycle.
5. THE Health_Monitor SHALL complete each polling cycle within 30 seconds when the total active pool count is 500 or fewer.
6. WHERE the operator configures a polling interval, THE Health_Monitor SHALL use that interval (in seconds) between the end of one cycle and the start of the next; the default interval SHALL be 60 seconds.

---

### Requirement 2: Health Metrics API Endpoint

**User Story:** As an operator or external tool, I want a REST endpoint that returns current health metrics for all active pools, so that I can integrate the data into dashboards or scripts.

#### Acceptance Criteria

1. THE Health_Monitor SHALL expose a `GET /api/health/pools` endpoint that returns a JSON response containing a `pools` array and a top-level `collected_at` timestamp.
2. WHEN `GET /api/health/pools` is called, THE Health_Monitor SHALL return an entry for every pool whose `Pool_Status` is `Open`, `Frozen`, `Disputed`, or `Scheduled`.
3. WHEN `GET /api/health/pools` is called, each pool entry SHALL include: `pool_id`, `status`, `tvl_stroops`, `participant_count`, `cumulative_volume_stroops`, `expiry`, `error_rate_pct` (rolling 1-hour window), `recent_tx_volume_stroops` (rolling 5-minute window), and `alerts` (array of active alert names for that pool).
4. WHEN `GET /api/health/pools` is called with a `?pool_id=<id>` query parameter, THE Health_Monitor SHALL return a single-pool response containing only the entry for that pool ID.
5. IF a requested pool ID does not exist or is not in an active status, THEN THE Health_Monitor SHALL return HTTP 404 with a JSON error body containing a `message` field.
6. THE Health_Monitor SHALL respond to `GET /api/health/pools` within 2 seconds under normal operating conditions.
7. THE Health_Monitor SHALL include a `Cache-Control: no-store` header on all `GET /api/health/pools` responses to prevent stale data from being served by intermediary caches.

---

### Requirement 3: Pool Status Classification

**User Story:** As an operator, I want pools to be classified into meaningful health states beyond the raw contract status, so that I can quickly identify pools that need attention.

#### Acceptance Criteria

1. THE Health_Monitor SHALL classify each pool into exactly one of the following health states: `active` (Open, within expiry), `settled` (Settled), `expired` (Open, past expiry, not yet settled), `stuck` (Open, past expiry + Grace_Period, not yet settled), `frozen` (Frozen or Disputed), `voided` (Voided or Cancelled), or `scheduled` (Scheduled).
2. WHEN a pool's `expiry` timestamp is in the past and its `Pool_Status` is `Open`, THE Health_Monitor SHALL classify the pool as `expired`.
3. WHEN a pool's `expiry` timestamp is more than the configured Grace_Period seconds in the past and its `Pool_Status` is `Open`, THE Health_Monitor SHALL classify the pool as `stuck`.
4. THE Health_Monitor SHALL include the derived health state as a `health_state` field in every pool entry returned by `GET /api/health/pools`.

---

### Requirement 4: Error Rate Tracking

**User Story:** As an operator, I want the system to track the transaction error rate per pool, so that I can detect pools experiencing abnormally high failure rates.

#### Acceptance Criteria

1. THE Health_Monitor SHALL maintain a rolling 1-hour window of transaction outcomes (success or failure) per pool, sourced from Soroban contract events.
2. THE Health_Monitor SHALL compute `error_rate_pct` as `(failed_tx_count / total_tx_count) * 100` for each pool within the rolling window, rounded to two decimal places.
3. WHEN a pool has zero transactions in the rolling window, THE Health_Monitor SHALL report `error_rate_pct` as `0.00`.
4. THE Health_Monitor SHALL source transaction outcome data from Soroban contract events using the `getEvents` RPC method, filtering by the deployed contract ID.

---

### Requirement 5: Settlement Overdue Alert

**User Story:** As an operator, I want to be alerted when a pool has not been settled within the expected time after expiry, so that I can investigate and manually trigger settlement if needed.

#### Acceptance Criteria

1. WHEN a pool's `health_state` is `stuck`, THE Alert_Engine SHALL fire a `settlement_overdue` alert for that pool.
2. THE `settlement_overdue` alert payload SHALL include: `rule`, `pool_id`, `pool_title`, `expiry`, `grace_period_secs`, `overdue_by_secs`, and `severity` set to `"warning"`.
3. WHERE the operator configures a Grace_Period, THE Alert_Engine SHALL use that value (in seconds) as the threshold; the default Grace_Period SHALL be 3600 seconds (1 hour).
4. THE Alert_Engine SHALL not re-fire a `settlement_overdue` alert for the same pool within 1 hour of the previous firing for that pool.

---

### Requirement 6: Sudden TVL Drop Alert

**User Story:** As an operator, I want to be alerted when a pool's TVL drops sharply in a short window, so that I can detect potential exploits or mass cancellations.

#### Acceptance Criteria

1. WHEN a pool's TVL decreases by more than the configured TVL drop threshold percentage within the configured TVL drop window, THE Alert_Engine SHALL fire a `tvl_drop` alert for that pool.
2. THE `tvl_drop` alert payload SHALL include: `rule`, `pool_id`, `pool_title`, `previous_tvl_stroops`, `current_tvl_stroops`, `drop_pct`, `window_secs`, and `severity` set to `"critical"`.
3. WHERE the operator configures a TVL drop threshold, THE Alert_Engine SHALL use that value as the percentage threshold; the default threshold SHALL be 10 percent.
4. WHERE the operator configures a TVL drop window, THE Alert_Engine SHALL use that value (in seconds) as the observation window; the default window SHALL be 300 seconds (5 minutes).
5. THE Alert_Engine SHALL not re-fire a `tvl_drop` alert for the same pool within 5 minutes of the previous firing for that pool.

---

### Requirement 7: High Error Rate Alert

**User Story:** As an operator, I want to be alerted when a pool's transaction error rate exceeds a threshold, so that I can investigate contract or RPC issues.

#### Acceptance Criteria

1. WHEN a pool's `error_rate_pct` exceeds the configured error rate threshold, THE Alert_Engine SHALL fire a `high_error_rate` alert for that pool.
2. THE `high_error_rate` alert payload SHALL include: `rule`, `pool_id`, `pool_title`, `error_rate_pct`, `threshold_pct`, `window_secs`, and `severity` set to `"warning"`.
3. WHERE the operator configures an error rate threshold, THE Alert_Engine SHALL use that value as the percentage threshold; the default threshold SHALL be 5 percent.
4. THE Alert_Engine SHALL evaluate the error rate over a rolling 1-hour window.
5. THE Alert_Engine SHALL not re-fire a `high_error_rate` alert for the same pool within 1 hour of the previous firing for that pool.

---

### Requirement 8: Oracle Price Deviation Alert

**User Story:** As an operator, I want to be alerted when the oracle price used by a pool deviates significantly from a secondary price source, so that I can detect stale or manipulated oracle data.

#### Acceptance Criteria

1. WHEN a pool has an associated oracle price and the absolute percentage difference between the primary oracle price and the secondary price source exceeds the configured deviation threshold, THE Alert_Engine SHALL fire an `oracle_price_deviation` alert for that pool.
2. THE `oracle_price_deviation` alert payload SHALL include: `rule`, `pool_id`, `pool_title`, `primary_price`, `secondary_price`, `deviation_pct`, `threshold_pct`, and `severity` set to `"critical"`.
3. WHERE the operator configures an oracle deviation threshold, THE Alert_Engine SHALL use that value as the percentage threshold; the default threshold SHALL be 2 percent.
4. WHERE the operator configures a secondary price source URL, THE Alert_Engine SHALL fetch the reference price from that URL; IF no secondary source is configured, THEN THE Alert_Engine SHALL skip oracle deviation checks.
5. THE Alert_Engine SHALL not re-fire an `oracle_price_deviation` alert for the same pool within 15 minutes of the previous firing for that pool.

---

### Requirement 9: Webhook Notification Delivery

**User Story:** As an operator, I want alerts to be delivered to a configurable webhook endpoint, so that I can receive notifications in Slack, Telegram, or any HTTP-capable system.

#### Acceptance Criteria

1. WHEN the Alert_Engine fires an alert, THE Notification_Service SHALL send an HTTP POST request to the configured webhook URL with the alert payload serialized as JSON.
2. THE Notification_Service SHALL include an `X-Predinex-Signature` header containing `sha256=<hmac>` where `<hmac>` is the HMAC-SHA256 hex digest of the request body computed using the configured webhook secret.
3. THE Notification_Service SHALL include an `X-Predinex-Alert-Rule` header containing the alert rule name.
4. IF the webhook endpoint returns a non-2xx HTTP status code, THEN THE Notification_Service SHALL retry the delivery up to 3 times with exponential backoff starting at 5 seconds.
5. IF all retry attempts fail, THEN THE Notification_Service SHALL log the failure with the alert rule, pool ID, final HTTP status code, and timestamp.
6. WHERE the operator configures multiple webhook URLs, THE Notification_Service SHALL deliver each alert to all configured endpoints independently.
7. THE Notification_Service SHALL deliver each alert within 10 seconds of the Alert_Engine firing it under normal network conditions.
8. WHERE the operator configures a Slack-compatible webhook URL, THE Notification_Service SHALL format the alert payload as a Slack Block Kit message in addition to the standard JSON body.

---

### Requirement 10: Alert Configuration

**User Story:** As an operator, I want to configure alert thresholds and webhook endpoints via environment variables or a configuration file, so that I can tune the system without code changes.

#### Acceptance Criteria

1. THE Health_Monitor SHALL read alert thresholds and webhook settings from environment variables at startup, using the documented defaults when variables are absent.
2. THE Health_Monitor SHALL support the following environment variables: `MONITORING_POLL_INTERVAL_SECS`, `MONITORING_GRACE_PERIOD_SECS`, `MONITORING_TVL_DROP_THRESHOLD_PCT`, `MONITORING_TVL_DROP_WINDOW_SECS`, `MONITORING_ERROR_RATE_THRESHOLD_PCT`, `MONITORING_ORACLE_DEVIATION_THRESHOLD_PCT`, `MONITORING_WEBHOOK_URLS` (comma-separated list), `MONITORING_WEBHOOK_SECRET`, and `MONITORING_SECONDARY_ORACLE_URL`.
3. IF an environment variable is set to a value outside its valid range, THEN THE Health_Monitor SHALL log a descriptive error at startup and use the documented default value for that variable.
4. THE Health_Monitor SHALL expose a `GET /api/health/config` endpoint that returns the currently active configuration (with the webhook secret redacted) so operators can verify settings without restarting the service.

---

### Requirement 11: Health Dashboard

**User Story:** As an operator, I want a web dashboard that shows real-time pool health status, recent alerts, and per-pool details, so that I can monitor the platform at a glance.

#### Acceptance Criteria

1. THE Health_Dashboard SHALL be accessible at the `/monitoring` route within the existing Next.js web application.
2. THE Health_Dashboard SHALL display a summary panel showing: total active pool count, count of pools in each health state, and the timestamp of the last successful metrics collection.
3. THE Health_Dashboard SHALL display a pool status table listing all pools returned by `GET /api/health/pools`, with columns for pool ID, title, health state, TVL, error rate, and active alerts.
4. THE Health_Dashboard SHALL display an alerts timeline showing the 50 most recent alerts in reverse chronological order, with each entry showing: timestamp, rule name, pool ID, pool title, severity, and key metric values.
5. WHEN an operator clicks a pool row in the status table, THE Health_Dashboard SHALL display a per-pool detail panel showing: full Pool_Metric history for the last 24 hours, all alerts fired for that pool in the last 24 hours, and a link to the pool's market page.
6. THE Health_Dashboard SHALL auto-refresh its data every 30 seconds without requiring a full page reload.
7. THE Health_Dashboard SHALL visually distinguish alert severity levels: `critical` alerts SHALL be displayed with a red indicator and `warning` alerts SHALL be displayed with a yellow indicator.
8. THE Health_Dashboard SHALL be deployable alongside the existing web frontend without requiring additional infrastructure beyond the Next.js application.

---

### Requirement 12: Alert History Persistence

**User Story:** As an operator, I want alert history to be persisted across service restarts, so that I can review past incidents without losing data.

#### Acceptance Criteria

1. THE Health_Monitor SHALL persist fired alerts to a configurable storage backend; the default backend SHALL be an in-process in-memory store with a maximum of 1000 entries (oldest entries evicted first).
2. WHERE the operator configures a file-based persistence path via `MONITORING_ALERT_LOG_PATH`, THE Health_Monitor SHALL append each fired alert as a newline-delimited JSON record to that file.
3. THE Health_Monitor SHALL expose a `GET /api/health/alerts` endpoint that returns the most recent alerts up to a configurable limit (default 50, maximum 500), accepting an optional `?limit=<n>` query parameter.
4. WHEN `GET /api/health/alerts` is called with a `?pool_id=<id>` query parameter, THE Health_Monitor SHALL return only alerts for that pool.
5. WHEN `GET /api/health/alerts` is called with a `?rule=<name>` query parameter, THE Health_Monitor SHALL return only alerts matching that rule name.

---

### Requirement 13: Documentation

**User Story:** As an operator, I want documentation on configuring alert thresholds and deploying the monitoring system, so that I can set it up correctly without reading source code.

#### Acceptance Criteria

1. THE Health_Monitor SHALL include a `docs/MONITORING.md` file that documents: all supported environment variables with their types, valid ranges, and defaults; the alert rule names, their trigger conditions, and default thresholds; the webhook payload schema for each alert rule; and instructions for verifying the HMAC-SHA256 signature.
2. THE Health_Monitor SHALL include example webhook receiver code (in the documentation) for Slack and Telegram showing how to parse and display alert payloads.
3. THE `docs/MONITORING.md` file SHALL include a step-by-step deployment guide for running the monitoring system alongside the existing Next.js frontend.
