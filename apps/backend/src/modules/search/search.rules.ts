// Global search (spec §43): what can be searched, how a query is cleaned up, and how matches are ranked.

export const SEARCH_TYPES = ['pets', 'users', 'reels', 'products', 'services', 'partners', 'contests', 'challenges'] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

/** Collapses spaces, drops a leading @ or #, and caps the length. Returns null when it's too short to search. */
export function cleanQuery(raw: string | null | undefined, minChars = 2): { text: string; hashtag: boolean; handle: boolean } | null {
  const t = (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const hashtag = t.startsWith('#');
  const handle = t.startsWith('@');
  const text = t.replace(/^[#@]+/, '').trim();
  return text.length >= minChars ? { text, hashtag, handle } : null;
}

/**
 * How well a name matches (lower is better): 0 exact, 1 starts with it, 2 a word starts with it, 3 contains it,
 * 4 no direct match (found through another field).
 */
export function matchRank(name: string | null | undefined, q: string): number {
  const n = (name ?? '').toLowerCase();
  const s = q.toLowerCase();
  if (!n) return 4;
  if (n === s) return 0;
  if (n.startsWith(s)) return 1;
  if (n.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(s))) return 2;
  return n.includes(s) ? 3 : 4;
}

/** Where a result opens in the apps and on the website (the same keys as deep links). */
export type SearchLink = { kind: 'pet' | 'user' | 'reel' | 'product' | 'service' | 'contest' | 'challenge'; key: string };

export interface SearchHit {
  type: 'PET' | 'USER' | 'REEL' | 'PRODUCT' | 'SERVICE' | 'PARTNER' | 'CONTEST' | 'CHALLENGE';
  id: string;
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  link: SearchLink;
  /** Type-specific facts for the result row: price, rating, distance, status… */
  meta: Record<string, string | number | boolean | null>;
}

/** "1.2 km" / "800 m" for services and partners (businesses: exact distances are fine). */
export function distanceText(meters: number | null | undefined): string | null {
  if (meters === null || meters === undefined) return null;
  if (meters < 1000) return `${Math.max(100, Math.round(meters / 100) * 100)} m`;
  return `${(Math.round(meters / 100) / 10).toFixed(1)} km`;
}
