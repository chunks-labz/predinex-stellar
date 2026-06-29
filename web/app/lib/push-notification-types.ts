export const PUSH_NOTIFICATION_EVENT_TYPES = [
  'pool_settled',
  'pool_expiring_24h',
  'claim_available',
  'dispute_filed',
] as const;

export type PushNotificationEventType = (typeof PUSH_NOTIFICATION_EVENT_TYPES)[number];

export interface NotificationPreferences {
  poolSettled: boolean;
  poolExpiring24h: boolean;
  claimAvailable: boolean;
  disputeFiled: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  poolSettled: true,
  poolExpiring24h: true,
  claimAvailable: true,
  disputeFiled: true,
};

export interface WebPushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

export interface WebPushSubscriptionPayload {
  endpoint: string;
  expirationTime?: number | null;
  keys: WebPushSubscriptionKeys;
}

export interface PushNotificationPayload {
  title?: string;
  body?: string;
  icon?: string;
  url?: string;
  eventType?: PushNotificationEventType;
  poolId?: string | number;
  disputeId?: string | number;
  claimId?: string | number;
}
