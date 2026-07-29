import type { MetadataRoute } from 'next';

import { getSiteUrl } from '../lib/site-url';

export default function robots(): MetadataRoute.Robots {
  // Resolved per deployment so previews advertise their own sitemap, not production's.
  const siteUrl = getSiteUrl();

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
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
