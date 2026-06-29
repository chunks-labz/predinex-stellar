import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  markPushPermissionPromptShown,
  shouldShowFirstVisitPushPrompt,
  subscribeToPredinexPush,
} from '../../app/lib/notifications';

const originalEnv = process.env;

function installPushSupport(permission: NotificationPermission = 'default') {
  Object.defineProperty(window, 'Notification', {
    configurable: true,
    value: {
      permission,
      requestPermission: vi.fn().mockResolvedValue(permission),
    },
  });

  Object.defineProperty(window, 'PushManager', {
    configurable: true,
    value: function PushManager() {},
  });

  const subscription = {
    endpoint: 'https://push.example.test/subscription/1',
    toJSON: () => ({
      endpoint: 'https://push.example.test/subscription/1',
      expirationTime: null,
      keys: {
        p256dh: 'p256dh-key-with-enough-length',
        auth: 'auth-key-with-enough-length',
      },
    }),
  };

  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      getRegistration: vi.fn().mockResolvedValue(undefined),
      register: vi.fn().mockResolvedValue({
        pushManager: {
          getSubscription: vi.fn().mockResolvedValue(null),
          subscribe: vi.fn().mockResolvedValue(subscription),
        },
      }),
    },
  });
}

describe('push notification helpers', () => {
  beforeEach(() => {
    localStorage.clear();
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_VAPID_PUBLIC_KEY:
        'BEl62iUYgUivxIkv69yViEuiBIa40HIH9D99Jcn6b4CWNcrfIjm16EqxKWg2nq0TM0YkQgS9Pifm_ZvAF4p6lqE',
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 201 }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = originalEnv;
  });

  it('shows the first-visit prompt once while permission is undecided', () => {
    installPushSupport('default');

    expect(shouldShowFirstVisitPushPrompt()).toBe(true);
    markPushPermissionPromptShown();
    expect(shouldShowFirstVisitPushPrompt()).toBe(false);
  });

  it('does not show the first-visit prompt after permission is denied', () => {
    installPushSupport('denied');

    expect(shouldShowFirstVisitPushPrompt()).toBe(false);
  });

  it('saves the push subscription after permission has been granted', async () => {
    installPushSupport('granted');

    await subscribeToPredinexPush({
      userId: 'GABC123',
      preferences: {
        poolSettled: true,
        poolExpiring24h: true,
        claimAvailable: true,
        disputeFiled: false,
      },
    });

    expect(fetch).toHaveBeenCalledWith(
      '/api/push-subscriptions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-predinex-wallet-address': 'GABC123',
        }),
      }),
    );
  });
});
