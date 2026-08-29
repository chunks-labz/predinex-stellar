/**
 * Analytics Service
 * 
 * Central service for emitting product analytics events.
 * All events are automatically sanitized to remove sensitive data.
 * 
 * @see web/docs/ANALYTICS_TAXONOMY.md
 */

import { redactSensitiveData } from '../error-reporter';
import { createScopedLogger } from '@/app/lib/logger';
const log = createScopedLogger('AnalyticsService');
import type {
  AnalyticsEvent,
  EventName,
  EventPayloadMap,
  EventContext,
} from './events';

/**
 * Analytics Service Configuration
 */
interface AnalyticsConfig {
  enabled: boolean;
  debug: boolean;
  provider?: AnalyticsProvider;
}

/**
 * Analytics Provider Interface
 * Implement this interface to integrate with your analytics backend
 * (e.g., Segment, PostHog, Mixpanel, Google Analytics)
 */
export interface AnalyticsProvider {
  track(event: string, properties: Record<string, unknown>): void;
  identify?(userId: string, traits?: Record<string, unknown>): void;
  page?(name?: string, properties?: Record<string, unknown>): void;
}

/**
 * Analytics Service
 * 
 * Usage:
 * ```typescript
 * import { analytics } from '@/app/lib/analytics/service';
 * 
 * analytics.emit('wallet.connect.success', {
 *   walletType: 'freighter',
 *   durationMs: 1500
 * });
 * ```
 */
class AnalyticsService {
  private config: AnalyticsConfig;
  private sessionId: string;
  private sessionStartTime: number;
  private interactionCount: number = 0;

  constructor() {
    this.config = {
      enabled: process.env.NODE_ENV === 'production',
      debug: process.env.NODE_ENV === 'development',
      provider: undefined,
    };

    // Generate anonymous session ID
    this.sessionId = this.generateSessionId();
    this.sessionStartTime = Date.now();
  }

  /**
   * Configure the analytics service
   */
  configure(config: Partial<AnalyticsConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Set the analytics provider
   */
  setProvider(provider: AnalyticsProvider): void {
    this.config.provider = provider;
  }

  /**
   * Emit an analytics event
   * 
   * @param event - Event name from the canonical taxonomy
   * @param properties - Event-specific payload (typed)
   * @param context - Optional additional context
   */
  emit<T extends EventName>(
    event: T,
    properties: EventPayloadMap[T],
    context?: Partial<EventContext>
  ): void {
    // Increment interaction counter for session tracking
    this.interactionCount++;

    // Build full event payload
    const payload: AnalyticsEvent<T> = {
      event,
      timestamp: new Date().toISOString(),
      properties: this.sanitize(properties) as EventPayloadMap[T],
      context: {
        sessionId: this.sessionId,
        networkType: this.getNetworkType(),
        appVersion: this.getAppVersion(),
        userAgent: this.getUserAgent(),
        ...context,
      },
    };

    // Debug logging in development
    if (this.config.debug) {
      log.info(`[analytics] ${event}`, payload.properties);
    }

    // Skip emission if disabled
    if (!this.config.enabled) {
      return;
    }

    // Emit to provider if configured
    if (this.config.provider) {
      try {
        this.config.provider.track(payload.event, {
          ...payload.properties,
          ...payload.context,
          timestamp: payload.timestamp,
        });
      } catch (error) {
        // Never let analytics errors crash the app
        log.error('[analytics] Failed to emit event:', error);
      }
    }
  }

  /**
   * Get session duration in milliseconds
   */
  getSessionDuration(): number {
    return Date.now() - this.sessionStartTime;
  }

  /**
   * Get interaction count for current session
   */
  getInteractionCount(): number {
    return this.interactionCount;
  }

  /**
   * Reset session (e.g., on wallet disconnect)
   */
  resetSession(): void {
    this.sessionId = this.generateSessionId();
    this.sessionStartTime = Date.now();
    this.interactionCount = 0;
  }

  // =========================================================================
  // Private Methods
  // =========================================================================

  /**
   * Sanitize event properties to remove sensitive data
   */
  private sanitize(properties: unknown): unknown {
    if (properties === null || properties === undefined) {
      return properties;
    }
    if (typeof properties === 'string') {
      return redactSensitiveData(properties);
    }
    if (typeof properties === 'object') {
      if (Array.isArray(properties)) {
        return properties.map((item) => this.sanitize(item));
      }
      const sanitized: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(properties as Record<string, unknown>)) {
        sanitized[key] = this.sanitize(value);
      }
      return sanitized;
    }
    return properties;
  }

  /**
   * Generate anonymous session identifier
   */
  private generateSessionId(): string {
    return `sess_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Get current network type from environment
   */
  private getNetworkType(): 'mainnet' | 'testnet' {
    // TODO: Read from runtime config
    return process.env.NEXT_PUBLIC_NETWORK_TYPE === 'mainnet' ? 'mainnet' : 'testnet';
  }

  /**
   * Get app version from package.json
   */
  private getAppVersion(): string {
    // TODO: Read from build-time constant
    return process.env.NEXT_PUBLIC_APP_VERSION || 'unknown';
  }

  /**
   * Get user agent string (browser only)
   */
  private getUserAgent(): string | undefined {
    if (typeof window !== 'undefined' && window.navigator) {
      return window.navigator.userAgent;
    }
    return undefined;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const analytics = new AnalyticsService();

// ============================================================================
// Convenience Hooks
// ============================================================================

/**
 * React hook for analytics in components
 * 
 * Usage:
 * ```typescript
 * const { emit } = useAnalytics();
 * 
 * const handleClick = () => {
 *   emit('wallet.connect.attempt', { walletType: 'freighter' });
 * };
 * ```
 */
export function useAnalytics() {
  return {
    emit: analytics.emit.bind(analytics),
    getSessionDuration: analytics.getSessionDuration.bind(analytics),
    getInteractionCount: analytics.getInteractionCount.bind(analytics),
  };
}

// ============================================================================
// Timing Utilities
// ============================================================================

/**
 * Timer utility for measuring operation duration
 * 
 * Usage:
 * ```typescript
 * const timer = startTimer();
 * // ... perform operation
 * analytics.emit('bet.success', {
 *   poolId: 42,
 *   outcome: 0,
 *   durationMs: timer.elapsed()
 * });
 * ```
 */
export function startTimer() {
  const startTime = Date.now();
  
  return {
    elapsed: () => Date.now() - startTime,
    elapsedSeconds: () => Math.floor((Date.now() - startTime) / 1000),
  };
}
