'use client';

import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';

/** The non-standard `beforeinstallprompt` event exposed by Chromium browsers. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** When the user last dismissed the banner (epoch ms). */
export const PWA_INSTALL_DISMISSED_KEY = 'predinex:pwa-install-dismissed-at';
/** How long a dismissal is honoured before the banner may be offered again. */
export const PWA_INSTALL_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

function isSnoozed(): boolean {
  try {
    const dismissedAt = Number(window.localStorage.getItem(PWA_INSTALL_DISMISSED_KEY));
    return Number.isFinite(dismissedAt) && dismissedAt > 0 && Date.now() - dismissedAt < PWA_INSTALL_SNOOZE_MS;
  } catch {
    return false;
  }
}

/**
 * Captures the browser's deferred install prompt and surfaces an "Install"
 * banner. The banner only appears when the browser deems the app installable
 * (i.e. it fired `beforeinstallprompt`), and dismisses itself once installed.
 */
export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      // Prevent the default mini-infobar so we can present our own UI.
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      // The browser fires this on every load, so without remembering the
      // dismissal the banner came straight back after each reload.
      if (!isSnoozed()) setVisible(true);
    };

    const onAppInstalled = () => {
      setVisible(false);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  if (!visible || !deferredPrompt) return null;

  const handleInstall = async () => {
    try {
      // `prompt()` rejects if the event was already used; don't leave the
      // banner stuck on screen when it does.
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
    } catch {
      // Ignore — the prompt result is best-effort.
    }
    setVisible(false);
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    try {
      window.localStorage.setItem(PWA_INSTALL_DISMISSED_KEY, String(Date.now()));
    } catch {
      // Storage unavailable — the banner simply hides for this page view.
    }
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Install Predinex"
      className="fixed bottom-4 left-1/2 z-50 w-[min(92vw,28rem)] -translate-x-1/2 rounded-2xl border border-border bg-card/95 p-4 shadow-xl backdrop-blur-md"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
          <Download className="h-5 w-5 text-primary" aria-hidden="true" />
        </div>
        <div className="min-w-0 grow">
          <p className="text-sm font-bold">Install Predinex</p>
          <p className="text-xs text-muted-foreground">
            Add the app to your home screen for faster, offline-ready access.
          </p>
        </div>
        <button
          type="button"
          onClick={handleInstall}
          className="shrink-0 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Install
        </button>
        <button
          type="button"
          aria-label="Dismiss install prompt"
          onClick={handleDismiss}
          className="shrink-0 rounded-lg p-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
