
All notable changes to Predinex Stellar are documented here.
Entries are grouped by delivery area so each stakeholder can scan the section relevant to them.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions follow [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### ⛓ Contract
- Emit `ClaimWinnings` event on successful claim with topics `(Symbol("claim_winnings"), pool_id, claimant)` and `ClaimEvent` payload containing payout amount, fee amount, winning outcome, and total pool size (#585)
- Event is gated behind a successful payout — no event emitted when `user_winning_bet == 0` or the call fails
- Added tests `l5` and `m4` verifying event topics and data match actual payout amounts
- Add `get_total_user_claims(user)` read method returning cumulative winnings claimed by a user across all pools (covers single-asset, multi-asset, batch, and scheduled claim paths)
- Add `get_user_claim_history(user, start_cursor, limit)` paginated read method returning up to 50 recent claim entries with pool_id, amount, fee, timestamp, and winning_outcome
- New `DataKey::UserTotalClaimed(Address)` and `DataKey::UserClaimHistory(Address)` storage entries updated atomically after each successful claim

### 🌐 Web
- Updated `getMarkets` and `fetchAllPools` to use the corrected pool count from `get_pool_count`

### 📖 Docs
<!-- README, RELEASE, architectural docs, inline documentation -->
- Added comprehensive preview deployment documentation (`docs/preview-deployments.md`)
- Added quick start guide for preview deployment setup in `docs/preview-deployments.md`
- Updated README with preview deployment information

### ⚙️ Ops & CI
<!-- GitHub Actions workflows, scripts/, tooling, dependency updates -->
- Added automated preview deployment workflow for pull requests (`.github/workflows/preview-deploy.yml`)
- Preview deployments automatically post URLs to PR comments
- Added PR template with preview deployment checklist
- Added preview deployment issue template
- Added setup script for configuring preview deployments (`scripts/setup-preview-deployments.sh`)
- Added Vercel configuration file (`web/vercel.json`)
- Fixed `tag-release.yml` to use `PAT_TOKEN` instead of `GITHUB_TOKEN` so tag pushes trigger downstream CI workflows (closes #600)

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
