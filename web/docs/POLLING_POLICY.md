# Polling Policy

This page describes the hidden-tab policy used by the web app for auto-refreshing market and activity data.

## Policy

- Auto-refresh runs while the document is visible.
- Auto-refresh stops while the document is hidden.
- Auto-refresh resumes immediately when the document becomes visible again.
- Each hook keeps its own cadence, but they all follow the same visibility rule.

## Current Cadences

| Hook | Cadence | Notes |
| --- | --- | --- |
| `useDashboardData` | 30 seconds | Refreshes dashboard data in the background when visible. |
| `useUserActivity` | 30 seconds | Keeps the activity feed current while the user is viewing it. |
| `useActiveBets` | 60 seconds | Refreshes the active bets list while visible. |
| `useMarketDiscovery` | 60 seconds | Refreshes market discovery data while visible. |

## Why It Works This Way

- Hidden tabs should not keep hitting backend APIs on a fixed interval.
- The first visible refresh happens immediately after the tab regains focus, so the user does not wait for the next interval tick.
- Manual refresh actions still work even when polling is paused.

## Test Coverage

- Hook tests simulate `document.hidden` changes and verify polling pauses while hidden and resumes when visible.
- Market discovery tests also cover background refresh behavior around cached data.

