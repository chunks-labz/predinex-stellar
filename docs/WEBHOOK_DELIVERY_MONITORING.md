# Webhook Delivery Monitoring

The settlement bot retries failed webhook deliveries and writes exhausted
deliveries to its dead-letter queue. It also emits a structured alert when one
consumer repeatedly fails to receive one event type. Source:
[`bot/src/webhook-failure-monitor.ts`](../bot/src/webhook-failure-monitor.ts).

## Alert behavior

By default, five permanent failures within 15 minutes emit one
`webhook_delivery_failure_alert` JSON log entry at `error` level:

```json
{
  "level": "error",
  "msg": "webhook_delivery_failure_alert",
  "alert": "webhook_delivery_failures",
  "consumerName": "events.example.com",
  "eventType": "settlement_cycle",
  "failureCount": 5,
  "threshold": 5,
  "windowSeconds": 900
}
```

The consumer name is `WEBHOOK_CONSUMER_NAME`, or the configured webhook URL's
hostname when no name is set. Alert state is independently deduplicated by
consumer and event type, so continued failures do not produce repeated pages.
The first successful delivery emits `webhook_delivery_alert_recovered` and
clears that incident. The rolling failure window also re-arms after it elapses.

The monitor's state is process-local. Configure the log pipeline to page on
`webhook_delivery_failure_alert` and resolve on
`webhook_delivery_alert_recovered`; for multiple bot instances, deduplicate on
`consumerName` and `eventType` in the paging system as well.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `WEBHOOK_CONSUMER_NAME` | URL hostname | Friendly consumer label in alert records. |
| `WEBHOOK_FAILURE_ALERT_THRESHOLD` | `5` | Failures in the window required to trigger an alert. |
| `WEBHOOK_FAILURE_WINDOW_SECONDS` | `900` | Rolling failure window. |

These settings are optional and only apply when `WEBHOOK_URL` is configured.
See the [settlement bot deployment guide](../bot/DEPLOYMENT.md#environment-variables)
for webhook and timeout configuration.

## Triage

1. Filter bot JSON logs for the consumer's `webhook_delivery_failure_alert`.
2. Check the `WEBHOOK_URL` target, DNS/network reachability, HTTP status, and
   the consumer's availability. A `Webhook delivery failed permanently after
   retries` log includes the final delivery error and correlation context.
3. Inspect the bot's `data/webhook-dead-letter.jsonl` for payloads that must be
   replayed after the consumer recovers. Protect this file as it contains event
   payload data.
4. Confirm a subsequent successful delivery produced
   `webhook_delivery_alert_recovered`.
