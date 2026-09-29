/**
 * Wallet Telemetry Provider
 *
 * Pluggable provider interface for wallet connection/disconnection telemetry.
 * Default implementation forwards to the central analytics service with
 * privacy-preserving payload sanitisation. A no-op provider is used in
 * development or when telemetry is explicitly disabled.
 *
 * Usage:
 * ```ts
 * import { walletTelemetry, WalletTelemetryStatus } from '@/app/lib/wallet-telemetry';
 *
 * walletTelemetry.trackConnectAttempt('freighter');
 * walletTelemetry.trackConnectSuccess({ walletType: 'freighter', durationMs: 1500 });
 * walletTelemetry.trackDisconnect({ sessionDurationMs: 300_000, interactionCount: 5 });
 * ```
 */

import { analytics, type AnalyticsProvider } from './analytics/service';
import { createScopedLogger } from './logger';

const log = createScopedLogger('WalletTelemetry');

export type WalletType = 'freighter' | 'walletconnect' | 'xbull' | 'rabet' | 'albedo' | 'other';

export interface WalletTelemetryStatus {
  enabled: boolean;
  providerName: string;
}

export interface WalletConnectAttemptProps {
  walletType: WalletType;
  source?: 'nav_button' | 'bet_form' | 'claim_button' | 'settings' | 'other';
}

export interface WalletConnectSuccessProps {
  walletType: WalletType;
  durationMs: number;
  source?: string;
}

export interface WalletConnectCancelProps {
  walletType: WalletType;
  durationMs: number;
  source?: string;
}

export interface WalletConnectFailureProps {
  walletType: WalletType;
  durationMs: number;
  errorMessage?: string;
  errorCode?: string;
  source?: string;
}

export interface WalletDisconnectProps {
  sessionDurationMs?: number;
  interactionCount?: number;
  walletType?: WalletType;
  reason?: 'user_initiated' | 'network_switch' | 'session_expired' | 'error' | 'other';
}

export interface WalletTelemetryProvider {
  readonly name: string;
  trackConnectAttempt(props: WalletConnectAttemptProps): void;
  trackConnectSuccess(props: WalletConnectSuccessProps): void;
  trackConnectCancel(props: WalletConnectCancelProps): void;
  trackConnectFailure(props: WalletConnectFailureProps): void;
  trackDisconnect(props: WalletDisconnectProps): void;
  status(): WalletTelemetryStatus;
}

class NoOpWalletTelemetryProvider implements WalletTelemetryProvider {
  readonly name = 'noop';
  trackConnectAttempt() {}
  trackConnectSuccess() {}
  trackConnectCancel() {}
  trackConnectFailure() {}
  trackDisconnect() {}
  status(): WalletTelemetryStatus {
    return { enabled: false, providerName: this.name };
  }
}

class AnalyticsServiceWalletTelemetryProvider implements WalletTelemetryProvider {
  readonly name = 'analytics-service';

  trackConnectAttempt(props: WalletConnectAttemptProps): void {
    analytics.emit('wallet.connect.attempt', {
      walletType: props.walletType,
    });
    log.debug('trackConnectAttempt', props);
  }

  trackConnectSuccess(props: WalletConnectSuccessProps): void {
    analytics.emit('wallet.connect.success', {
      walletType: props.walletType,
      durationMs: props.durationMs,
    });
    log.debug('trackConnectSuccess', props);
  }

  trackConnectCancel(props: WalletConnectCancelProps): void {
    analytics.emit('wallet.connect.cancel', {
      walletType: props.walletType,
      durationMs: props.durationMs,
    });
    log.debug('trackConnectCancel', props);
  }

  trackConnectFailure(props: WalletConnectFailureProps): void {
    analytics.emit('wallet.connect.failure', {
      walletType: props.walletType,
      errorMessage: props.errorMessage ?? 'unknown',
      errorCode: props.errorCode ?? 'UNKNOWN',
      durationMs: props.durationMs,
    });
    log.debug('trackConnectFailure', props);
  }

  trackDisconnect(props: WalletDisconnectProps): void {
    analytics.emit('wallet.disconnect', {
      sessionDurationMs: props.sessionDurationMs ?? 0,
      interactionCount: props.interactionCount ?? 0,
    });
    log.debug('trackDisconnect', props);
  }

  status(): WalletTelemetryStatus {
    return { enabled: true, providerName: this.name };
  }
}

const NOOP = new NoOpWalletTelemetryProvider();
const ANALYTICS = new AnalyticsServiceWalletTelemetryProvider();

function resolveDefaultProvider(): WalletTelemetryProvider {
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
    return NOOP;
  }
  if (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_DISABLE_TELEMETRY === 'true') {
    return NOOP;
  }
  return ANALYTICS;
}

let currentProvider: WalletTelemetryProvider = resolveDefaultProvider();

export function setWalletTelemetryProvider(provider: WalletTelemetryProvider | null): void {
  currentProvider = provider ?? NOOP;
}

export function setWalletTelemetryEnabled(enabled: boolean): void {
  currentProvider = enabled ? ANALYTICS : NOOP;
}

export const walletTelemetry: WalletTelemetryProvider = {
  get name() {
    return currentProvider.name;
  },
  trackConnectAttempt: (p) => currentProvider.trackConnectAttempt(p),
  trackConnectSuccess: (p) => currentProvider.trackConnectSuccess(p),
  trackConnectCancel: (p) => currentProvider.trackConnectCancel(p),
  trackConnectFailure: (p) => currentProvider.trackConnectFailure(p),
  trackDisconnect: (p) => currentProvider.trackDisconnect(p),
  status: () => currentProvider.status(),
};

export function __resetWalletTelemetryForTests(): void {
  currentProvider = resolveDefaultProvider();
}

export type { AnalyticsProvider };
