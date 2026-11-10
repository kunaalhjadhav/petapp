import type { Metadata } from 'next';
import { absolute, site } from './site';

/** Title, description, canonical URL, Open Graph and Twitter card for a page. */
export function pageMeta(o: {
  title: string;
  description: string;
  path: string;
  image?: string | null;
  type?: 'website' | 'article' | 'profile' | 'video.other';
  noindex?: boolean;
}): Metadata {
  const url = absolute(o.path);
  // Pages without a photo share the PetApp card (/og).
  const image = o.image || absolute('/og');
  const images = [{ url: image }];
  return {
    title: o.title,
    description: o.description,
    alternates: { canonical: url },
    openGraph: {
      title: o.title,
      description: o.description,
      url,
      type: o.type ?? 'website',
      siteName: 'PetApp',
      locale: 'en_IN',
      images,
    },
    twitter: {
      card: 'summary_large_image',
      title: o.title,
      description: o.description,
      images: [image],
    },
    robots: o.noindex || !site.indexable ? { index: false, follow: !o.noindex } : undefined,
  };
}
