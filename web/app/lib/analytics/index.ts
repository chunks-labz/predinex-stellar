/**
 * Analytics Module
 * 
 * Canonical analytics taxonomy for product instrumentation.
 * 
 * @see web/docs/ANALYTICS_TAXONOMY.md
 */

// Export all event types and utilities
export * from './events';
export * from './service';
export * from './config';
export * from './types';

// Re-export commonly used items for convenience
export { analytics, useAnalytics, startTimer } from './service';
export type { EventName, EventPayloadMap, AnalyticsEvent } from './events';
