/**
 * Recommendation ranking, as pure functions so every rule is unit-tested.
 *
 * Each ranker scores candidates from simple, explainable signals and returns the reasons that
 * contributed most ("For Bruno", "You bought dog food before", "1.2 km away"). With no signals
 * (signed out, or personalisation off) the same rankers fall back to popularity, rating and distance.
 */

export type LifeStage = 'young' | 'adult' | 'senior';

export interface PetInfo {
  id: string;
  name: string;
  speciesId: string;
  speciesName: string;
  stage: LifeStage | null;
}

/** How strongly someone is interested in a category: purchases/bookings/entries count 3, views 1. */
export interface Affinity {
  weight: number;
  name: string;
  /** Bought, booked or entered (not just viewed). */
  acted: boolean;
}

export interface Ranked<T> {
  item: T;
  score: number;
  reasons: string[];
}

const DAY = 86_400_000;

/** Ages at which a pet counts as young or senior, by species key. Others: young under 1, never senior. */
const STAGES: Record<string, { youngUnder: number; seniorFrom: number | null }> = {
  dog: { youngUnder: 1, seniorFrom: 7 },
  cat: { youngUnder: 1, seniorFrom: 10 },
  rabbit: { youngUnder: 0.5, seniorFrom: 6 },
};

export function lifeStage(speciesKey: string, dateOfBirth: Date | null, now = new Date()): LifeStage | null {
  if (!dateOfBirth) return null;
  const years = (now.getTime() - dateOfBirth.getTime()) / (365.25 * DAY);
  if (years < 0) return null;
  const s = STAGES[speciesKey] ?? { youngUnder: 1, seniorFrom: null };
  if (years < s.youngUnder) return 'young';
  if (s.seniorFrom !== null && years >= s.seniorFrom) return 'senior';
  return 'adult';
}

/** The life stage a product is made for, from words in its title ("Puppy starter kibble", "Senior 7+"). */
export function productLifeStage(title: string): LifeStage | null {
  const t = title.toLowerCase();
  if (/\b(pupp(y|ies)|kittens?|junior|starter|baby)\b/.test(t)) return 'young';
  if (/\b(senior|mature|ageing|aging)\b|\b(7|8|10|11)\s*\+/.test(t)) return 'senior';
  return null;
}

/** Bayesian average: a few 5-star ratings shouldn't beat many 4.7s. */
export function bayesRating(avg: number, count: number, prior = 4, weight = 5): number {
  return (avg * count + prior * weight) / (count + weight);
}

const affinityPoints = (a: Affinity | undefined) => (a ? Math.min(a.weight, 6) / 2 : 0);

/** Collects scored reasons; the strongest ones are shown. */
class Score {
  total = 0;
  private parts: Array<{ text: string; points: number }> = [];
  add(points: number, reason?: string) {
    this.total += points;
    if (reason && points > 0) this.parts.push({ text: reason, points });
    return this;
  }
  reasons(max = 2) {
    return this.parts.sort((a, b) => b.points - a.points).slice(0, max).map((p) => p.text);
  }
}

/**
 * Greedy re-ranking so one seller, partner or creator doesn't fill the list: each further item
 * from the same source loses `penalty` points.
 */
export function diversify<T>(list: Ranked<T>[], key: (t: T) => string, penalty: number): Ranked<T>[] {
  const left = [...list];
  const seen = new Map<string, number>();
  const out: Ranked<T>[] = [];
  while (left.length) {
    let best = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < left.length; i++) {
      const s = left[i].score - penalty * (seen.get(key(left[i].item)) ?? 0);
      if (s > bestScore) [best, bestScore] = [i, s];
    }
    const [pick] = left.splice(best, 1);
    const k = key(pick.item);
    seen.set(k, (seen.get(k) ?? 0) + 1);
    out.push(pick);
  }
  return out;
}

const byScore = <T extends { id: string }>(a: Ranked<T>, b: Ranked<T>) => b.score - a.score || a.item.id.localeCompare(b.item.id);

// ═════════════════════════ products ═════════════════════════

export interface ProductCandidate {
  id: string;
  vendorId: string;
  categoryId: string;
  categoryName: string;
  title: string;
  brand: string | null;
  speciesIds: string[];
  /** Units sold in the last 30 days. */
  sales30d: number;
  vendorRating: number;
  vendorRatingCount: number;
  inStock: boolean;
}

export interface ProductSignals {
  pets: PetInfo[];
  categories: Map<string, Affinity>;
  /** Lower-case brand → number of purchases. */
  brands: Map<string, number>;
  /** Product id → when it was last bought. */
  bought: Map<string, Date>;
  now?: Date;
}

export function rankProducts(cands: ProductCandidate[], s: ProductSignals): Ranked<ProductCandidate>[] {
  const now = (s.now ?? new Date()).getTime();
  const out: Ranked<ProductCandidate>[] = [];
  for (const c of cands) {
    if (!c.inStock) continue;
    const sc = new Score();
    const forPets = c.speciesIds.length ? s.pets.filter((p) => c.speciesIds.includes(p.speciesId)) : s.pets;
    if (s.pets.length && c.speciesIds.length && !forPets.length) continue; // made for animals they don't have
    const stage = productLifeStage(c.title);
    const fits = stage ? forPets.find((p) => p.stage === stage) : undefined;
    if (c.speciesIds.length && forPets.length) sc.add(3, `For ${(fits ?? forPets[0]).name}`);
    else if (!c.speciesIds.length) sc.add(0.5);
    if (fits) sc.add(1.5, `Suits ${fits.name}’s age`);
    else if (stage && forPets.length && forPets.every((p) => p.stage !== null)) sc.add(-3); // puppy food for an older dog

    const a = s.categories.get(c.categoryId);
    if (a) sc.add(affinityPoints(a), a.acted ? `You bought ${a.name.toLowerCase()} before` : `You looked at ${a.name.toLowerCase()}`);
    if (c.brand && s.brands.has(c.brand.toLowerCase())) sc.add(1, `You bought ${c.brand} before`);

    const last = s.bought.get(c.id);
    if (last && now - last.getTime() < 21 * DAY) sc.add(-2); // just bought it
    else if (last) sc.add(1.5, 'Buy again');

    sc.add(Math.log1p(c.sales30d) * 0.8, c.sales30d >= 5 ? 'Popular this month' : undefined);
    sc.add((bayesRating(c.vendorRating, c.vendorRatingCount) - 4) * 0.8);
    out.push({ item: c, score: round(sc.total), reasons: sc.reasons() });
  }
  return diversify(out.sort(byScore), (c) => c.vendorId, 1.5);
}

// ═════════════════════════ services ═════════════════════════

export interface PartnerCandidate {
  id: string;
  distanceKm: number;
  ratingAvg: number;
  ratingCount: number;
  services: Array<{ categoryId: string; speciesIds: string[] }>;
}

export interface ServiceSignals {
  pets: PetInfo[];
  categories: Map<string, Affinity>;
  /** Partner id → the rating they gave after their last booking (null if not rated). */
  bookedPartners: Map<string, number | null>;
}

export function rankPartners(cands: PartnerCandidate[], s: ServiceSignals): Ranked<PartnerCandidate>[] {
  const out: Ranked<PartnerCandidate>[] = [];
  for (const c of cands) {
    const sc = new Score();
    const fits = c.services.filter((x) => !x.speciesIds.length || !s.pets.length || s.pets.some((p) => x.speciesIds.includes(p.speciesId)));
    if (!fits.length) continue; // nothing they offer is for these pets
    const specific = s.pets.find((p) => fits.some((x) => x.speciesIds.includes(p.speciesId)));
    if (specific) sc.add(0.5, `Good for ${specific.name}`);

    const near = 3 * Math.exp(-c.distanceKm / 5);
    sc.add(near, c.distanceKm <= 3 ? `${c.distanceKm < 1 ? 'Under 1' : c.distanceKm.toFixed(1)} km away` : undefined);
    const bayes = bayesRating(c.ratingAvg, c.ratingCount);
    sc.add((bayes - 4) * 2, c.ratingCount >= 3 && c.ratingAvg >= 4.3 ? `Rated ${c.ratingAvg.toFixed(1)} (${c.ratingCount})` : undefined);

    let best: Affinity | undefined;
    for (const x of fits) {
      const a = s.categories.get(x.categoryId);
      if (a && (!best || a.weight > best.weight)) best = a;
    }
    if (best) sc.add(affinityPoints(best), best.acted ? `You booked ${best.name.toLowerCase()} before` : `You looked at ${best.name.toLowerCase()}`);

    if (s.bookedPartners.has(c.id)) {
      const r = s.bookedPartners.get(c.id);
      if (r === null || r === undefined || r >= 4) sc.add(2.5, 'You booked here before');
      else if (r <= 2) sc.add(-4);
    }
    out.push({ item: c, score: round(sc.total), reasons: sc.reasons() });
  }
  return out.sort(byScore);
}

// ═════════════════════════ contests ═════════════════════════

export interface ContestCandidate {
  id: string;
  categoryId: string | null;
  eligibleSpeciesIds: string[];
  feePaise: number;
  registrationClosesAt: Date;
  entries: number;
  maxParticipants: number | null;
}

export interface ContestSignals {
  pets: PetInfo[];
  categories: Map<string, Affinity>;
  /** Contest id → pets already entered. */
  entered: Map<string, Set<string>>;
  now?: Date;
}

export function rankContests(cands: ContestCandidate[], s: ContestSignals): Ranked<ContestCandidate>[] {
  const now = (s.now ?? new Date()).getTime();
  const out: Ranked<ContestCandidate>[] = [];
  for (const c of cands) {
    if (c.maxParticipants !== null && c.entries >= c.maxParticipants) continue;
    const sc = new Score();
    if (s.pets.length) {
      const already = s.entered.get(c.id) ?? new Set<string>();
      const can = s.pets.filter((p) => !already.has(p.id) && (!c.eligibleSpeciesIds.length || c.eligibleSpeciesIds.includes(p.speciesId)));
      if (!can.length) continue; // no pet of theirs can (still) enter
      if (c.eligibleSpeciesIds.length) sc.add(2, `${can[0].name} can enter`);
    }
    const a = c.categoryId ? s.categories.get(c.categoryId) : undefined;
    if (a) sc.add(affinityPoints(a), a.acted ? `You entered ${a.name} contests before` : `You looked at ${a.name} contests`);
    const days = Math.floor((c.registrationClosesAt.getTime() - now) / DAY);
    if (days <= 3 && c.registrationClosesAt.getTime() > now) sc.add(1, days <= 0 ? 'Entries close today' : `Entries close in ${days} day${days === 1 ? '' : 's'}`);
    if (c.feePaise === 0) sc.add(0.5, 'Free to enter');
    sc.add(Math.log1p(c.entries) * 0.3);
    out.push({ item: c, score: round(sc.total), reasons: sc.reasons() });
  }
  return out.sort(byScore);
}

// ═════════════════════════ reels ═════════════════════════

export interface ReelCandidate {
  id: string;
  authorId: string;
  petIds: string[];
  speciesIds: string[];
  hashtags: string[];
  /** The trending score from the worker. */
  trending: number;
  publishedAt: Date;
}

export interface ReelSignals {
  viewerId: string | null;
  followedUsers: Set<string>;
  followedPets: Set<string>;
  /** Species of their own pets → species name. */
  petSpecies: Map<string, string>;
  /** Author id → posts of theirs the viewer liked or saved recently. */
  likedAuthors: Map<string, number>;
  /** Hashtag → times the viewer engaged with it recently. */
  hashtags: Map<string, number>;
  now?: Date;
}

export function rankReels(cands: ReelCandidate[], s: ReelSignals): Ranked<ReelCandidate>[] {
  const now = (s.now ?? new Date()).getTime();
  const sorted = cands.map((c) => c.trending).sort((a, b) => b - a);
  const trendingCut = sorted.length >= 5 ? sorted[Math.floor(sorted.length * 0.2)] : Infinity;
  const out: Ranked<ReelCandidate>[] = [];
  for (const c of cands) {
    if (c.authorId === s.viewerId) continue;
    const sc = new Score();
    sc.add(Math.log1p(Math.max(c.trending, 0) * 100), c.trending > 0 && c.trending >= trendingCut ? 'Trending' : undefined);
    if (s.followedUsers.has(c.authorId)) sc.add(4, 'From someone you follow');
    else if (c.petIds.some((p) => s.followedPets.has(p))) sc.add(4, 'From a pet you follow');
    const sp = c.speciesIds.find((x) => s.petSpecies.has(x));
    if (sp) sc.add(1.5, `Because you have a ${s.petSpecies.get(sp)!.toLowerCase()}`);
    let tag: string | undefined;
    for (const h of c.hashtags) if (s.hashtags.has(h) && (!tag || s.hashtags.get(h)! > s.hashtags.get(tag)!)) tag = h;
    if (tag) sc.add(Math.min(s.hashtags.get(tag)!, 3) * 0.5, `You like #${tag}`);
    const liked = s.likedAuthors.get(c.authorId);
    if (liked && !s.followedUsers.has(c.authorId)) sc.add(Math.min(liked, 3) * 0.5, 'You liked their posts');
    if (now - c.publishedAt.getTime() < DAY) sc.add(0.5);
    out.push({ item: c, score: round(sc.total), reasons: sc.reasons(1) });
  }
  return diversify(out.sort(byScore), (c) => c.authorId, 2);
}

// ═════════════════════════ home sections ═════════════════════════

export interface SectionRules {
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  cities: string[];
  speciesIds: string[];
}

/** Whether a section is shown to this person right now (before checking it has items). */
export function sectionShown(sec: SectionRules, who: { city: string | null; speciesIds: string[] }, now = new Date()): boolean {
  if (!sec.isActive) return false;
  if (sec.startsAt && now < sec.startsAt) return false;
  if (sec.endsAt && now >= sec.endsAt) return false;
  if (sec.cities.length && !(who.city && sec.cities.includes(who.city.trim().toLowerCase()))) return false;
  if (sec.speciesIds.length && !who.speciesIds.some((x) => sec.speciesIds.includes(x))) return false;
  return true;
}

/** Pinned items first (in the admin's order), then the ranked ones, without duplicates. */
export function withPins<T extends { id: string }>(pinned: T[], ranked: T[], limit: number): Array<T & { pinned: boolean }> {
  const seen = new Set<string>();
  const out: Array<T & { pinned: boolean }> = [];
  for (const [list, pinnedFlag] of [[pinned, true], [ranked, false]] as const) {
    for (const x of list) {
      if (out.length >= limit) return out;
      if (seen.has(x.id)) continue;
      seen.add(x.id);
      out.push({ ...x, pinned: pinnedFlag });
    }
  }
  return out;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
