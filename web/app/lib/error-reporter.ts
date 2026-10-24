/**
 * Error Reporter
 *
 * Configurable hook for structured runtime error reporting.
 * Wallet addresses, signatures, and sensitive transaction fields are
 * redacted before any payload leaves the browser.
 *
 * ## Setup
 * Call `configureErrorReporter` once at app startup (e.g. in layout.tsx):
 *
 *   configureErrorReporter({
 *     onReport: (event) => myAnalytics.captureException(event),
 *   });
 *
 * If no handler is configured the reporter is a no-op, making the
 * integration fully optional.
 */

export interface ErrorEvent {
  message: string;
  /** Sanitised stack trace — wallet/tx data stripped */
  stack?: string;
  /** React component stack when thrown inside an error boundary */
  componentStack?: string;
  /** Logical area that caught the error, e.g. "WalletErrorBoundary" */
  boundary?: string;
  timestamp: string;
}

export interface ErrorReporterConfig {
  /** Called with the sanitised event. Wire up your analytics provider here. */
  onReport: (event: ErrorEvent) => void;
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/**
 * Patterns that identify sensitive data that must never appear in reports.
 *
 * - Stellar/Stacks public keys and addresses (G…, C…, S…, SP…, ST…)
 * - Generic hex strings ≥ 32 chars (covers signatures, hashes, private keys)
 * - XDR blobs (base64 ≥ 64 chars)
 */
const REDACT_PATTERNS: Array<[RegExp, string]> = [
  // Truncated Stellar-style addresses (e.g. GBXXX...ABC123)
  [/[GC][A-Z0-9]{1,}\.\.\.[A-Z0-9]{1,}/g, '[STELLAR_ADDRESS]'],
  // Stellar public keys (G...) and contract IDs (C...) — 55–56 char base32 strkeys
  [/(?<![A-Z2-7])[GC][A-Z2-7]{54,55}(?![A-Z2-7])/g, '[STELLAR_ADDRESS]'],
  // Stellar secret keys (S...) — 55–56 char base32 strkeys
  [/(?<![A-Z2-7])S[A-Z2-7]{54,55}(?![A-Z2-7])/g, '[REDACTED]'],
  // Stacks addresses (SP... / ST...)
  [/\bS[PT][0-9A-Z]{30,}\b/g, '[STACKS_ADDRESS]'],
  // Long base64 strings containing +, / or = — XDR envelopes (run before hex)
  [/[A-Za-z0-9+/]{32,}={1,2}|[A-Za-z0-9+/]*[+/][A-Za-z0-9+/]{31,}/g, '[BASE64_REDACTED]'],
  // Long pure-hex strings — signatures, hashes, private keys
  [/\b[0-9a-fA-F]{32,}\b/g, '[HEX_REDACTED]'],
  // 0x-prefixed hex strings
  [/0x[0-9a-fA-F]{8,}/g, '[HEX_REDACTED]'],
];

export function redactSensitiveData(text: string): string {
  let result = text;
  for (const [pattern, replacement] of REDACT_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Reporter
// ---------------------------------------------------------------------------

let _config: ErrorReporterConfig | null = null;

/** Call once at app startup to enable reporting. */
export function configureErrorReporter(config: ErrorReporterConfig): void {
  _config = config;
}

/**
 * Report a runtime error.
 * Safe to call unconditionally — silently no-ops when no handler is configured.
 */
export function reportError(
  error: Error,
  options: { componentStack?: string; boundary?: string } = {}
): void {
  if (!_config) return;

  const event: ErrorEvent = {
    message: redactSensitiveData(error.message),
    stack: error.stack ? redactSensitiveData(error.stack) : undefined,
    componentStack: options.componentStack
      ? redactSensitiveData(options.componentStack)
      : undefined,
    boundary: options.boundary,
    timestamp: new Date().toISOString(),
  };

  try {
    _config.onReport(event);
  } catch {
    // Never let the reporter itself crash the app
  }
}

/** Reset config — intended for tests only. */
export function __resetErrorReporterForTests(): void {
  _config = null;
}
