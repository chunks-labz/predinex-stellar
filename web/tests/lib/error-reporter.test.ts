import { describe, it, expect, beforeEach } from 'vitest';
import {
  configureErrorReporter,
  reportError,
  redactSensitiveData,
  __resetErrorReporterForTests,
  type ErrorEvent,
} from '@/app/lib/error-reporter';

beforeEach(() => {
  __resetErrorReporterForTests();
});

// ---------------------------------------------------------------------------
// Redaction unit tests
// ---------------------------------------------------------------------------

describe('redactSensitiveData', () => {
  it('redacts Stellar public keys (G...)', () => {
    // Valid 56-char Stellar public key (base32 uppercase)
    const address = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN';
    expect(redactSensitiveData(`addr=${address}`)).toBe('addr=[STELLAR_ADDRESS]');
  });

  it('redacts Stellar contract IDs (C...)', () => {
    const contract = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
    expect(redactSensitiveData(contract)).toBe('[STELLAR_ADDRESS]');
  });

  it('redacts Stellar secret keys (S...)', () => {
    // Valid 56-char Stellar secret key (base32 uppercase, starts with S)
    const secret = 'SCZANGBA5RLCN6MFNKDKXNQXBDGXKM5JXQXQXQXQXQXQXQXQXQXQXQX';
    expect(redactSensitiveData(secret)).toBe('[REDACTED]');
  });

  it('redacts Stacks addresses (SP... / ST...)', () => {
    expect(redactSensitiveData('SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7')).toBe(
      '[STACKS_ADDRESS]'
    );
    expect(redactSensitiveData('ST2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7')).toBe(
      '[STACKS_ADDRESS]'
    );
  });

  it('redacts long hex strings (signatures / hashes)', () => {
    const sig = 'a'.repeat(64);
    expect(redactSensitiveData(`sig=${sig}`)).toBe('sig=[HEX_REDACTED]');
  });

  it('redacts long base64 strings (XDR envelopes)', () => {
    // Contains '/' so it's unambiguously base64, not hex
    const xdr = 'AAAA'.repeat(8) + '/AAA' + 'AAAA'.repeat(8);
    expect(redactSensitiveData(xdr)).toBe('[BASE64_REDACTED]');
  });

  it('leaves short, non-sensitive strings unchanged', () => {
    expect(redactSensitiveData('Network timeout after 5000ms')).toBe(
      'Network timeout after 5000ms'
    );
  });
});

// ---------------------------------------------------------------------------
// Reporter hook tests
// ---------------------------------------------------------------------------

describe('reportError', () => {
  it('is a no-op when no handler is configured', () => {
    // Should not throw
    expect(() => reportError(new Error('boom'))).not.toThrow();
  });

  it('calls the configured handler with a sanitised payload', () => {
    const received: ErrorEvent[] = [];
    configureErrorReporter({ onReport: (e) => received.push(e) });

    reportError(new Error('Something failed'));

    expect(received).toHaveLength(1);
    expect(received[0].message).toBe('Something failed');
    expect(received[0].boundary).toBeUndefined();
    expect(received[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('redacts wallet address embedded in the error message', () => {
    const received: ErrorEvent[] = [];
    configureErrorReporter({ onReport: (e) => received.push(e) });

    const walletAddr = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN';
    reportError(new Error(`Failed for address ${walletAddr}`));

    expect(received[0].message).not.toContain(walletAddr);
    expect(received[0].message).toContain('[STELLAR_ADDRESS]');
  });

  it('redacts wallet address in the component stack', () => {
    const received: ErrorEvent[] = [];
    configureErrorReporter({ onReport: (e) => received.push(e) });

    const walletAddr = 'SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7';
    reportError(new Error('tx error'), {
      componentStack: `\n  at WalletButton (addr=${walletAddr})`,
      boundary: 'WalletErrorBoundary',
    });

    expect(received[0].componentStack).not.toContain(walletAddr);
    expect(received[0].boundary).toBe('WalletErrorBoundary');
  });

  it('does not propagate exceptions thrown by the handler', () => {
    configureErrorReporter({
      onReport: () => {
        throw new Error('reporter exploded');
      },
    });
    expect(() => reportError(new Error('original'))).not.toThrow();
  });
});
