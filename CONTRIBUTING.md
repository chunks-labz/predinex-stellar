# Contributing to Predinex Stellar

Welcome, and thank you for your interest in contributing! This guide covers everything you need to go from a clean checkout to an open pull request: local setup, running checks, documentation standards, and the issue workflow.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Local Setup](#2-local-setup)
3. [Running Web Checks](#3-running-web-checks)
4. [Running Contract Checks](#4-running-contract-checks)
5. [Documentation Standards](#5-documentation-standards)
6. [Issue and PR Workflow](#6-issue-and-pr-workflow)
7. [CI Expectations](#7-ci-expectations)
8. [Automated Dependency Updates (Dependabot)](#8-automated-dependency-updates-dependabot)

---

## 1. Prerequisites

| Tool | Minimum version | Notes |
|------|----------------|-------|
| Node.js | 18 | 22 is used in CI |
| npm | 8 | **Do not use pnpm or yarn** — it creates lockfile conflicts |
| Rust + Cargo | stable (1.74+) | Install via [rustup.rs](https://rustup.rs) |
| `wasm32-unknown-unknown` | — | `rustup target add wasm32-unknown-unknown` |
| Stellar CLI | 21+ | [Installation guide](https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup) |
| Freighter wallet | latest | [freighter.app](https://www.freighter.app) — browser extension for UI testing |

Run the bootstrap script to verify everything is installed:

```bash
./scripts/bootstrap.sh
```

---

## 2. Local Setup

### Clone and install

```bash
git clone <repository-url>
cd predinex-stellar

# Install web dependencies
cd web
npm install
cd ..
```

### Environment variables

Create `web/.env.local` with:

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_NETWORK=testnet
NEXT_PUBLIC_SOROBAN_CONTRACT_ID=<testnet-contract-C-strkey>
```

The contract address for the shared testnet deployment is in `web/.env.example`. For a local deployment, follow the [Local End-to-End Runbook](./docs/local-runbook.md).

### Start the development server

```bash
cd web
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## 3. Running Web Checks

All three checks must pass before opening a PR. Run them from the `web/` directory:

```bash
# Lint
npm run lint

# Unit tests (single run, matches CI)
npm test -- --run

# Production build
npm run build
```

### Test suite

Tests live in `web/tests/` and use [Vitest](https://vitest.dev/) with React Testing Library.

| Directory | What it covers |
|-----------|---------------|
| `tests/components/` | React component behaviour |
| `tests/routes/` | Route-level smoke tests — verifies every top-level App Router page mounts without crashing |
| `tests/lib/` | API client and utility functions |
| `tests/helpers/` | Shared render helpers (`renderWithProviders`) |
| `tests/integration/` | Cross-cutting integration scenarios |

Run a single file during development:

```bash
npm test -- --run tests/routes/smoke.test.tsx
```

Run in watch mode while iterating:

```bash
npm test -- --watch
```

Run with coverage:

```bash
npm run test:coverage
```

**When adding a new top-level route**, add a smoke test entry to `tests/routes/smoke.test.tsx` so CI catches broken imports or missing providers at the route level.

---

## 4. Running Contract Checks

Run these from `contracts/predinex/`:

```bash
# Format check
cargo fmt --check

# Lint
cargo clippy -- -D warnings

# Unit tests
cargo test
```

To build the WASM artifact:

```bash
stellar contract build
```

The compiled output lands at `contracts/predinex/target/wasm32-unknown-unknown/release/predinex.wasm`.

For a full local deploy-to-testnet walkthrough, see the [Local End-to-End Runbook](./docs/local-runbook.md).

---

## 5. Documentation Standards

### Code comments

Only add a comment when the **why** is non-obvious — a hidden constraint, a subtle invariant, or a workaround for a specific bug. Do not comment on what the code does; well-named identifiers already do that.

### JSDoc

Add JSDoc to exported utility functions and complex hooks. One short summary line is enough; avoid multi-paragraph blocks.

### Architecture docs

Significant architectural decisions (new caching strategies, contract interface changes, new hooks) belong in `web/docs/`. Reference them from `web/DEVELOPMENT.md` or `web/FRONTEND.md` as appropriate.

### Contract interface changes

Any change that touches the contract state or upgrade flow must follow the process in [docs/CONTRACT_UPGRADE_PROCEDURE.md](./docs/CONTRACT_UPGRADE_PROCEDURE.md). Breaking changes require an explicit version bump, a migration plan, and testnet verification before the PR can be merged.

---

## 6. Issue and PR Workflow

### Picking up an issue

1. Comment on the issue to let others know you are working on it.
2. Fork the repository and clone your fork.
3. Create a branch from `main` using the convention below.

### Branch naming

```
<type>/<short-description>
```

Examples:

- `feat/route-smoke-tests`
- `fix/market-pagination-reset`
- `docs/contributing-guide`
- `refactor/wallet-adapter-cleanup`

### Commit messages

Write imperative-mood subject lines under 72 characters. Put context in the body when needed.

```
feat: add smoke tests for all top-level App Router routes

Covers home, markets, create, dashboard, disputes, rewards,
activity, and incentives. Uses a shared provider harness so
route-level provider failures are caught independently of the
component suite.
```

### Pull request checklist

Before marking a PR ready for review:

- [ ] `npm run lint` passes
- [ ] `npm test -- --run` passes (no new failures)
- [ ] `npm run build` succeeds
- [ ] Contract checks pass if contract files were touched (`cargo fmt --check`, `cargo clippy`, `cargo test`)
- [ ] PR description references the issue number(s) with `Closes #<number>`
- [ ] New top-level routes include a smoke test entry in `tests/routes/smoke.test.tsx`
- [ ] New architectural decisions are documented in `web/docs/`

### PR description template

The repository provides a pull request template at `.github/PULL_REQUEST_TEMPLATE.md`. Fill it in completely — incomplete descriptions slow down review.

---

## 7. CI Expectations

The CI workflow (`.github/workflows/ci.yml`) runs on every push and pull request to `main`. It includes:

| Job | Steps |
|-----|-------|
| **Web Checks** | `npm ci` → `npm run lint` → `npm test -- --run` → `npm run build` |
| **Bundle size budget** | Checked on PRs; fails if JS exceeds 350 KB, CSS exceeds 80 KB, or total static exceeds 500 KB |
| **Contract Checks** | `cargo fmt --check` → `cargo clippy -- -D warnings` → `cargo test` |

Run all of these locally before pushing to avoid CI failures blocking your PR.

---

For deeper context on the project architecture, see:

- [Frontend Development Guide](./web/DEVELOPMENT.md)
- [Frontend Architecture](./web/FRONTEND.md)
- [Local End-to-End Runbook](./docs/local-runbook.md)
- [Release Process](./RELEASE.md)

---

## 8. Automated Dependency Updates (Dependabot)

Dependabot is configured in [`.github/dependabot.yml`](./.github/dependabot.yml) and opens pull requests weekly for both package ecosystems:

| Ecosystem | Directory | Label |
|-----------|-----------|-------|
| npm | `/web` | `dependencies`, `npm` |
| Cargo | `/contracts/predinex` | `dependencies`, `cargo` |

### Merge policy

The auto-merge workflow in [`.github/workflows/dependabot-auto-merge.yml`](./.github/workflows/dependabot-auto-merge.yml) handles PRs as follows:

| Update type | Action |
|-------------|--------|
| **Patch** (`x.y.Z`) | Auto-approved and auto-merged once CI passes — no human action needed |
| **Minor** (`x.Y.z`) | Auto-merged once CI passes — review is optional |
| **Major** (`X.y.z`) | PR opened but **not** auto-merged; requires human review and approval |

Patch and minor updates are grouped into a single weekly PR per ecosystem so the review queue stays manageable. Major version bumps always arrive as separate PRs to make breaking-change review straightforward.

If a Dependabot PR sits in CI failure, investigate the failure before merging — do not re-trigger or skip checks.
