# Operations and documentation index

- [Production Incident Runbook](./INCIDENT_RUNBOOK.md) — severity, escalation, and copyable playbooks for common production incidents.
- [Paused-Contract Runbook](./PAUSED_CONTRACT_RUNBOOK.md) — detection, caller impact, unpause authorization, and post-incident checks for a globally paused contract.
- [Oracle Key Rotation](./ORACLE_ROTATION.md) — rotating the settlement signer and resolution-oracle credential, with rollback and verification.
- [Fee Schedule and Caps](./FEE_SCHEDULE.md) — every protocol fee, who pays it, and the constant and error code that cap it.
- [Claim Lifecycle](./CLAIM_LIFECYCLE.md) — resolved vs. finalized vs. claimed, and which views report each.
- [Deployment Runbook](./DEPLOYMENT_RUNBOOK.md) — deployment, monitoring, and emergency procedures.
- [Local Runbook](./local-runbook.md) — local end-to-end setup.
- [Structured Logging and Correlation IDs](./LOGGING.md) — JSON log schema and request/job correlation.
- [Environment Variables and Secrets](./ENVIRONMENT_VARIABLES.md) — required web/API/bot variables and GitHub Actions secrets.
- [Failed Market Creation Monitoring](./MARKET_CREATION_MONITORING.md) — what failed `create_market` attempts record, the repeated-failure alert, and triage.
- [Database Migrations and the Rollback Dry Run](./MIGRATIONS.md) — the migration rollback gate and how to run it locally.
