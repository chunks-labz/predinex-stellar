import type { MetadataRoute } from 'next';

/**
 * Web app manifest (served at `/manifest.webmanifest`). Provides the metadata
 * required for installability: name, icons (192/512 + maskable), theme/background
 * colors and a standalone display mode.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Predinex — Prediction Markets on Stellar',
    short_name: 'Predinex',
    description:
      'Decentralized prediction markets on Stellar. Predict, bet, and win with Soroban-powered smart contracts.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#050505',
    theme_color: '#8b5cf6',
    categories: ['finance', 'productivity'],
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
