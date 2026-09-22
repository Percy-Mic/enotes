import type { MetadataRoute } from 'next';

const SITE_URL = 'https://enotes-amber.vercel.app';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/dashboard',
          '/feed',
          '/messages',
          '/settings',
          '/notes/',
          '/journals/',
          '/studio/',
          '/communities/',
          '/search',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
