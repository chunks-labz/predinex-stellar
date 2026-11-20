import type { Metadata } from 'next';
import { unstable_cache } from 'next/cache';
import { getPoolFromSoroban } from '../../lib/soroban-read-api';
import {
  buildPoolMetadata,
  buildFallbackMetadata,
} from '../../lib/metadata';

interface PoolLayoutProps {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}

/**
 * Cache TTL for server-side pool metadata fetches (60 seconds).
 *
 * This prevents `generateMetadata` from hitting the Soroban RPC on every
 * request for the same pool.  The cache is keyed by pool ID and tagged so it
 * can be invalidated on demand (e.g. after settlement).
 */
const METADATA_CACHE_TTL_S = 60;

/**
 * Thin cached wrapper around `getPoolFromSoroban`.
 *
 * `unstable_cache` memoises the result across concurrent server renders and
 * between navigations for the same pool ID, reducing redundant RPC round-trips.
 */
function getCachedPoolForMetadata(poolId: number) {
  return unstable_cache(
    () => getPoolFromSoroban(poolId),
    [`pool-metadata-${poolId}`],
    {
      revalidate: METADATA_CACHE_TTL_S,
      tags: [`pool-${poolId}`],
    },
  )();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const poolId = parseInt(id, 10);

  if (Number.isNaN(poolId)) {
    return buildFallbackMetadata();
  }

  try {
    const result = await getCachedPoolForMetadata(poolId);
    const pool = result.pool;

    if (!pool) {
      return buildFallbackMetadata(poolId);
    }

    return buildPoolMetadata({
      poolId,
      title: pool.title,
      description: pool.description,
      outcomeA: pool.outcomeA,
      outcomeB: pool.outcomeB,
    });
  } catch {
    return buildFallbackMetadata(poolId);
  }
}

export default function PoolLayout({ children }: PoolLayoutProps) {
  return <>{children}</>;
}
