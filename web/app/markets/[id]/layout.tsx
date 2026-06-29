import type { Metadata } from 'next';
import { getPoolFromSoroban } from '../../lib/soroban-read-api';

interface PoolLayoutProps {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const poolId = parseInt(id, 10);

  const siteUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://predinex.io';
  const fallbackTitle = 'Predinex | Prediction Markets on Stellar';
  const fallbackDescription =
    'Discover and participate in decentralised prediction markets on Stellar. Predict, bet, and win with Soroban-powered smart contracts.';
  const fallbackImage = `${siteUrl}/og-image.png`;

  if (isNaN(poolId)) {
    return {
      title: fallbackTitle,
      description: fallbackDescription,
      openGraph: {
        title: fallbackTitle,
        description: fallbackDescription,
        images: [{ url: fallbackImage, width: 1200, height: 630 }],
      },
      twitter: {
        card: 'summary_large_image',
        title: fallbackTitle,
        description: fallbackDescription,
        images: [fallbackImage],
      },
    };
  }

  try {
    const result = await getPoolFromSoroban(poolId);
    const pool = result.pool;

    if (!pool) {
      return {
        title: `Pool #${poolId} Not Found | Predinex`,
        description: fallbackDescription,
        openGraph: {
          title: `Pool #${poolId} Not Found | Predinex`,
          description: fallbackDescription,
          images: [{ url: fallbackImage, width: 1200, height: 630 }],
        },
        twitter: {
          card: 'summary_large_image',
          title: `Pool #${poolId} Not Found | Predinex`,
          description: fallbackDescription,
          images: [fallbackImage],
        },
      };
    }

    const title = `${pool.title} | Predinex`;
    const description =
      pool.description ||
      `Predict on "${pool.title}" — ${pool.outcomeA} vs ${pool.outcomeB}. Join the pool on Predinex.`;
    const ogImageUrl = `${siteUrl}/api/og/pool/${poolId}`;
    const poolUrl = `${siteUrl}/markets/${poolId}`;

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        url: poolUrl,
        siteName: 'Predinex',
        images: [
          {
            url: ogImageUrl,
            width: 1200,
            height: 630,
            alt: pool.title,
          },
        ],
        locale: 'en_US',
        type: 'website',
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        images: [ogImageUrl],
      },
    };
  } catch {
    return {
      title: fallbackTitle,
      description: fallbackDescription,
      openGraph: {
        title: fallbackTitle,
        description: fallbackDescription,
        images: [{ url: fallbackImage, width: 1200, height: 630 }],
      },
      twitter: {
        card: 'summary_large_image',
        title: fallbackTitle,
        description: fallbackDescription,
        images: [fallbackImage],
      },
    };
  }
}

export default function PoolLayout({ children }: PoolLayoutProps) {
  return <>{children}</>;
}
