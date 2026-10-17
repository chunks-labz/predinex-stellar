/**
 * Market creation validation (Issue #1434).
 *
 * Single home for the rules applied to market creation requests at the API
 * boundary, so malformed payloads are rejected with field-level errors before
 * they reach the contract layer. The limits mirror the contract constants in
 * `contracts/predinex/src/lib.rs` (`MAX_TITLE_LENGTH`, `MIN_OUTCOME_COUNT`,
 * `MAX_OUTCOME_COUNT`, `MAX_OUTCOME_LENGTH`, `MIN_POOL_DURATION_SECS`,
 * `MAX_POOL_DURATION_SECS`).
 */

export const MAX_TITLE_LENGTH = 100;
export const MIN_OUTCOME_COUNT = 2;
export const MAX_OUTCOME_COUNT = 20;
export const MAX_OUTCOME_LENGTH = 50;
export const MIN_CLOSE_DELAY_SECS = 300;
export const MAX_CLOSE_DELAY_SECS = 31_536_000;

export interface CreateMarketRequest {
  title: string;
  outcomes: string[];
  /** Unix timestamp in seconds at which the market closes. */
  closeTime: number;
}

export interface FieldError {
  field: string;
  message: string;
}

export type MarketValidationResult =
  | { ok: true; value: CreateMarketRequest }
  | { ok: false; errors: FieldError[] };

// The contract measures lengths in bytes, so the API does too.
function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

/**
 * Validates a raw market creation payload. Valid payloads are returned
 * unchanged; every violated rule contributes one entry to `errors`.
 *
 * @param now current time in unix seconds (injectable for tests)
 */
export function validateCreateMarket(
  body: unknown,
  now: number = Math.floor(Date.now() / 1000)
): MarketValidationResult {
  const errors: FieldError[] = [];
  const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;

  const { title, outcomes, closeTime } = input;

  if (typeof title !== 'string' || title.trim().length === 0) {
    errors.push({ field: 'title', message: 'title must be a non-empty string' });
  } else if (byteLength(title) > MAX_TITLE_LENGTH) {
    errors.push({ field: 'title', message: `title must be at most ${MAX_TITLE_LENGTH} bytes` });
  }

  if (!Array.isArray(outcomes)) {
    errors.push({ field: 'outcomes', message: 'outcomes must be an array of strings' });
  } else {
    if (outcomes.length < MIN_OUTCOME_COUNT || outcomes.length > MAX_OUTCOME_COUNT) {
      errors.push({
        field: 'outcomes',
        message: `outcomes must contain between ${MIN_OUTCOME_COUNT} and ${MAX_OUTCOME_COUNT} entries`,
      });
    }
    const seen = new Set<string>();
    outcomes.forEach((outcome, i) => {
      const field = `outcomes[${i}]`;
      if (typeof outcome !== 'string' || outcome.trim().length === 0) {
        errors.push({ field, message: 'outcome must be a non-empty string' });
      } else if (byteLength(outcome) > MAX_OUTCOME_LENGTH) {
        errors.push({ field, message: `outcome must be at most ${MAX_OUTCOME_LENGTH} bytes` });
      } else if (seen.has(outcome)) {
        errors.push({ field, message: 'outcome must be unique' });
      } else {
        seen.add(outcome);
      }
    });
  }

  if (typeof closeTime !== 'number' || !Number.isSafeInteger(closeTime)) {
    errors.push({ field: 'closeTime', message: 'closeTime must be an integer unix timestamp in seconds' });
  } else if (closeTime < now + MIN_CLOSE_DELAY_SECS) {
    errors.push({
      field: 'closeTime',
      message: `closeTime must be at least ${MIN_CLOSE_DELAY_SECS} seconds in the future`,
    });
  } else if (closeTime > now + MAX_CLOSE_DELAY_SECS) {
    errors.push({
      field: 'closeTime',
      message: `closeTime must be at most ${MAX_CLOSE_DELAY_SECS} seconds in the future`,
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { title: title as string, outcomes: outcomes as string[], closeTime: closeTime as number } };
}
