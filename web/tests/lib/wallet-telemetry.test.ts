/**
 * Wallet Telemetry Tests
 *
 * Verifies that wallet connection/disconnection telemetry is forwarded to the
 * configured provider (or dropped when disabled / development mode).
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  walletTelemetry,
  setWalletTelemetryProvider,
  setWalletTelemetryEnabled,
  __resetWalletTelemetryForTests,
  type WalletTelemetryProvider,
  type WalletConnectSuccessProps,
} from '../../app/lib/wallet-telemetry';
import {
  analytics,
  type AnalyticsProvider,
} from '../../app/lib/analytics/service';

describe('wallet-telemetry provider interface', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    __resetWalletTelemetryForTests();
    process.env = { ...originalEnv };
    delete process.env.NEXT_PUBLIC_DISABLE_TELEMETRY;
  });

  afterEach(() => {
    process.env = originalEnv;
    __resetWalletTelemetryForTests();
  });

  it('forwards trackConnectAttempt to the analytics service provider', () => {
    const trackSpy = vi.fn();
    const mockAnalyticsProvider: AnalyticsProvider = { track: trackSpy };
    analytics.configure({ enabled: true, debug: false });
    analytics.setProvider(mockAnalyticsProvider);
    setWalletTelemetryEnabled(true);

    walletTelemetry.trackConnectAttempt({ walletType: 'freighter', source: 'nav_button' });

    expect(trackSpy).toHaveBeenCalledWith(
      'wallet.connect.attempt',
      expect.objectContaining({ walletType: 'freighter' })
    );
  });

  it('forwards trackConnectSuccess with duration to the provider', () => {
    const trackSpy = vi.fn();
    const mockAnalyticsProvider: AnalyticsProvider = { track: trackSpy };
    analytics.configure({ enabled: true, debug: false });
    analytics.setProvider(mockAnalyticsProvider);
    setWalletTelemetryEnabled(true);

    const props: WalletConnectSuccessProps = {
      walletType: 'walletconnect',
      durationMs: 1420,
    };
    walletTelemetry.trackConnectSuccess(props);

    const call = trackSpy.mock.calls[0];
    expect(call[0]).toBe('wallet.connect.success');
    expect(call[1].walletType).toBe('walletconnect');
    expect(call[1].durationMs).toBe(1420);
  });

  it('forwards trackConnectFailure with redacted error to the provider', () => {
    const trackSpy = vi.fn();
    const mockAnalyticsProvider: AnalyticsProvider = { track: trackSpy };
    analytics.configure({ enabled: true, debug: false });
    analytics.setProvider(mockAnalyticsProvider);
    setWalletTelemetryEnabled(true);

    walletTelemetry.trackConnectFailure({
      walletType: 'freighter',
      durationMs: 2000,
      errorMessage: 'Rejected by user at GABCDEFGHIJKLMNOP',
      errorCode: 'USER_REJECTED',
    });

    const call = trackSpy.mock.calls[0][1];
    expect(call.errorCode).toBe('USER_REJECTED');
    expect(call.errorMessage).not.toContain('GABCDEFGHIJKLMNOP');
  });

  it('forwards trackDisconnect with session metrics', () => {
    const trackSpy = vi.fn();
    const mockAnalyticsProvider: AnalyticsProvider = { track: trackSpy };
    analytics.configure({ enabled: true, debug: false });
    analytics.setProvider(mockAnalyticsProvider);
    setWalletTelemetryEnabled(true);

    walletTelemetry.trackDisconnect({
      sessionDurationMs: 600_000,
      interactionCount: 12,
      reason: 'user_initiated',
    });

    expect(trackSpy).toHaveBeenCalledWith(
      'wallet.disconnect',
      expect.objectContaining({
        sessionDurationMs: 600_000,
        interactionCount: 12,
      })
    );
  });

  it('drops all events when explicitly disabled via setWalletTelemetryEnabled(false)', () => {
    const trackSpy = vi.fn();
    const mockAnalyticsProvider: AnalyticsProvider = { track: trackSpy };
    analytics.configure({ enabled: true, debug: false });
    analytics.setProvider(mockAnalyticsProvider);

    setWalletTelemetryEnabled(false);
    walletTelemetry.trackConnectAttempt({ walletType: 'freighter' });
    walletTelemetry.trackConnectSuccess({ walletType: 'freighter', durationMs: 100 });
    walletTelemetry.trackDisconnect({});

    expect(trackSpy).not.toHaveBeenCalled();
    expect(walletTelemetry.status().enabled).toBe(false);
  });

  it('uses a no-op provider in NODE_ENV=development', () => {
    process.env.NODE_ENV = 'development';
    __resetWalletTelemetryForTests();

    const trackSpy = vi.fn();
    const mockAnalyticsProvider: AnalyticsProvider = { track: trackSpy };
    analytics.configure({ enabled: true, debug: false });
    analytics.setProvider(mockAnalyticsProvider);

    walletTelemetry.trackConnectAttempt({ walletType: 'freighter' });
    expect(trackSpy).not.toHaveBeenCalled();
    expect(walletTelemetry.status().providerName).toBe('noop');
  });

  it('uses a no-op provider when NEXT_PUBLIC_DISABLE_TELEMETRY=true', () => {
    process.env.NODE_ENV = 'production';
    process.env.NEXT_PUBLIC_DISABLE_TELEMETRY = 'true';
    __resetWalletTelemetryForTests();

    const trackSpy = vi.fn();
    const mockAnalyticsProvider: AnalyticsProvider = { track: trackSpy };
    analytics.configure({ enabled: true, debug: false });
    analytics.setProvider(mockAnalyticsProvider);

    walletTelemetry.trackConnectAttempt({ walletType: 'freighter' });
    expect(trackSpy).not.toHaveBeenCalled();
    expect(walletTelemetry.status().enabled).toBe(false);
  });

  it('supports swapping to a custom provider via setWalletTelemetryProvider', () => {
    const calls: Array<{ method: string; props: unknown }> = [];
    const custom: WalletTelemetryProvider = {
      name: 'custom-test',
      trackConnectAttempt: (p) => calls.push({ method: 'attempt', props: p }),
      trackConnectSuccess: (p) => calls.push({ method: 'success', props: p }),
      trackConnectCancel: (p) => calls.push({ method: 'cancel', props: p }),
      trackConnectFailure: (p) => calls.push({ method: 'failure', props: p }),
      trackDisconnect: (p) => calls.push({ method: 'disconnect', props: p }),
      status: () => ({ enabled: true, providerName: 'custom-test' }),
    };

    setWalletTelemetryProvider(custom);
    walletTelemetry.trackConnectAttempt({ walletType: 'other' });
    walletTelemetry.trackDisconnect({ interactionCount: 3 });

    expect(calls).toHaveLength(2);
    expect(calls[0].method).toBe('attempt');
    expect(calls[1].method).toBe('disconnect');
    expect(walletTelemetry.name).toBe('custom-test');
  });

  it('reverts to no-op when setWalletTelemetryProvider(null)', () => {
    setWalletTelemetryEnabled(true);
    setWalletTelemetryProvider(null);
    expect(walletTelemetry.status().enabled).toBe(false);
    expect(walletTelemetry.status().providerName).toBe('noop');
  });
});
