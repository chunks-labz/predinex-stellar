# Stellar Wave Program

This document serves as the single source of truth for the **Stellar Wave** program, the area taxonomy used for issue triage, and the workflow for accepting, labeling, and closing Wave-related issues.

---

## What is the Stellar Wave Program?

The **Stellar Wave** program is a community-driven initiative sponsored by the Stellar Development Foundation (SDF) to accelerate development of the Predinex protocol on the Stellar network. The program provides:

- **Bounties and incentives** for resolving high-priority issues
- **Structured issue taxonomy** to route contributors to the right area of expertise
- **Automated triage** using GitHub labels and workflows
- **Application limits** to prevent bottlenecks and ensure equitable distribution of work

Contributors apply to work on open Wave issues, submit pull requests, and receive rewards upon successful merge. The program is managed through GitHub labels, automation bots, and this repository's CI/CD infrastructure.

---

## Area Taxonomy

Every issue eligible for the Wave program **must carry exactly one `area:` label**. The area taxonomy maps issues to logical subsystems, helping contributors find work that matches their expertise and enabling maintainers to route reviews efficiently.

### Core Areas

| Label | Scope | Examples |
|-------|-------|----------|
| `area: contract` | Smart contract logic, state management, business rules | Pool creation, bet placement, settlement, fee calculations, event emissions, storage optimization |
| `area: web` | Frontend UI, hooks, API clients, styling, routing | Market cards, wallet integration, responsive layouts, form validation, data fetching hooks |
| `area: docs` | Documentation, guides, runbooks, architecture decision records | README updates, JSDoc additions, contributing guides, API reference, architecture docs |
| `area: ops` | CI/CD, deployment automation, tooling, infrastructure-as-code | GitHub Actions workflows, build scripts, Makefile targets, Docker configs, monitoring dashboards |

### Area Assignment Rules

1. **Exactly one area per issue.** Multi-area issues should be split or labeled with the **primary** impacted subsystem.
2. **Auto-labeled by path.** The `.github/labeler.yml` workflow automatically applies area labels based on changed files. For example:
   - Changes under `contracts/` → `area: contract`
   - Changes under `web/` → `area: web`
   - Changes to `*.md` or `docs/` → `area: docs`
   - Changes to `.github/`, `scripts/`, or `Makefile` → `area: ops`
3. **Manual override.** Maintainers can manually change the area label if the auto-labeler misclassifies an issue.
4. **No area = not Wave-eligible.** Issues without an `area:` label are considered out-of-scope for the Wave program until triaged.

---

## Acceptance Criteria for Wave Issues

For an issue to be eligible for the Wave program, it must meet **all** of the following criteria:

1. **Well-scoped and actionable.** The issue description includes:
   - A clear problem statement or feature request
   - Acceptance criteria that define "done"
   - Enough context for a contributor to implement a solution without extensive back-and-forth

2. **Labeled with exactly one `area:` tag.** The issue must be categorized into one of the four core areas (`area: contract`, `area: web`, `area: docs`, or `area: ops`).

3. **Not blocked by upstream dependencies.** The issue can be resolved independently, without waiting for another issue to be closed first. If dependencies exist, they should be documented in the issue body.

4. **Aligned with the roadmap.** The issue addresses a feature, bug, or improvement that maintainers have prioritized. Ad-hoc requests that conflict with the roadmap will be closed with a polite explanation.

5. **Triaged by a maintainer.** A maintainer has reviewed the issue, confirmed it's valid, and added it to the Wave program backlog. This is typically indicated by the presence of the `wave` label (if one exists) or explicit assignment to a milestone.

---

## Triage and Auto-Close Process

### Issue Lifecycle

1. **Submission.** A contributor or maintainer opens an issue using one of the templates in `.github/ISSUE_TEMPLATE/`.
2. **Auto-labeling.** The Labeler workflow (`.github/workflows/labeler.yml`) applies an `area:` label based on the issue's linked files or changed paths in associated PRs.
3. **Manual triage.** A maintainer reviews the issue, confirms the area label is correct, and decides whether to accept it into the Wave program.
4. **Wave assignment.** If accepted, the issue is assigned to the current Wave cycle and marked as open for contributors.
5. **Application and work.** Contributors apply to work on the issue (subject to application limits), implement the solution, and submit a PR.
6. **Review and merge.** Maintainers review the PR. If it meets quality standards and closes the issue, it is merged and the contributor is credited.
7. **Auto-close on merge.** The issue is automatically closed when a PR with `Closes #<issue-number>` in the description is merged.

### Auto-Close Rules

An issue will be **auto-closed** by maintainers or bots if:

- **No activity for 30 days** after the last maintainer comment.
- **Duplicate of an existing issue.** The closer should link to the canonical issue.
- **Out of scope.** The issue requests a feature or change that conflicts with the project roadmap or architecture.
- **Insufficient detail.** The issue lacks enough context to be actionable, and the contributor has not responded to requests for clarification within 7 days.
- **Resolved by another PR.** The underlying problem was fixed by a different PR, making the issue obsolete.

When an issue is auto-closed, the bot or maintainer should leave a comment explaining the reason and invite the contributor to reopen if the situation changes.

---

## How Contributors Use This Taxonomy

### Finding issues to work on

1. Browse the [open issues](../../issues) filtered by your preferred `area:` label.
2. Check the acceptance criteria and test considerations in the issue body.
3. Comment on the issue to indicate your interest and check application limits.
4. Fork the repo, create a branch, and implement the solution.
5. Submit a PR referencing the issue with `Closes #<issue-number>`.

### Applying area labels

- **When opening a new issue:** If you know the impacted subsystem, manually add the appropriate `area:` label. If unsure, leave it blank; a maintainer will triage it.
- **When opening a PR:** The Labeler workflow will auto-apply the `area:` label based on changed file paths. Verify it's correct and adjust if needed.

---

## How Maintainers Use This Taxonomy

### Triaging new issues

1. Read the issue description and confirm it meets the [acceptance criteria](#acceptance-criteria-for-wave-issues).
2. Verify or correct the `area:` label. If the Labeler misclassified the issue, manually override it.
3. Decide whether to accept the issue into the current Wave cycle. If yes, add the `wave` label (if it exists) or assign it to a milestone.
4. If the issue is out of scope, close it with a polite explanation and a link to this document.

### Reviewing PRs

1. Confirm the PR references an open issue with `Closes #<issue-number>`.
2. Verify the `area:` label on the PR matches the impacted subsystem.
3. Run the CI checks and manual tests described in the issue's "Test considerations" section.
4. Request changes if needed, or approve and merge if the PR meets quality standards.

### Auditing the backlog

Periodically review the open issues to:

- Close stale issues with no activity.
- Re-triage issues if priorities have changed.
- Split large issues into smaller, Wave-eligible chunks.
- Update the area taxonomy if new subsystems are added.

---

## Updating This Document

This document is versioned in `.github/PROGRAM.md` and should be updated whenever:

- A new `area:` label is added or retired.
- The Wave program rules or application limits change.
- The auto-close criteria are revised.

Changes to this document should go through the standard PR review process and be announced in the project's communication channels (Discord, Slack, or GitHub Discussions).

---

## References

- [Labeler configuration](./labeler.yml) — Auto-labeling rules for `area:` tags
- [Contributing guide](../CONTRIBUTING.md) — Development setup and PR workflow
- [Issue templates](./.github/ISSUE_TEMPLATE/) — Structured issue submission forms
- [Stellar Wave Program Overview](https://stellar.org/wave) — Official SDF documentation (external)

---

**Questions?** Open a discussion in [GitHub Discussions](../../discussions) or reach out to a maintainer in the project's Discord server.
