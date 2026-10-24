# Shared Components

Reusable UI components live in this directory and should be imported with the
`@/components/...` alias from application code.

Components that are tightly coupled to App Router routes, providers, or feature
state may remain under `app/components`. When a legacy `app/components` path is
kept for compatibility, it should re-export the implementation from this
directory instead of duplicating behavior.
