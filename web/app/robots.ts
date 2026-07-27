import type { MetadataRoute } from 'next';

const SITE_URL = (process.env['NEXT_PUBLIC_APP_URL'] ?? 'https://predinex.io').replace(/\/$/, '');

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/admin/',
        '/debug/',
        '/settings/',
        '/dashboard/',
        '/oracle-management/',
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
