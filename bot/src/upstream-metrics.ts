const timeoutCounts = new Map<string, number>();

export function recordUpstreamTimeout(upstream: string): void {
  timeoutCounts.set(upstream, (timeoutCounts.get(upstream) ?? 0) + 1);
}

export function getUpstreamTimeoutMetrics(): Record<string, number> {
  return Object.fromEntries(timeoutCounts.entries());
}

export function resetUpstreamTimeoutMetrics(): void {
  timeoutCounts.clear();
}
