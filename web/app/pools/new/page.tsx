'use client';
/**
 * Pool creation page (Issue #677).
 *
 * Composes the navbar, error boundary, auth guard and the
 * `CreatePoolForm` component. On a successful submission it redirects the
 * user to the new pool's detail page once the read API can locate it.
 */

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import AuthGuard from '@/components/AuthGuard';
import RouteErrorBoundary from '@/components/RouteErrorBoundary';
import { CreatePoolForm } from '@/components/pools/CreatePoolForm';
import { predinexReadApi } from '@/lib/contract';
import { createScopedLogger } from '@/app/lib/logger';

const log = createScopedLogger('CreatePoolPage');

const POOL_INDEX_RETRY_DELAY_MS = 1500;
const POOL_INDEX_MAX_RETRIES = 6;

/**
 * Try to resolve the freshly-created pool id by polling the pool count
 * from the read API. The contract transaction hash can be inspected for
 * events in a future iteration.
 */
async function findLatestPoolId(): Promise<number | null> {
  try {
    let lastCount: number | null = null;
    for (let attempt = 0; attempt < POOL_INDEX_MAX_RETRIES; attempt += 1) {
      const count = await predinexReadApi.getPoolCount();
      if (typeof count === 'number' && count > 0) {
        lastCount = count;
        // The latest pool id is the count minus one (0-indexed).
        const candidate = count - 1;
        // Light-weight verification: the candidate exists.
        const pool = await predinexReadApi.getPool(candidate);
        if (pool) return candidate;
      }
      await new Promise((resolve) => setTimeout(resolve, POOL_INDEX_RETRY_DELAY_MS));
    }
    return lastCount !== null ? lastCount - 1 : null;
  } catch (err) {
    log.warn('findLatestPoolId lookup failed:', err);
    return null;
  }
}

export default function NewPoolPage() {
  const router = useRouter();
  const [redirecting, setRedirecting] = useState(false);

  const handleSuccess = useCallback(
    async ({ txHash }: { txHash: string; poolId: number | null }) => {
      log.info('Pool created, locating new pool id', { txHash });
      setRedirecting(true);
      const newPoolId = await findLatestPoolId();
      if (newPoolId !== null && newPoolId >= 0) {
        router.push(`/pools/${newPoolId}`);
        return;
      }
      // Fall back to the markets listing when the pool id cannot be derived.
      router.push('/markets');
    },
    [router]
  );

  return (
    <main className="min-h-screen bg-background text-foreground">
      <Navbar />
      <RouteErrorBoundary routeName="CreatePool">
        <AuthGuard>
          <div className="container mx-auto px-4 py-12 max-w-2xl">
            <div className="mb-6">
              <Link
                href="/markets"
                className="text-sm text-muted-foreground hover:text-primary"
              >
                ← Back to markets
              </Link>
            </div>

            <header className="mb-8">
              <h1 className="text-3xl font-bold">Create a new pool</h1>
              <p className="mt-2 text-muted-foreground">
                Set the pool&apos;s name, description, asset, deposit amount and expiry. The
                transaction will prompt your wallet, and you&apos;ll be redirected to the
                new pool once it has been confirmed.
              </p>
            </header>

            <section className="p-6 rounded-xl border border-border bg-card/40">
              {redirecting ? (
                <p
                  role="status"
                  className="text-sm text-muted-foreground"
                  data-testid="pool-redirecting"
                >
                  Transaction confirmed. Finding your new pool…
                </p>
              ) : (
                <CreatePoolForm onSuccess={handleSuccess} />
              )}
            </section>
          </div>
        </AuthGuard>
      </RouteErrorBoundary>
    </main>
  );
}
