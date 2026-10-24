# ADR-0003: API versioning

## Status
Accepted

## Context
The Predinex API and web interfaces evolve over time. Breaking changes to request/response shapes, endpoints, or error codes must be communicated to integrators and avoid silently corrupting client behavior.

## Decision
Adopt a versioning strategy that is explicit and predictable:
- Soroban contract interfaces follow semantic versioning via the contract versioning policy (see docs/CONTRACT_VERSIONING.md). Breaking changes to public functions require a version bump and migration guidance.
- HTTP/web APIs and client-facing schemas are versioned where appropriate, and API schema snapshots help detect unintended changes (see docs/CONTRACT_SPEC.md and CI schema checks).
- Breaking changes are documented in changelogs/release notes and accompanied by migration instructions.

## Consequences
- Provides a clear contract for integrators and internal consumers.
- Prevents accidental breaking changes by making them visible in reviews.
- Requires discipline to maintain compatibility windows and update documentation.

## References
- docs/CONTRACT_VERSIONING.md
- docs/CONTRACT_SPEC.md
