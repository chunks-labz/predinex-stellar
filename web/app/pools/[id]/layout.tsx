import type { Metadata } from 'next';
import { getPoolFromSoroban } from '../../lib/soroban-read-api';
import {
  buildPoolMetadata,
  buildFallbackMetadata,
} from '../../lib/metadata';

interface PoolDetailLayoutProps {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
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
    const result = await getPoolFromSoroban(poolId);
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

export default function PoolDetailLayout({ children }: PoolDetailLayoutProps) {
  return <>{children}</>;
}
