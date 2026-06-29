# Testnet rollback runbook

If `deploy-testnet.yml` lands a contract that fails its smoke test or is later
discovered to be broken, the rollback is to point clients back at the previous
known-good contract ID and redeploy a fixed contract when ready.

## 1. Find the previous good contract ID

Pick whichever is easier:

- Scroll back through "Testnet deploy" PR comments on `main` for the most recent
  ✅ Success entry. The comment carries the contract ID.
- Open the previous `Deploy contract to testnet` workflow run in GitHub Actions
  and download the `deployment-manifest` artifact. `deployment.json` carries
  `contract_id` and the commit that produced it.

## 2. Repoint the frontend

The web app reads the contract ID from `NEXT_PUBLIC_PREDINEX_CONTRACT_ID` (set
per-environment in the Vercel/preview deployment configuration).

1. Open the hosting provider's environment settings for testnet.
2. Replace `NEXT_PUBLIC_PREDINEX_CONTRACT_ID` with the previous contract ID.
3. Trigger a redeploy of the frontend.

## 3. Decide on the broken contract

Soroban testnet contracts can be left in place — they are isolated and the
problem is purely a frontend pointer issue. The broken contract is now orphaned.

## 4. Fix and redeploy

When a fix is ready:

1. Land the fix in `main`.
2. `Run workflow` on the `Deploy contract to testnet` action (the manual
   `workflow_dispatch` trigger) to ship a corrected deployment.
3. Verify the smoke test passes, then update the frontend env var to the new
   contract ID.

## 5. Optional: post a follow-up

Open an issue summarising what broke, with links to the failing workflow run
and the previous + new contract IDs, so the fix is auditable.
