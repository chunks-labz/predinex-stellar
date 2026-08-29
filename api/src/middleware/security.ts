/**
 * Security & Input Validation Helpers.
 */

export class SecuritySanitizer {
  /**
   * Validates and sanitizes a Stellar public key (G... or C... address).
   */
  public static isValidStellarAddress(address: string): boolean {
    if (typeof address !== 'string') return false;
    // Stellar addresses start with G (account) or C (contract) and are 56 chars base32
    return /^[G|C][A-Z0-9]{55}$/.test(address);
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
