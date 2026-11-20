# ADR-0002: Event indexing

## Status
Accepted

## Context
The system emits Soroban events for key actions (pool creation, bets, settlement). Consumers (indexers, bots, analytics) need a stable, documented event schema to reliably parse and process these events without breaking on contract updates.

## Proposal
We chose a versioned event schema with well-defined topics and payload fields. Events include the pool id, relevant addresses, amounts, and metadata required for downstream processing. The event indexing strategy favors stable keys and forward-compatible field additions.

## Decision
Adopt the event structure and indexing conventions documented in CONTRACT_API.md and implemented in the contract (e.g. events.rs). Indexers should filter by contract id and event topics, and handle unknown fields gracefully.

## Consequences
- Decouples off-chain consumers from internal storage layout.
- Enables reliable replay and auditability of market activity.
- Requires care when renaming fields or changing types.

## References
- contracts/predinex/src/events.rs
- docs/CONTRACT_API.md
- docs/INCIDENT_RUNBOOK.md
