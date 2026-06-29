# Accessibility Contrast Audit (Issue #237)

Date: 2026-04-28

## Scope

- Glass panels and muted text on market, dashboard, and rewards surfaces.
- Generic and status badge components used across cards, tables, and headers.

## Representative fixes

1. Global muted/readability tokens (`web/app/globals.css`)
- Before:
  - `--muted-foreground: #a3a3a3`
  - `.glass` background at `rgba(10, 10, 10, 0.4)`
  - low-opacity borders (`rgba(255,255,255,0.08)`)
- After:
  - `--muted-foreground: #d1d5db`
  - `.glass` background increased to `rgba(8, 8, 8, 0.72)`
  - stronger borders (`rgba(255,255,255,0.14)`)

2. Badge readability (`web/components/ui/Badge.tsx`, `web/components/ui/StatusBadge.tsx`)
- Before:
  - default badges used `text-muted-foreground` on muted backgrounds.
  - status badges used low-contrast muted text for non-active states.
- After:
  - default/non-active badges use `text-foreground`.
  - success/warning/error states use stronger foreground/background pairs.

## Verification notes

- Manually verified readability improvements on:
  - Market detail panel
  - Dashboard cards and claimable sections
  - Rewards/summary cards
- Contrast-sensitive combinations (muted text on glass, badge text on tinted backgrounds) are now visibly stronger and more legible.
