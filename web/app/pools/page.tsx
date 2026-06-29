'use client';
/**
 * Pool index page — provides a stable `/pools` route so internal navigation
 * (navbar "Create pool" link, "← Back" links, etc.) has a landing target.
 *
 * In the current implementation pools and prediction markets resolve to the
 * same on-chain entity, so this view redirects to the markets page. A
 * dedicated pool listing view (multi-asset) can be added here without
 * touching the rest of the app.
 */

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import RouteErrorBoundary from '@/components/RouteErrorBoundary';

export default function PoolsIndexPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/markets');
  }, [router]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <Navbar />
      <RouteErrorBoundary routeName="PoolsIndex">
        <div className="container mx-auto px-4 py-16 max-w-3xl">
          <header className="mb-8 flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-3xl font-bold">Pools</h1>
              <p className="mt-2 text-muted-foreground">
                Browse pools or spin up a new one. Redirecting to the markets
                list…
              </p>
            </div>
            <Link
              href="/pools/new"
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground font-semibold hover:brightness-110 transition-all"
            >
              Create pool
            </Link>
          </header>

          <p
            role="status"
            className="text-sm text-muted-foreground"
            data-testid="pools-redirecting"
          >
            Taking you to the markets page…
          </p>

          <p className="mt-6 text-sm">
            <Link
              href="/markets"
              className="text-primary hover:underline"
            >
              Go to markets now →
            </Link>
          </p>
        </div>
      </RouteErrorBoundary>
    </main>
  );
}
