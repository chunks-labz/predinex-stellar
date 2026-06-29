import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function loadServiceWorker() {
  const listeners = new Map<string, (event: any) => void>();
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const openWindow = vi.fn().mockResolvedValue(undefined);
  const focus = vi.fn().mockResolvedValue(undefined);
  const navigate = vi.fn().mockResolvedValue(undefined);

  const self = {
    location: { origin: 'https://predinex.test' },
    registration: { showNotification },
    clients: {
      matchAll: vi.fn().mockResolvedValue([
        {
          url: 'https://predinex.test/dashboard',
          focus,
          navigate,
        },
      ]),
      openWindow,
    },
    addEventListener: (eventName: string, listener: (event: any) => void) => {
      listeners.set(eventName, listener);
    },
    skipWaiting: vi.fn(),
  };

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const code = fs.readFileSync(path.resolve(currentDir, '../../public/sw.js'), 'utf8');
  vm.runInNewContext(code, {
    self,
    URL,
    Response,
    caches: { open: vi.fn(), keys: vi.fn() },
    fetch: vi.fn(),
    Promise,
  });

  return { listeners, showNotification, openWindow, focus, navigate };
}

describe('service worker push handling', () => {
  it('renders notification payload title, body, icon, and URL data', async () => {
    const { listeners, showNotification } = loadServiceWorker();
    let promise: Promise<unknown> | undefined;

    listeners.get('push')?.({
      data: {
        json: () => ({
          eventType: 'claim_available',
          title: 'Claim your winnings',
          body: 'Pool #7 has winnings ready.',
          icon: '/icons/icon-512.png',
          url: '/markets/7',
          poolId: 7,
          claimId: 'claim-7',
        }),
      },
      waitUntil: (next: Promise<unknown>) => {
        promise = next;
      },
    });

    await promise;

    expect(showNotification).toHaveBeenCalledWith(
      'Claim your winnings',
      expect.objectContaining({
        body: 'Pool #7 has winnings ready.',
        icon: '/icons/icon-512.png',
        data: expect.objectContaining({
          url: '/markets/7',
          eventType: 'claim_available',
          poolId: 7,
          claimId: 'claim-7',
        }),
      }),
    );
  });

  it('focuses an existing app tab and navigates it on notification click', async () => {
    const { listeners, focus, navigate, openWindow } = loadServiceWorker();
    let promise: Promise<unknown> | undefined;

    listeners.get('notificationclick')?.({
      notification: {
        close: vi.fn(),
        data: { url: '/disputes?dispute=3' },
      },
      waitUntil: (next: Promise<unknown>) => {
        promise = next;
      },
    });

    await promise;

    expect(focus).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('https://predinex.test/disputes?dispute=3');
    expect(openWindow).not.toHaveBeenCalled();
  });
});
