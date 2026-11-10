import type { MetadataRoute } from 'next';
import { absolute, site } from '@/lib/site';

export const dynamic = 'force-dynamic';

/** Staging and other non-production sites (SITE_INDEXABLE not "true") ask every crawler to stay out. */
export default function robots(): MetadataRoute.Robots {
  if (!site.indexable) return { rules: { userAgent: '*', disallow: '/' } };
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/booking/', '/p/', '/post/'] },
    sitemap: absolute('/sitemap.xml'),
    host: site.url,
  };
}
