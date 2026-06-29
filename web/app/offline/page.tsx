'use client';

import { WifiOff, RefreshCw } from 'lucide-react';

/**
 * Offline fallback page. The service worker serves this route when a navigation
 * fails and no cached copy of the requested page is available.
 */
export default function OfflinePage() {
  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-card/40">
          <WifiOff className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-bold mb-2">You&apos;re offline</h1>
        <p className="text-muted-foreground mb-8">
          Predinex can&apos;t reach the network right now. Check your connection — any
          pages you&apos;ve already visited remain available offline.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Try again
        </button>
      </div>
    </main>
  );
}
