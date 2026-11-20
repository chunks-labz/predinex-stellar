/**
 * Security & Input Validation Helpers.
 */

export class SecuritySanitizer {
  /**
   * Validates a Stellar address (G... account or C... contract).
   *
   * The first character is a character class of exactly `G` or `C`. It used to
   * be written `[G|C]`, which also let `|` through (issue #1302).
   */
  public static isValidStellarAddress(address: unknown): address is string {
    if (typeof address !== 'string') return false;
    // Stellar addresses start with G (account) or C (contract) and are 56 chars base32
    return /^[GC][A-Z0-9]{55}$/.test(address);
  }

  /**
   * Reads a caller-supplied address field. Returns the address unchanged when it
   * is a well-formed Stellar address, otherwise `undefined`. Non-strings are
   * rejected rather than coerced with `String()`, so a number or object can
   * never be recorded as an account identity.
   */
  public static readStellarAddress(value: unknown): string | undefined {
    return SecuritySanitizer.isValidStellarAddress(value) ? value : undefined;
  }

  /**
   * Sanitizes numeric values against NaN, Infinity, negative values, and precision bounds.
   */
  public static sanitizePositiveNumber(value: any, defaultValue: number = 0): number {
    if (typeof value !== 'number' || isNaN(value) || !isFinite(value) || value < 0) {
      return defaultValue;
    }
    return value;
  }

  /**
   * Reads a caller-supplied integer field, telling "absent or unparseable"
   * apart from a real value. Returns `undefined` only when the field is missing,
   * empty, not a finite number, or a string that is not a plain decimal number.
   * `0` is a value, not an absence.
   *
   * Use this instead of `parseInt(x) || fallback`: that idiom treats an explicit
   * `0` as missing and silently swaps in the fallback (issue #1214).
   */
  public static parseIntegerField(value: any): number | undefined {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? Math.trunc(value) : undefined;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!/^[+-]?\d+(\.\d+)?$/.test(trimmed)) return undefined;
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
    }
    return undefined;
  }

  /**
   * Basis-point field clamped to [min, max]. `defaulted` is true only when the
   * caller supplied nothing usable, so callers can flag the substitution instead
   * of hiding it. An explicit `0` is kept as `0`.
   */
  public static sanitizeBps(
    value: any,
    defaultValue: number,
    min: number = 0,
    max: number = 10_000
  ): { value: number; defaulted: boolean } {
    const parsed = SecuritySanitizer.parseIntegerField(value);
    const raw = parsed === undefined ? defaultValue : parsed;
    return { value: Math.min(max, Math.max(min, raw)), defaulted: parsed === undefined };
  }

  /**
   * Sanitizes BigInt strings (ensures non-negative decimal string, prevents overflow/injection).
   */
  public static sanitizeBigIntString(value: any, fallback: string = '0'): string {
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return fallback;
    return trimmed;
  }

  /**
   * Checks for dangerous prototype pollution in JSON bodies.
   */
  public static isSafeJson(body: any): boolean {
    if (!body || typeof body !== 'object') return true;
    if (Object.prototype.hasOwnProperty.call(body, '__proto__') ||
        Object.prototype.hasOwnProperty.call(body, 'constructor') ||
        Object.prototype.hasOwnProperty.call(body, 'prototype')) {
      return false;
    }
    return true;
  }
}
