# Shared Utilities

Use this directory for framework-agnostic or cross-route helpers that are shared
by root-level components and App Router code. Import shared helpers with the
`@/lib/...` alias.

Route-specific data access, contract adapters, and feature state should remain
under `app/lib`. If a legacy `app/lib` path is kept for compatibility, it should
re-export the shared implementation from this directory rather than duplicating
it.
