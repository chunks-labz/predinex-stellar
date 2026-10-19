import { recordUpstreamTimeout } from "./upstream-metrics.js";

/** A timeout is safe for callers to retry because no response was received. */
export class UpstreamTimeoutError extends Error {
  readonly retryable = true;
  readonly code = "UPSTREAM_TIMEOUT";

  constructor(
    public readonly upstream: string,
    public readonly timeoutMs: number,
  ) {
    super(`${upstream} request timed out after ${timeoutMs}ms`);
    this.name = "UpstreamTimeoutError";
  }
}

export async function withUpstreamTimeout<T>(
  operation: Promise<T>,
  upstream: string,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          recordUpstreamTimeout(upstream);
          reject(new UpstreamTimeoutError(upstream, timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
