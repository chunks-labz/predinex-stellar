import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "./logger.js";
import { WebhookFailureMonitor } from "./webhook-failure-monitor.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WebhookFailureMonitor", () => {
  it("alerts once at the threshold, then clears and re-arms on recovery", () => {
    let now = 1_000;
    const errorLog = vi.spyOn(logger, "error").mockImplementation(() => {});
    const infoLog = vi.spyOn(logger, "info").mockImplementation(() => {});
    const monitor = new WebhookFailureMonitor({
      threshold: 2,
      windowMs: 1_000,
      now: () => now,
    });

    monitor.recordFailure("consumer-a", "settlement_cycle");
    expect(errorLog).not.toHaveBeenCalled();

    now += 100;
    monitor.recordFailure("consumer-a", "settlement_cycle");
    expect(errorLog).toHaveBeenCalledOnce();
    expect(errorLog).toHaveBeenCalledWith("webhook_delivery_failure_alert", expect.objectContaining({
      consumerName: "consumer-a",
      eventType: "settlement_cycle",
      failureCount: 2,
    }));

    now += 100;
    monitor.recordFailure("consumer-a", "settlement_cycle");
    expect(errorLog).toHaveBeenCalledOnce();

    monitor.recordSuccess("consumer-a", "settlement_cycle");
    expect(infoLog).toHaveBeenCalledWith("webhook_delivery_alert_recovered", expect.objectContaining({
      consumerName: "consumer-a",
      eventType: "settlement_cycle",
    }));

    now += 100;
    monitor.recordFailure("consumer-a", "settlement_cycle");
    now += 100;
    monitor.recordFailure("consumer-a", "settlement_cycle");
    expect(errorLog).toHaveBeenCalledTimes(2);
  });

  it("re-arms after the failure window elapses", () => {
    let now = 1_000;
    const errorLog = vi.spyOn(logger, "error").mockImplementation(() => {});
    const monitor = new WebhookFailureMonitor({ threshold: 1, windowMs: 100, now: () => now });

    monitor.recordFailure("consumer-a", "settlement_cycle");
    now += 101;
    monitor.recordFailure("consumer-a", "settlement_cycle");

    expect(errorLog).toHaveBeenCalledTimes(2);
  });

  it("counts failures across successful deliveries until the threshold is reached", () => {
    const errorLog = vi.spyOn(logger, "error").mockImplementation(() => {});
    const monitor = new WebhookFailureMonitor({ threshold: 2, windowMs: 1_000 });

    monitor.recordFailure("consumer-a", "settlement_cycle");
    monitor.recordSuccess("consumer-a", "settlement_cycle");
    monitor.recordFailure("consumer-a", "settlement_cycle");

    expect(errorLog).toHaveBeenCalledOnce();
    expect(errorLog).toHaveBeenCalledWith("webhook_delivery_failure_alert", expect.objectContaining({
      failureCount: 2,
    }));
  });
});
