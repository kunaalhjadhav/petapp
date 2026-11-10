import type { MetadataRoute } from 'next';
import { get } from '@/lib/api';
import { webPath, type LinkKind } from '@/lib/links';
import { absolute } from '@/lib/site';
import type { Sitemap } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Public pets, products, service partners, contests, challenges and policies, from the API (cached there for 10 minutes). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const s = await get<Sitemap>('/public/sitemap', 600);
  const out: MetadataRoute.Sitemap = [
    { url: absolute('/'), changeFrequency: 'daily', priority: 1 },
    { url: absolute('/legal'), changeFrequency: 'monthly', priority: 0.2 },
    { url: absolute('/help'), changeFrequency: 'weekly', priority: 0.3 },
    { url: absolute('/account-deletion'), changeFrequency: 'yearly', priority: 0.1 },
  ];
  if (!s) return out;
  const add = (
    kind: LinkKind,
    entries: Sitemap['pets'],
    changeFrequency: 'daily' | 'weekly',
    priority: number,
  ) => {
    for (const e of entries)
      out.push({
        url: absolute(webPath(kind, e.key)),
        lastModified: e.updatedAt,
        changeFrequency,
        priority,
      });
  };
  add('contest', s.contests, 'daily', 0.8);
  add('challenge', s.challenges, 'daily', 0.6);
  add('service', s.services, 'weekly', 0.7);
  add('product', s.products, 'weekly', 0.7);
  add('pet', s.pets, 'weekly', 0.5);
  for (const e of s.legal)
    out.push({
      url: absolute(`/legal/${e.key}`),
      lastModified: e.updatedAt,
      changeFrequency: 'monthly',
      priority: 0.2,
    });
  return out;
}
