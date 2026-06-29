/**
 * In-app notification store.
 * Notifications are persisted to localStorage and keyed per wallet address.
 */

export type InAppNotificationType =
  | 'pool_settled'
  | 'pool_expiring_24h'
  | 'claim_available'
  | 'dispute_filed';

export interface InAppNotification {
  id: string;
  type: InAppNotificationType;
  title: string;
  body: string;
  poolId?: number;
  read: boolean;
  createdAt: number; // unix ms
}

const STORAGE_KEY_PREFIX = 'predinex_inapp_notifications_v1';

function storageKey(userId?: string | null): string {
  return userId ? `${STORAGE_KEY_PREFIX}_${userId}` : STORAGE_KEY_PREFIX;
}

export function loadNotifications(userId?: string | null): InAppNotification[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    return raw ? (JSON.parse(raw) as InAppNotification[]) : [];
  } catch {
    return [];
  }
}

export function saveNotifications(notifications: InAppNotification[], userId?: string | null): void {
  if (typeof window === 'undefined') return;
  // Keep at most 100 notifications
  const trimmed = notifications.slice(0, 100);
  window.localStorage.setItem(storageKey(userId), JSON.stringify(trimmed));
}

export function addNotification(
  notification: Omit<InAppNotification, 'id' | 'read' | 'createdAt'>,
  userId?: string | null,
): InAppNotification[] {
  const existing = loadNotifications(userId);
  const newItem: InAppNotification = {
    ...notification,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    read: false,
    createdAt: Date.now(),
  };
  const updated = [newItem, ...existing];
  saveNotifications(updated, userId);
  return updated;
}

export function markRead(id: string, userId?: string | null): InAppNotification[] {
  const updated = loadNotifications(userId).map((n) => (n.id === id ? { ...n, read: true } : n));
  saveNotifications(updated, userId);
  return updated;
}

export function markAllRead(userId?: string | null): InAppNotification[] {
  const updated = loadNotifications(userId).map((n) => ({ ...n, read: true }));
  saveNotifications(updated, userId);
  return updated;
}

export function clearAll(userId?: string | null): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(storageKey(userId));
}

export const NOTIFICATION_LABELS: Record<InAppNotificationType, string> = {
  pool_settled: 'Pool Settled',
  pool_expiring_24h: 'Pool Expiring Soon',
  claim_available: 'Claim Available',
  dispute_filed: 'Dispute Filed',
};
