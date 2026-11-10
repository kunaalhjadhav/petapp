// Structured data (schema.org JSON-LD) for the public pages. Pure functions, unit-tested.
import { clip, hhmm, isoDuration, WEEKDAYS } from './format';
import type { Challenge, Contest, Partner, Pet, Post, Product, Review } from './types';
import { pickImage } from './types';

type Ld = Record<string, unknown>;
const ORG = (siteUrl: string): Ld => ({ '@type': 'Organization', name: 'PetApp', url: siteUrl });
const money = (paise: number) => (paise / 100).toFixed(2);

export function websiteLd(siteUrl: string): Ld {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { ...ORG(siteUrl), '@id': `${siteUrl}/#org` },
      {
        '@type': 'WebSite',
        name: 'PetApp',
        url: siteUrl,
        publisher: { '@id': `${siteUrl}/#org` },
        inLanguage: 'en-IN',
      },
    ],
  };
}

export function breadcrumbs(siteUrl: string, items: Array<[string, string]>): Ld {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, path], i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name,
      item: `${siteUrl}${path}`,
    })),
  };
}

/** A pet's public profile. No owner details: the page is about the pet. */
export function petLd(siteUrl: string, p: Pet, url: string): Ld {
  return {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    url,
    name: `${p.name} (@${p.handle})`,
    description: clip(p.about) || undefined,
    image: p.avatarUrl ?? undefined,
    mainEntity: {
      '@type': 'Thing',
      name: p.name,
      alternateName: `@${p.handle}`,
      description: [p.breed?.name, p.species.name].filter(Boolean).join(' '),
      interactionStatistic: {
        '@type': 'InteractionCounter',
        interactionType: 'https://schema.org/FollowAction',
        userInteractionCount: p.followerCount,
      },
    },
    isPartOf: { '@type': 'WebSite', name: 'PetApp', url: siteUrl },
  };
}

/** Rating and the latest reviews, for Product and LocalBusiness data (only once there are reviews). */
export function ratingLd(avg: number | undefined, count: number | undefined, reviews: Review[] | undefined): Ld {
  if (!count) return {};
  return {
    aggregateRating: { '@type': 'AggregateRating', ratingValue: (avg ?? 0).toFixed(1), reviewCount: count, bestRating: 5, worstRating: 1 },
    review: (reviews ?? []).slice(0, 3).map((r) => ({
      '@type': 'Review',
      reviewRating: { '@type': 'Rating', ratingValue: r.rating, bestRating: 5, worstRating: 1 },
      author: { '@type': 'Person', name: r.by },
      datePublished: r.at.slice(0, 10),
      reviewBody: r.comment ? clip(r.comment, 500) : undefined,
    })),
  };
}

export function productLd(p: Product, url: string): Ld {
  const prices = p.variants.map((v) => v.pricePaise);
  const inStock = p.variants.some((v) => v.inStock);
  const availability = `https://schema.org/${inStock ? 'InStock' : 'OutOfStock'}`;
  const offers =
    p.variants.length === 1
      ? {
          '@type': 'Offer',
          url,
          priceCurrency: 'INR',
          price: money(prices[0]),
          availability,
          seller: { '@type': 'Organization', name: p.vendor.businessName },
        }
      : {
          '@type': 'AggregateOffer',
          url,
          priceCurrency: 'INR',
          lowPrice: money(Math.min(...prices)),
          highPrice: money(Math.max(...prices)),
          offerCount: p.variants.length,
          availability,
        };
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.title,
    description: clip(p.description, 500) || undefined,
    image: p.images.map((m) => pickImage(m)).filter(Boolean),
    brand: p.brand ? { '@type': 'Brand', name: p.brand } : undefined,
    category: p.category?.name,
    sku: p.variants.length === 1 ? (p.variants[0].sku ?? undefined) : undefined,
    url,
    offers: p.variants.length ? offers : undefined,
    ...ratingLd(p.ratingAvg, p.ratingCount, p.reviews),
  };
}

/** A service partner as a local business, with hours, services and its rating (only once it has reviews). */
export function partnerLd(p: Partner, url: string): Ld {
  const byDay = new Map<string, string[]>();
  for (const h of p.hours) {
    const k = `${hhmm(h.opensMin)}-${hhmm(h.closesMin)}`;
    byDay.set(k, [...(byDay.get(k) ?? []), WEEKDAYS[h.weekday]]);
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': url,
    name: p.businessName,
    description: clip(p.about, 500) || undefined,
    url,
    address: {
      '@type': 'PostalAddress',
      streetAddress: p.addressLine,
      addressLocality: p.area ?? p.city,
      addressRegion: p.city,
      addressCountry: 'IN',
    },
    geo: { '@type': 'GeoCoordinates', latitude: p.lat, longitude: p.lng },
    openingHoursSpecification: [...byDay].map(([range, days]) => {
      const [opens, closes] = range.split('-');
      return {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: days.map((d) => `https://schema.org/${d}`),
        opens,
        closes,
      };
    }),
    ...ratingLd(p.ratingAvg, p.ratingCount, p.reviews),
    makesOffer: p.services.map((s) => ({
      '@type': 'Offer',
      priceCurrency: 'INR',
      price: money(s.pricePaise),
      itemOffered: {
        '@type': 'Service',
        name: s.name,
        description: s.description ?? undefined,
        category: s.category.name,
      },
    })),
  };
}

const EVENT_STATUS: Record<string, string> = { CANCELLED: 'https://schema.org/EventCancelled' };

/** Contests and challenges are online events. */
export function contestLd(siteUrl: string, c: Contest, url: string): Ld {
  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: c.title,
    description: clip(c.description, 500) || undefined,
    image: c.bannerUrl ?? undefined,
    url,
    startDate: c.registrationOpensAt,
    endDate: c.votingClosesAt ?? c.submissionClosesAt ?? c.registrationClosesAt,
    eventStatus: EVENT_STATUS[c.status] ?? 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
    location: { '@type': 'VirtualLocation', url },
    organizer: ORG(siteUrl),
    offers: {
      '@type': 'Offer',
      url,
      price: money(c.feePaise),
      priceCurrency: 'INR',
      availability: `https://schema.org/${c.status === 'SCHEDULED' || c.status === 'LIVE' ? 'InStock' : 'SoldOut'}`,
      validFrom: c.registrationOpensAt,
    },
  };
}

export function challengeLd(siteUrl: string, c: Challenge, url: string): Ld {
  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: c.title,
    description: clip(c.description, 500) || undefined,
    image: c.bannerUrl ?? undefined,
    url,
    startDate: c.startsAt,
    endDate: c.endsAt,
    eventStatus:
      c.status === 'CANCELLED' ? EVENT_STATUS.CANCELLED : 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
    location: { '@type': 'VirtualLocation', url },
    organizer: ORG(siteUrl),
    offers: { '@type': 'Offer', url, price: money(c.feePaise), priceCurrency: 'INR' },
  };
}

/** A reel is a video; a photo post is a social media post with images. */
export function postLd(siteUrl: string, p: Post, url: string, title: string): Ld {
  const first = p.media[0];
  if (p.type === 'REEL' && first?.kind === 'VIDEO') {
    return {
      '@context': 'https://schema.org',
      '@type': 'VideoObject',
      name: title,
      description: clip(p.caption) || title,
      thumbnailUrl: first.poster ? [first.poster] : undefined,
      uploadDate: p.publishedAt ?? undefined,
      duration: first.durationMs ? isoDuration(first.durationMs) : undefined,
      embedUrl: url,
      interactionStatistic: {
        '@type': 'InteractionCounter',
        interactionType: 'https://schema.org/WatchAction',
        userInteractionCount: p.counts.views,
      },
      publisher: ORG(siteUrl),
    };
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'SocialMediaPosting',
    headline: title,
    articleBody: p.caption ?? undefined,
    image: p.media.map((m) => pickImage(m)).filter(Boolean),
    datePublished: p.publishedAt ?? undefined,
    url,
    publisher: ORG(siteUrl),
  };
}

/** Help center questions. Answers are written in the dashboard's Markdown subset; schema.org wants plain text. */
export function faqLd(faqs: Array<{ question: string; answer: string }>): Ld {
  const plain = (md: string) =>
    md
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/^#{1,3}\s+/gm, '')
      .replace(/^\s*[-*]\s+/gm, '')
      .replace(/\s+/g, ' ')
      .trim();
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: plain(f.answer) } })),
  };
}

/** JSON for a <script type="application/ld+json">: drops empty fields and escapes "<" so text can't end the script. */
export function ldJson(ld: Ld | Ld[]): string {
  return JSON.stringify(ld, (_k, v) =>
    v === undefined || (Array.isArray(v) && v.length === 0) ? undefined : v,
  ).replace(/</g, '\\u003c');
}
