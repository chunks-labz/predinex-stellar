# Release Notes Template

This file is the canonical template for Predinex release notes. Copy it for each release, fill in the placeholders, and delete any section with no entries. Completed release notes are added to [`CHANGELOG.md`](../CHANGELOG.md) and published to the GitHub release page.

For the tagging and release process, see [`RELEASE.md`](../RELEASE.md).

---

## How to use this template

1. Copy everything from the `---` below through the end of the file.
2. Create a new section at the top of `CHANGELOG.md` using the copied content.
3. Replace all `<!-- placeholders -->` and `[vX.Y.Z]` / `[YYYY-MM-DD]` markers.
4. Delete every section heading that has no bullet points.
5. Add the GitHub release link at the bottom once the tag is published.

---

<!--
=============================================================
  COPY FROM HERE
=============================================================
-->

## [vX.Y.Z] - YYYY-MM-DD

> **Summary:** One-sentence description of the most significant change in this release.

### ⛓ Contract

> Changes to Soroban contracts in `contracts/`.

- <!-- Added/changed/fixed: describe what changed and why. Reference the issue or PR number. -->

### 🌐 Web

> Changes to the Next.js frontend in `web/`.

- <!-- Added/changed/fixed: ... -->

### 🤖 Bot

> Changes to the off-chain settlement bot in `bot/`.

- <!-- Added/changed/fixed: ... -->

### 📖 Docs

> README, architectural docs, runbooks, and inline documentation.

- <!-- Added/changed/fixed: ... -->

### ⚙️ Ops & CI

> GitHub Actions workflows, `scripts/`, tooling, and dependency updates.

- <!-- Added/changed/fixed: ... -->

---

### ⚠️ Breaking changes

<!-- List any breaking changes here. If none, delete this section. -->

- **[Component]**: Description of the breaking change, what it affects, and the migration path.

### 🔄 Migration steps

<!-- If there are breaking changes or data migrations, list the steps operators must follow. If none, delete this section. -->

1. <!-- Step 1: e.g., run the migration script -->
2. <!-- Step 2: e.g., redeploy the contract -->
3. <!-- Step 3: e.g., update environment variables -->

---

### ✅ Deployment verification checklist

After deploying this release, run through the following checks:

- [ ] Contract deployed to the target network and `CONTRACT_ID` updated in environment config.
- [ ] `stellar contract invoke --id $CONTRACT_ID --network $NETWORK -- get_admin` returns the expected admin address.
- [ ] `is_paused()` returns `false`.
- [ ] Settlement bot is running and processing expired pools (check `GET /health/metrics`).
- [ ] Web app connects to the correct contract (verify in Settings → Debug → Contract Info).
- [ ] Smoke-test a full market lifecycle on testnet before promoting to mainnet.
- [ ] `GET /api/version` returns the expected commit hash and contract ID.
- [ ] All GitHub Actions workflows are green on the release tag.

### 🔙 Rollback checklist

If the release needs to be reverted:

- [ ] Identify the last known-good version tag.
- [ ] Re-deploy the previous contract WASM if the contract changed (see [`DEPLOYMENT_RUNBOOK.md`](./DEPLOYMENT_RUNBOOK.md) for the redeploy procedure).
- [ ] Revert the bot and web app to the previous release tag.
- [ ] Run the deployment verification checklist against the reverted release.
- [ ] Document the rollback reason in the incident channel and open a follow-up issue.

---

### 📣 Where release notes are published

| Channel | Who | When |
|---|---|---|
| [`CHANGELOG.md`](../CHANGELOG.md) | Merged automatically via PR | On merge to `main` |
| [GitHub Releases](https://github.com/chunks-labz/predinex-stellar/releases) | Protocol lead or release engineer | On version tag push |
| `#predinex-releases` (Discord) | Release engineer | After the GitHub release is published |
| Status page (if applicable) | Ops on-call | For releases that affect mainnet availability |

**GitHub release link:** <!-- https://github.com/chunks-labz/predinex-stellar/releases/tag/vX.Y.Z -->

<!--
=============================================================
  COPY TO HERE
=============================================================
-->

---

## Changelog categories and PR labels

Every PR should carry one `area:` label. GitHub's automatic release notes generator uses `.github/release.yml` to group PRs by label into the same four categories.

| Label | Changelog section | Covers |
|---|---|---|
| `area: contract` | ⛓ Contract | `contracts/` — Rust source, tests, deployment scripts |
| `area: web` | 🌐 Web | `web/` — Next.js pages, components, hooks, styles |
| `area: docs` | 📖 Docs | `*.md` files, `web/docs/`, inline code comments |
| `area: ops` | ⚙️ Ops & CI | `.github/`, `scripts/`, tooling, dependency bumps |

The `bot` changes fall under `area: ops` unless a dedicated label is added. Cross-area PRs should carry the label for the primary change area. `bug` and `enhancement` can be added alongside an `area:` label.

---

## Related documents

- [`CHANGELOG.md`](../CHANGELOG.md) — full history of releases
- [`RELEASE.md`](../RELEASE.md) — release checklist and version-tagging guide
- [`DEPLOYMENT_RUNBOOK.md`](./DEPLOYMENT_RUNBOOK.md) — build, deploy, and verify steps
- [`ADMIN_RECOVERY_PROCEDURES.md`](./ADMIN_RECOVERY_PROCEDURES.md) — rollback and recovery steps
