// The parts of the public API's responses these pages read.

export interface ImageVariant {
  width: number;
  url: string;
}
export interface Media {
  id: string;
  kind: 'IMAGE' | 'VIDEO';
  status: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  images?: ImageVariant[];
  hls?: string;
  poster?: string;
}

export interface Pet {
  id: string;
  name: string;
  handle: string;
  avatarUrl: string | null;
  coverUrl?: string | null;
  species: { key: string; name: string };
  breed: { name: string } | null;
  isVerified: boolean;
  followerCount: number;
  gender?: 'MALE' | 'FEMALE' | 'UNKNOWN';
  ageMonths?: number | null;
  about?: string | null;
  personality?: string[];
  city?: string | null;
  restricted: boolean;
  createdAt?: string;
}

export interface Post {
  id: string;
  type: 'PHOTO' | 'REEL';
  caption: string | null;
  locationName: string | null;
  pets: Array<{ id: string; name: string; handle: string; avatarUrl: string | null }>;
  hashtags: string[];
  media: Media[];
  counts: { likes: number; comments: number; views: number };
  publishedAt: string | null;
}

/** A review from a delivered order or a completed booking (Phase 9b). */
export interface Review {
  id: string;
  rating: number;
  comment: string | null;
  photos: Media[];
  reply: string | null;
  /** First name and initial. */
  by: string;
  at: string;
  verified: boolean;
  variantTitle?: string | null;
}

export interface RatingSummary {
  avg: number;
  count: number;
  stars: Array<{ stars: number; count: number }>;
}

export interface Product {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  brand: string | null;
  category: { name: string } | null;
  vendor: { businessName: string; city: string | null; ratingAvg: number; ratingCount: number };
  ratingAvg?: number;
  ratingCount?: number;
  ratingSummary?: RatingSummary;
  reviews?: Review[];
  images: Media[];
  variants: Array<{
    id: string;
    title: string;
    sku: string | null;
    mrpPaise: number;
    pricePaise: number;
    inStock: boolean;
  }>;
}

export interface Partner {
  id: string;
  slug: string;
  businessName: string;
  about: string | null;
  area: string | null;
  city: string;
  addressLine: string;
  lat: number;
  lng: number;
  homeVisitRadiusKm: number;
  ratingAvg: number;
  ratingCount: number;
  services: Array<{
    id: string;
    name: string;
    description: string | null;
    category: { name: string };
    durationMin: number;
    pricePaise: number;
    modes: string[];
  }>;
  hours: Array<{ weekday: number; opensMin: number; closesMin: number }>;
  ratingSummary?: RatingSummary;
  reviews: Review[];
}

export interface Contest {
  id: string;
  slug: string;
  title: string;
  bannerUrl: string | null;
  category: { name: string } | null;
  status: string;
  feePaise: number;
  entries: number;
  maxParticipants: number | null;
  registrationOpensAt: string;
  registrationClosesAt: string;
  submissionClosesAt: string | null;
  votingClosesAt: string | null;
  prizes: Array<{
    rank: number;
    title: string;
    kind: string;
    amountPaise: number | null;
    description?: string | null;
  }>;
  description: string | null;
  rules: string | null;
  publicWeight: number;
  votesPerUserPerDay: number;
  cancelReason: string | null;
  tasks: Array<{ id: string; title: string; description: string | null }>;
}

export interface Challenge {
  id: string;
  slug: string;
  title: string;
  bannerUrl: string | null;
  kind: string;
  feePaise: number;
  startsAt: string;
  endsAt: string;
  status: string;
  requiredCheckIns: number;
  proof: string;
  pointsPerCheckIn: number;
  participants: number;
  badge: { name: string; iconUrl: string | null } | null;
  description: string | null;
}

export interface LegalSummary {
  slug: string;
  title: string;
  version: number;
  effectiveAt: string | null;
}
export interface LegalDoc extends LegalSummary {
  body: string;
  changeSummary: string | null;
}

export interface SitemapEntry {
  key: string;
  updatedAt: string;
}
export interface Sitemap {
  pets: SitemapEntry[];
  products: SitemapEntry[];
  services: SitemapEntry[];
  contests: SitemapEntry[];
  challenges: SitemapEntry[];
  legal: SitemapEntry[];
}

/** The best image URL at or above a width (falls back to the largest). */
export function pickImage(m: Media | undefined, width = 1080): string | null {
  if (!m) return null;
  if (m.kind === 'VIDEO') return m.poster ?? null;
  const imgs = [...(m.images ?? [])].sort((a, b) => a.width - b.width);
  return (imgs.find((i) => i.width >= width) ?? imgs[imgs.length - 1])?.url ?? null;
}

/** The help center (Phase 9a): published questions for the customer app. */
export interface HelpCenter {
  categories: Array<{ id: string; key: string; name: string }>;
  faqs: Array<{ id: string; question: string; answer: string; categoryId: string | null }>;
}
