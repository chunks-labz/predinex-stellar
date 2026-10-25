/**
 * Market resolution with oracle fallback (Issue #1421).
 *
 * A market used to settle from a single oracle; if that source was down or
 * served stale data the market could not settle. `MarketResolver` walks a
 * fixed precedence order and stops at the first acceptable answer:
 *
 *   1. primary oracle
 *   2. secondary oracle
 *   3. admin override (authorised admins only, with a written reason)
 *
 * Each oracle report is checked before it is trusted: reports older than
 * `maxReportAgeSecs`, timestamped in the future, for a different market, or
 * carrying an outcome outside `[0, outcomeCount)` are rejected and the next
 * step is tried.
 *
 * Every call emits exactly one `ResolutionEvent` recording which path was
 * taken (or that none succeeded) and why each skipped step was rejected.
 * Every admin override attempt, accepted or refused, is also appended to an
 * audit log.
 *
 * All timestamps are Unix seconds.
 */

export type ResolutionPath = 'primary' | 'secondary' | 'admin_override';

export interface OracleReport {
  marketId: number;
  outcome: number;
  /** When the source observed the outcome (Unix seconds). */
  observedAt: number;
}

/** A source that can report a market outcome; returns null when it has no answer yet. */
export interface ResolutionSource {
  readonly name: string;
  fetchOutcome(marketId: number): Promise<OracleReport | null>;
}

export interface AdminOverride {
  adminId: string;
  outcome: number;
  reason: string;
}

export type RejectionReason =
  | 'not_configured'
  | 'unavailable'
  | 'no_report'
  | 'stale'
  | 'future_timestamp'
  | 'market_mismatch'
  | 'invalid_outcome'
  | 'not_provided'
  | 'unauthorized'
  | 'missing_reason';

export interface Rejection {
  path: ResolutionPath;
  source: string;
  reason: RejectionReason;
  detail: string;
}

export interface ResolutionEvent {
  type: 'market_resolved' | 'market_resolution_failed';
  marketId: number;
  /** Path that produced the outcome; null when the market could not be resolved. */
  path: ResolutionPath | null;
  outcome: number | null;
  /** Name of the oracle source, or the admin id for an override. */
  resolvedBy: string | null;
  observedAt: number | null;
  resolvedAt: number;
  /** Steps that were tried and rejected before the path taken. */
  rejections: Rejection[];
  override?: { adminId: string; reason: string };
}

export interface OverrideAuditEntry {
  marketId: number;
  adminId: string;
  outcome: number;
  reason: string;
  at: number;
  accepted: boolean;
  /** Set when the override was refused. */
  rejection?: RejectionReason;
  /** True when the override was valid but not needed because an oracle answered. */
  superseded?: boolean;
}

export type ResolutionResult =
  | { resolved: true; outcome: number; path: ResolutionPath; event: ResolutionEvent }
  | { resolved: false; event: ResolutionEvent };

export interface ResolutionPolicy {
  /** Reports older than this are stale and rejected. */
  maxReportAgeSecs: number;
  /** Allowed clock skew for reports timestamped slightly in the future. */
  maxFutureSkewSecs: number;
  /** Number of outcomes in the market; valid outcomes are 0..outcomeCount-1. */
  outcomeCount: number;
  /** Per-source timeout; a source that does not answer in time is unavailable. */
  sourceTimeoutMs: number;
}

export const DEFAULT_RESOLUTION_POLICY: ResolutionPolicy = {
  maxReportAgeSecs: 3_600,
  maxFutureSkewSecs: 60,
  outcomeCount: 2,
  sourceTimeoutMs: 5_000,
};

export interface MarketResolverOptions {
  primary?: ResolutionSource;
  secondary?: ResolutionSource;
  /** Admin ids allowed to override. An empty set disables overrides entirely. */
  authorizedAdmins?: Iterable<string>;
  policy?: Partial<ResolutionPolicy>;
  onEvent?: (event: ResolutionEvent) => void;
}

type SourceCheck =
  | { ok: true; report: OracleReport }
  | { ok: false; reason: RejectionReason; detail: string };

export class MarketResolver {
  private readonly primary?: ResolutionSource;
  private readonly secondary?: ResolutionSource;
  private readonly admins: ReadonlySet<string>;
  private readonly policy: ResolutionPolicy;
  private readonly onEvent?: (event: ResolutionEvent) => void;
  private readonly audit: OverrideAuditEntry[] = [];

  constructor(options: MarketResolverOptions = {}) {
    this.primary = options.primary;
    this.secondary = options.secondary;
    this.admins = new Set(options.authorizedAdmins ?? []);
    this.policy = { ...DEFAULT_RESOLUTION_POLICY, ...options.policy };
    this.onEvent = options.onEvent;

    if (!Number.isInteger(this.policy.outcomeCount) || this.policy.outcomeCount < 1) {
      throw new Error('outcomeCount must be a positive integer');
    }
  }

  /** Copy of every admin override attempt seen so far, oldest first. */
  getAuditLog(): OverrideAuditEntry[] {
    return this.audit.map((entry) => ({ ...entry }));
  }

  async resolve(marketId: number, now: number, override?: AdminOverride): Promise<ResolutionResult> {
    const rejections: Rejection[] = [];

    const steps: Array<[ResolutionPath, ResolutionSource | undefined]> = [
      ['primary', this.primary],
      ['secondary', this.secondary],
    ];

    for (const [path, source] of steps) {
      const check = await this.checkSource(source, marketId, now);
      if (check.ok) {
        if (override) {
          // An oracle answered, so the override is not used, but the attempt
          // is still recorded so every admin action leaves a trace.
          const refusal = this.validateOverride(override);
          this.recordOverride(marketId, override, now, false, refusal ?? undefined, refusal === null);
        }
        return this.finish(marketId, now, path, check.report.outcome, source!.name, check.report.observedAt, rejections);
      }
      rejections.push({ path, source: source?.name ?? 'none', reason: check.reason, detail: check.detail });
    }

    if (!override) {
      rejections.push({
        path: 'admin_override',
        source: 'none',
        reason: 'not_provided',
        detail: 'no admin override supplied',
      });
      return this.fail(marketId, now, rejections);
    }

    const refusal = this.validateOverride(override);
    if (refusal !== null) {
      this.recordOverride(marketId, override, now, false, refusal);
      rejections.push({
        path: 'admin_override',
        source: override.adminId,
        reason: refusal,
        detail: overrideRefusalDetail(refusal),
      });
      return this.fail(marketId, now, rejections);
    }

    this.recordOverride(marketId, override, now, true);
    return this.finish(marketId, now, 'admin_override', override.outcome, override.adminId, now, rejections, {
      adminId: override.adminId,
      reason: override.reason.trim(),
    });
  }

  private async checkSource(
    source: ResolutionSource | undefined,
    marketId: number,
    now: number
  ): Promise<SourceCheck> {
    if (!source) {
      return { ok: false, reason: 'not_configured', detail: 'source not configured' };
    }

    let report: OracleReport | null;
    try {
      // Wrapped so a source that throws synchronously is treated as unavailable too.
      report = await withTimeout(
        Promise.resolve().then(() => source.fetchOutcome(marketId)),
        this.policy.sourceTimeoutMs
      );
    } catch (err) {
      return { ok: false, reason: 'unavailable', detail: errorMessage(err) };
    }

    if (report === null || report === undefined) {
      return { ok: false, reason: 'no_report', detail: 'source has no outcome yet' };
    }
    if (report.marketId !== marketId) {
      return {
        ok: false,
        reason: 'market_mismatch',
        detail: `report is for market ${report.marketId}`,
      };
    }
    if (!this.isValidOutcome(report.outcome)) {
      return { ok: false, reason: 'invalid_outcome', detail: `outcome ${report.outcome} out of range` };
    }
    if (!Number.isFinite(report.observedAt)) {
      return { ok: false, reason: 'stale', detail: 'report has no usable timestamp' };
    }
    if (report.observedAt > now + this.policy.maxFutureSkewSecs) {
      return { ok: false, reason: 'future_timestamp', detail: `observedAt ${report.observedAt} is in the future` };
    }
    const age = now - report.observedAt;
    if (age > this.policy.maxReportAgeSecs) {
      return {
        ok: false,
        reason: 'stale',
        detail: `report is ${age}s old (max ${this.policy.maxReportAgeSecs}s)`,
      };
    }
    return { ok: true, report };
  }

  private validateOverride(override: AdminOverride): RejectionReason | null {
    if (!this.admins.has(override.adminId)) return 'unauthorized';
    if (typeof override.reason !== 'string' || override.reason.trim() === '') return 'missing_reason';
    if (!this.isValidOutcome(override.outcome)) return 'invalid_outcome';
    return null;
  }

  private isValidOutcome(outcome: number): boolean {
    return Number.isInteger(outcome) && outcome >= 0 && outcome < this.policy.outcomeCount;
  }

  private recordOverride(
    marketId: number,
    override: AdminOverride,
    at: number,
    accepted: boolean,
    rejection?: RejectionReason,
    superseded?: boolean
  ): void {
    const entry: OverrideAuditEntry = {
      marketId,
      adminId: override.adminId,
      outcome: override.outcome,
      reason: typeof override.reason === 'string' ? override.reason.trim() : '',
      at,
      accepted,
    };
    if (rejection) entry.rejection = rejection;
    if (superseded) entry.superseded = true;
    this.audit.push(entry);
  }

  private finish(
    marketId: number,
    now: number,
    path: ResolutionPath,
    outcome: number,
    resolvedBy: string,
    observedAt: number,
    rejections: Rejection[],
    override?: { adminId: string; reason: string }
  ): ResolutionResult {
    const event: ResolutionEvent = {
      type: 'market_resolved',
      marketId,
      path,
      outcome,
      resolvedBy,
      observedAt,
      resolvedAt: now,
      rejections,
    };
    if (override) event.override = override;
    this.emit(event);
    return { resolved: true, outcome, path, event };
  }

  private fail(marketId: number, now: number, rejections: Rejection[]): ResolutionResult {
    const event: ResolutionEvent = {
      type: 'market_resolution_failed',
      marketId,
      path: null,
      outcome: null,
      resolvedBy: null,
      observedAt: null,
      resolvedAt: now,
      rejections,
    };
    this.emit(event);
    return { resolved: false, event };
  }

  private emit(event: ResolutionEvent): void {
    if (!this.onEvent) return;
    try {
      this.onEvent(event);
    } catch {
      // A faulty listener must not change the resolution result.
    }
  }
}

function overrideRefusalDetail(reason: RejectionReason): string {
  switch (reason) {
    case 'unauthorized':
      return 'admin is not authorised to override';
    case 'missing_reason':
      return 'override requires a non-empty reason';
    case 'invalid_outcome':
      return 'override outcome out of range';
    default:
      return reason;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`source timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}
