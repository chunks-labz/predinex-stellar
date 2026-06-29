'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  addNotification,
  loadNotifications,
  markAllRead as storeMarkAllRead,
  markRead as storeMarkRead,
  type InAppNotification,
  type InAppNotificationType,
} from '../notifications-store';

export type { InAppNotification, InAppNotificationType };

const STORAGE_EVENT = 'storage';

export function useNotifications(userId?: string | null) {
  const [notifications, setNotifications] = useState<InAppNotification[]>(() =>
    loadNotifications(userId),
  );

  // Reload when userId changes
  useEffect(() => {
    setNotifications(loadNotifications(userId));
  }, [userId]);

  // Sync across tabs
  useEffect(() => {
    const handler = () => setNotifications(loadNotifications(userId));
    window.addEventListener(STORAGE_EVENT, handler);
    return () => window.removeEventListener(STORAGE_EVENT, handler);
  }, [userId]);

  const notify = useCallback(
    (notification: Omit<InAppNotification, 'id' | 'read' | 'createdAt'>) => {
      setNotifications(addNotification(notification, userId));
    },
    [userId],
  );

  const markRead = useCallback(
    (id: string) => {
      setNotifications(storeMarkRead(id, userId));
    },
    [userId],
  );

  const markAllRead = useCallback(() => {
    setNotifications(storeMarkAllRead(userId));
  }, [userId]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return { notifications, notify, markRead, markAllRead, unreadCount };
}
