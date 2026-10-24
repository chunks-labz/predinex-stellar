import type { MetadataRoute } from 'next';

import { getSiteUrl } from '../lib/site-url';

const STATIC_ROUTES: Array<{
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'];
  priority: number;
}> = [
  { path: '/', changeFrequency: 'daily', priority: 1 },
  { path: '/markets', changeFrequency: 'hourly', priority: 0.9 },
  { path: '/pools', changeFrequency: 'hourly', priority: 0.9 },
  { path: '/leaderboard', changeFrequency: 'daily', priority: 0.6 },
  { path: '/rewards', changeFrequency: 'daily', priority: 0.6 },
  { path: '/incentives', changeFrequency: 'daily', priority: 0.6 },
  { path: '/compare', changeFrequency: 'weekly', priority: 0.5 },
  { path: '/activity', changeFrequency: 'hourly', priority: 0.5 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  // Same per-deployment origin robots.txt advertises.
  const siteUrl = getSiteUrl();

  return STATIC_ROUTES.map(({ path, changeFrequency, priority }) => ({
    url: `${siteUrl}${path}`,
    lastModified,
    changeFrequency,
    priority,
  }));
}
