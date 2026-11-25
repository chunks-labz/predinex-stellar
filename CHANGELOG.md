
All notable changes to Predinex Stellar are documented here.
Entries are grouped by delivery area so each stakeholder can scan the section relevant to them.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions follow [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### ⛓ Contract
- LP liquidity deposits now credit the balance actually received from fee-on-transfer collateral tokens, so recorded pool liquidity matches the contract's real token balance (#1597)
- Added regression coverage for partial-fill batch settlement and idempotent batch payouts (#1598)
- Added resolver coverage that malformed resolution-spec commitments revert before any market state changes (#1599)
- Added the missing contract-wide pause guard to `claim_all_winnings` and audited privileged writes with a shared pause-guard test table (#1600)
- `contracts/pool` now compiles and runs its test suite: 12 tests covering `extend_duration` (auth, expiry, max-duration cap, frozen/disputed, boundaries, and event emission) previously never ran because the module failed to compile. Three separate breakages were blocking it — a stale `ContractEvents` destructuring, a hardcoded `protocol_version: 20` below the host minimum of 22, and a storage fixture written outside a contract frame (closes #1305)
- Added a CI assertion that fails when a crate declares `#[test]` functions that `cargo test` never compiles or runs. This is the failure mode behind #1305: `cargo test --workspace` was green while `contracts/pool` contributed zero tests
- Removed `contracts/pool/src/test.rs` and `contracts/pool/src/test/` (1554 lines). Both were unreachable from the crate graph and referenced APIs that do not exist (`PoolDataKey`, `client.init`, `get_pool_expiry`) and two test frameworks that are not dependencies (`soroban_test`, `soroban_test_framework`)
- `MAX_POOL_DURATION_SECS`'s doc comment said 1,000,000 seconds while the value is 365 days; the max-duration boundary tests had been written against the stale number and were asserting nothing. They now derive from the constant
- `test_expiry_must_be_future` asserted `PoolError::ExpiryMustBeFuture`, which is unreachable — the expiry and increase checks together make it impossible. Renamed to `test_past_expiry_is_rejected` and pinned to the reachable behaviour
- Emit `ClaimWinnings` event on successful claim with topics `(Symbol("claim_winnings"), pool_id, claimant)` and `ClaimEvent` payload containing payout amount, fee amount, winning outcome, and total pool size (#585)
- Event is gated behind a successful payout — no event emitted when `user_winning_bet == 0` or the call fails
- Added tests `l5` and `m4` verifying event topics and data match actual payout amounts
- Add `get_total_user_claims(user)` read method returning cumulative winnings claimed by a user across all pools (covers single-asset, multi-asset, batch, and scheduled claim paths)
- Add `get_user_claim_history(user, start_cursor, limit)` paginated read method returning up to 50 recent claim entries with pool_id, amount, fee, timestamp, and winning_outcome
- New `DataKey::UserTotalClaimed(Address)` and `DataKey::UserClaimHistory(Address)` storage entries updated atomically after each successful claim
- `extend_pool_duration` now rejects any single extension larger than `MAX_EXTENSION_SECS` (30 days) with `DurationTooLong`, so a creator can no longer push a market out by months in one call; the existing total-lifetime cap from `created_at` still applies
- `rescue_tokens` now rejects `amount <= 0` with `InvalidWithdrawalAmount` instead of forwarding a zero or negative value to the token client
- `get_leaderboard` now returns `Result<Vec<PoolLeaderboardEntry>, ContractError>` and fails with the new `InvalidLeaderboardCursor` when the supplied cursor is not in the entry list, instead of silently answering with page 1 (closes #1176)
- Non-positive trade and liquidity-deposit amounts are now pinned by typed regression tests to `InvalidBetAmount` and `InvalidLpAmount` across the single-asset, referral, multi-asset, and liquidity paths (#1678)
- Added a configurable per-market position cap via `set_pool_position_cap`/`get_pool_position_cap`; trades that would push a user over the cap now revert with `ExposureLimitExceeded` (#1679)

### 🤖 Bot
- Bounded the poller's consecutive-failure map: counts are capped at `MAX_FAILURE_COUNT` (10), after which the pool is escalated once and evicted, and every cycle prunes entries for pools that have left the active expired-unsettled scan
- Added `trackedFailurePools` to `/health/metrics` so the map's size is observable
- Fixed a syntax error in `checkRpcHealth`'s return type that broke `tsc` and prevented `poller.test.ts` from loading

### 🌐 Web
- Betting-history sort headers are native buttons with keyboard support, direction-bearing accessible names and `aria-sort` state (#1661)
- Added `GET /api/version`: unauthenticated, secret-free build and contract metadata (commit, build time, contract ID and network, contract crate, event-schema and state versions). The preview deployment smoke test now fails if the deployment reports a different commit than the one just built (#1665)
- The odds chart on the market and pool pages has a text alternative naming both outcomes and their current odds, and a polite live region that announces only changes of at least 1 percentage point, after the odds have been still for 1.5 s, so polling doesn't chatter (#1662)
- Updated `getMarkets` and `fetchAllPools` to use the corrected pool count from `get_pool_count`
- `/api/export/transactions` now requires the caller's wallet identity (`x-predinex-wallet-address`) and rejects exports for any other address, and it rate limits on the client IP (30/hour) in addition to the per-wallet bucket (10/hour) so walking a list of target addresses can no longer reset the counter (closes #1177)
- Added `clientIpFromHeaders()` to the shared rate-limit helper for routes that need a caller identity they cannot vary per request
- Transaction history now shows an empty state with an "Explore Markets" CTA (or "Clear filters") and never renders skeleton rows for an empty response; client-side navigation announces the page title and focuses the main heading (#1684, #1685)

### 📖 Docs
<!-- README, RELEASE, architectural docs, inline documentation -->
- Added graceful shutdown runbook and smoke check guide (`docs/GRACEFUL_SHUTDOWN.md`) (#1689)
- Added backup restore drill documentation covering local execution via Docker or PostgreSQL and CI automation (`docs/BACKUP_RESTORE_DRILL.md`) (#1688)
- Added comprehensive preview deployment documentation (`docs/preview-deployments.md`)
- Added quick start guide for preview deployment setup in `docs/preview-deployments.md`
- Updated README with preview deployment information
- Added indexer lag and oracle feed freshness monitoring docs with alert metadata, thresholds, and incident response steps (#1686, #1687)

### ⚙️ Ops & CI
<!-- GitHub Actions workflows, scripts/, tooling, dependency updates -->
- Added graceful shutdown smoke check script (`scripts/check-graceful-shutdown.py`) that sends SIGTERM, verifies clean exit with code 0, checks for hanging workers and unclosed socket connections, and records structured audit records in deployment logs (`deployments/shutdown-smoke.log`) (#1689)
- Server HTTP bootstrap in `api/src/server.ts` closes idle keep-alive connections on SIGTERM to allow in-flight requests to complete without blocking shutdown (#1689)
- Added database backup restore drill (`scripts/drill-backup-restore.sh` and `db/fixtures/latest_backup.sql`) and CI gate job `backup-restore-drill` in `.github/workflows/ci.yml`, verifying schema and representative rows for indexer state, pools, bets, and claims (#1688)
- Failed on-chain market creation from `POST /api/markets` is now recorded with non-sensitive metadata (category, contract error code, correlation ID, request shape), logged as `market_creation_failed`, and raises one `market_creation_failure_alert` when failures repeat; admins can read the state at `GET /api/markets/admin/creation-failures`. Triage steps are in `docs/MARKET_CREATION_MONITORING.md` (#1664)
- The migration rollback gate (`scripts/verify-migrations.sh`) now applies, rolls back and re-applies each migration on its own and names the one that fails. It fails on a missing, empty or orphaned `.down.sql` and on files marked `-- irreversible`, ignores the random `\restrict` key newer `pg_dump` releases add, and has its own tests in the CI job. `docs/MIGRATIONS.md` covers running it locally (#1663)
- Added automated preview deployment workflow for pull requests (`.github/workflows/preview-deploy.yml`)
- Preview deployments automatically post URLs to PR comments
- Added PR template with preview deployment checklist
- Added preview deployment issue template
- Added setup script for configuring preview deployments (`scripts/setup-preview-deployments.sh`)
- Added Vercel configuration file (`web/vercel.json`)
- Fixed `tag-release.yml` to use `PAT_TOKEN` instead of `GITHUB_TOKEN` so tag pushes trigger downstream CI workflows (closes #600)
- Regenerated `web/package-lock.json` so it is back in sync with `web/package.json`; `npm ci` was failing outright, which broke the install step of every workflow that builds `web/` and left the `actions/setup-node` npm cache unusable
- Dependabot now also covers `/bot`, `/api` (npm) and the root Cargo workspace in addition to `/web` and `/contracts/predinex`, with the same weekly non-major grouping (closes #1174)
- Stale bot no longer marks Stellar Wave issues (`wave` / `drips-wave`) as stale or auto-closes them after 37 days (closes #1175)
- Oracle TWAP aggregation now rejects an empty or fully-aged-out sample window, a zero/non-finite total liquidity, and a non-finite TWAP or spot price via a typed `PriceValidationError` with a machine-readable `code`, instead of returning `Infinity`/`NaN` or crashing on an undefined sample (closes #1307)
- Oracle `addSample` now also rejects `NaN`/`Infinity` prices and liquidity weights, which previously passed the `<= 0` check and poisoned every downstream average
- Added admin observability endpoints with Prometheus gauges for chain/indexed ledger heights and per-feed oracle freshness, plus one-shot `indexer_lag_alert` and `stale_oracle_feed_alert` structured alerts (#1686, #1687)
- `oracle/` is now type-checked by the API build and its tests are collected by the API vitest run, so oracle regressions fail CI instead of sitting unexecuted (closes #1307)

---

## [v0.1.0] - 2026-04-25

### ⛓ Contract
- Initial Clarity prediction-market contract with pool creation, betting, and settlement logic.

### 🌐 Web
- Next.js frontend with wallet connection (Stacks/WalletConnect), market browsing, and dashboard.
- Dispute resolution UI with community voting.
- Lazy-loaded route bundles for `/dashboard` and `/disputes` to reduce initial JS weight.

### 📖 Docs
- `RELEASE.md` release checklist and version-tagging guide.
- `web/docs/` — AppKit integration, contract events, contract versioning, market-list caching, route chunking.

### ⚙️ Ops & CI
- GitHub Actions: `ci.yml` (build + lint), `security-audit.yml`, `tag-release.yml`.
- Dependency caching strategy documented in `web/DEVELOPMENT.md`.
