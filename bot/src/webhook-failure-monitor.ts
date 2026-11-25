import { logger } from "./logger.js";

const DEFAULT_THRESHOLD = 5;
const DEFAULT_WINDOW_MS = 15 * 60 * 1000;

interface FailureState {
  failures: number[];
  alertActive: boolean;
  lastFailureAt: number;
}

export interface WebhookFailureMonitorOptions {
  threshold?: number;
  windowMs?: number;
  now?: () => number;
}

export class WebhookFailureMonitor {
  private readonly threshold: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly states = new Map<string, FailureState>();

  constructor(options: WebhookFailureMonitorOptions = {}) {
    this.threshold = options.threshold ?? DEFAULT_THRESHOLD;
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.now = options.now ?? Date.now;
  }

  recordFailure(consumerName: string, eventType: string): void {
    const key = JSON.stringify([consumerName, eventType]);
    const now = this.now();
    const state = this.states.get(key) ?? {
      failures: [],
      alertActive: false,
      lastFailureAt: now,
    };

    if (state.alertActive && now - state.lastFailureAt >= this.windowMs) {
      state.alertActive = false;
      state.failures = [];
    }

    state.failures = state.failures.filter((timestamp) => timestamp > now - this.windowMs);
    state.failures.push(now);
    state.lastFailureAt = now;
    this.states.set(key, state);

    if (!state.alertActive && state.failures.length >= this.threshold) {
      state.alertActive = true;
      logger.error("webhook_delivery_failure_alert", {
        alert: "webhook_delivery_failures",
        consumerName,
        eventType,
        failureCount: state.failures.length,
        threshold: this.threshold,
        windowSeconds: this.windowMs / 1000,
      });
    }
  }

  recordSuccess(consumerName: string, eventType: string): void {
    const key = JSON.stringify([consumerName, eventType]);
    const state = this.states.get(key);
    if (!state?.alertActive) return;

    this.states.delete(key);
    logger.info("webhook_delivery_alert_recovered", {
      alert: "webhook_delivery_failures",
      consumerName,
      eventType,
      failureCount: state.failures.length,
    });
  }
}
