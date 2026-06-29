import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNotifications } from '../../app/lib/hooks/useNotifications';

describe('useNotifications', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('starts with empty notifications', () => {
    const { result } = renderHook(() => useNotifications());
    expect(result.current.notifications).toHaveLength(0);
    expect(result.current.unreadCount).toBe(0);
  });

  it('adds a notification and increments unreadCount', () => {
    const { result } = renderHook(() => useNotifications());

    act(() => {
      result.current.notify({
        type: 'pool_settled',
        title: 'Pool Settled',
        body: 'Pool #1 has been settled.',
        poolId: 1,
      });
    });

    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0].read).toBe(false);
    expect(result.current.unreadCount).toBe(1);
  });

  it('marks a single notification as read', () => {
    const { result } = renderHook(() => useNotifications());

    act(() => {
      result.current.notify({ type: 'claim_available', title: 'Claim', body: 'Claim ready', poolId: 2 });
    });

    const id = result.current.notifications[0].id;

    act(() => {
      result.current.markRead(id);
    });

    expect(result.current.notifications[0].read).toBe(true);
    expect(result.current.unreadCount).toBe(0);
  });

  it('marks all notifications as read', () => {
    const { result } = renderHook(() => useNotifications());

    act(() => {
      result.current.notify({ type: 'pool_settled', title: 'A', body: 'B' });
      result.current.notify({ type: 'dispute_filed', title: 'C', body: 'D' });
    });

    expect(result.current.unreadCount).toBe(2);

    act(() => {
      result.current.markAllRead();
    });

    expect(result.current.unreadCount).toBe(0);
    expect(result.current.notifications.every((n) => n.read)).toBe(true);
  });

  it('persists notifications to localStorage', () => {
    const { result } = renderHook(() => useNotifications('user1'));

    act(() => {
      result.current.notify({ type: 'pool_expiring_24h', title: 'Expiring', body: 'Soon' });
    });

    const stored = JSON.parse(window.localStorage.getItem('predinex_inapp_notifications_v1_user1') ?? '[]');
    expect(stored).toHaveLength(1);
    expect(stored[0].type).toBe('pool_expiring_24h');
  });

  it('reloads notifications when userId changes', () => {
    // Seed storage for user2
    window.localStorage.setItem(
      'predinex_inapp_notifications_v1_user2',
      JSON.stringify([{ id: 'x', type: 'pool_settled', title: 'T', body: 'B', read: false, createdAt: Date.now() }]),
    );

    const { result, rerender } = renderHook(({ uid }) => useNotifications(uid), {
      initialProps: { uid: 'user1' as string | undefined },
    });

    expect(result.current.notifications).toHaveLength(0);

    act(() => {
      rerender({ uid: 'user2' });
    });

    expect(result.current.notifications).toHaveLength(1);
  });
});
