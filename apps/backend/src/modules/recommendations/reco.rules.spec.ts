import {
  bayesRating, diversify, lifeStage, productLifeStage, rankContests, rankPartners, rankProducts, rankReels, sectionShown, withPins,
  type ContestCandidate, type PartnerCandidate, type PetInfo, type ProductCandidate, type ReelCandidate,
} from './reco.rules';

const NOW = new Date('2026-10-14T06:00:00Z');
const DOG = 'sp-dog';
const CAT = 'sp-cat';
const bruno: PetInfo = { id: 'pet-bruno', name: 'Bruno', speciesId: DOG, speciesName: 'Dog', stage: 'adult' };
const coco: PetInfo = { id: 'pet-coco', name: 'Coco', speciesId: DOG, speciesName: 'Dog', stage: 'young' };
const mia: PetInfo = { id: 'pet-mia', name: 'Mia', speciesId: CAT, speciesName: 'Cat', stage: 'senior' };
const yearsAgo = (y: number) => new Date(NOW.getTime() - y * 365.25 * 86_400_000);

describe('recommendation rules', () => {
  describe('life stage', () => {
    it('from species and date of birth', () => {
      expect(lifeStage('dog', yearsAgo(0.5), NOW)).toBe('young');
      expect(lifeStage('dog', yearsAgo(3), NOW)).toBe('adult');
      expect(lifeStage('dog', yearsAgo(8), NOW)).toBe('senior');
      expect(lifeStage('cat', yearsAgo(8), NOW)).toBe('adult');
      expect(lifeStage('cat', yearsAgo(11), NOW)).toBe('senior');
      expect(lifeStage('parrot', yearsAgo(30), NOW)).toBe('adult'); // no senior age known
      expect(lifeStage('dog', null, NOW)).toBeNull();
      expect(lifeStage('dog', new Date(NOW.getTime() + 86_400_000), NOW)).toBeNull();
    });
    it('of a product, from its title', () => {
      expect(productLifeStage('Puppy Starter Kibble 3 kg')).toBe('young');
      expect(productLifeStage('Kitten wet food')).toBe('young');
      expect(productLifeStage('Senior joint care')).toBe('senior');
      expect(productLifeStage('Adult dog food 7+ formula')).toBe('senior');
      expect(productLifeStage('Rope toy')).toBeNull();
      expect(productLifeStage('Puppyish rope')).toBeNull(); // whole words only
    });
  });

  it('bayesian rating pulls small counts towards the prior', () => {
    expect(bayesRating(5, 1)).toBeCloseTo(4.167, 2);
    expect(bayesRating(4.7, 200)).toBeGreaterThan(bayesRating(5, 2));
    expect(bayesRating(0, 0)).toBe(4);
  });

  it('diversify spreads out items from one source', () => {
    const list = [
      { item: { id: 'a1', v: 'A' }, score: 10, reasons: [] },
      { item: { id: 'a2', v: 'A' }, score: 9.5, reasons: [] },
      { item: { id: 'a3', v: 'A' }, score: 9.4, reasons: [] },
      { item: { id: 'b1', v: 'B' }, score: 8.8, reasons: [] },
    ];
    expect(diversify(list, (x) => x.v, 1.5).map((r) => r.item.id)).toEqual(['a1', 'b1', 'a2', 'a3']);
    expect(diversify(list, (x) => x.v, 0).map((r) => r.item.id)).toEqual(['a1', 'a2', 'a3', 'b1']);
  });

  describe('products', () => {
    const p = (o: Partial<ProductCandidate> & { id: string }): ProductCandidate => ({
      vendorId: `v-${o.id}`, categoryId: 'cat-toys', categoryName: 'Toys', title: 'Rope toy', brand: null, speciesIds: [],
      sales30d: 0, vendorRating: 0, vendorRatingCount: 0, inStock: true, ...o,
    });
    const none = { pets: [], categories: new Map(), brands: new Map(), bought: new Map(), now: NOW };

    it('without signals: popular in-stock products first', () => {
      const r = rankProducts([p({ id: 'quiet' }), p({ id: 'hit', sales30d: 40 }), p({ id: 'gone', sales30d: 99, inStock: false })], none);
      expect(r.map((x) => x.item.id)).toEqual(['hit', 'quiet']);
      expect(r[0].reasons).toEqual(['Popular this month']);
    });

    it('for their pets: matching species first, other species left out, age respected', () => {
      const r = rankProducts(
        [
          p({ id: 'cat-food', speciesIds: [CAT], sales30d: 50 }),
          p({ id: 'dog-food', speciesIds: [DOG], title: 'Adult dog food' }),
          p({ id: 'puppy-food', speciesIds: [DOG], title: 'Puppy kibble' }),
          p({ id: 'any', sales30d: 3 }),
        ],
        { ...none, pets: [bruno] },
      );
      expect(r.map((x) => x.item.id)).toEqual(['dog-food', 'any', 'puppy-food']);
      expect(r[0].reasons[0]).toBe('For Bruno');

      const young = rankProducts([p({ id: 'puppy-food', speciesIds: [DOG], title: 'Puppy kibble' }), p({ id: 'dog-food', speciesIds: [DOG] })], { ...none, pets: [bruno, coco] });
      expect(young[0].item.id).toBe('puppy-food');
      expect(young[0].reasons).toEqual(['For Coco', 'Suits Coco’s age']);
    });

    it('past purchases: category, brand and "buy again", but not something just bought', () => {
      const s = {
        ...none,
        categories: new Map([['cat-food', { weight: 6, name: 'Dog food', acted: true }]]),
        brands: new Map([['pawsome', 2]]),
        bought: new Map([
          ['again', new Date(NOW.getTime() - 40 * 86_400_000)],
          ['just', new Date(NOW.getTime() - 3 * 86_400_000)],
        ]),
      };
      const r = rankProducts(
        [p({ id: 'toy' }), p({ id: 'food', categoryId: 'cat-food', brand: 'Pawsome' }), p({ id: 'again' }), p({ id: 'just' })],
        s,
      );
      expect(r.map((x) => x.item.id)).toEqual(['food', 'again', 'toy', 'just']);
      expect(r[0].reasons).toEqual(['You bought dog food before', 'You bought Pawsome before']);
      expect(r[1].reasons).toEqual(['Buy again']);
    });

    it('one seller does not fill the list', () => {
      const r = rankProducts([p({ id: 'a1', vendorId: 'A', sales30d: 30 }), p({ id: 'a2', vendorId: 'A', sales30d: 29 }), p({ id: 'b1', vendorId: 'B', sales30d: 25 })], none);
      expect(r.map((x) => x.item.id)).toEqual(['a1', 'b1', 'a2']);
    });
  });

  describe('services', () => {
    const c = (o: Partial<PartnerCandidate> & { id: string }): PartnerCandidate => ({
      distanceKm: 2, ratingAvg: 0, ratingCount: 0, services: [{ categoryId: 'groom', speciesIds: [] }], ...o,
    });
    const none = { pets: [], categories: new Map(), bookedPartners: new Map() };

    it('nearer and better rated first, with reasons', () => {
      const r = rankPartners([c({ id: 'far', distanceKm: 12 }), c({ id: 'near', distanceKm: 0.4 }), c({ id: 'loved', distanceKm: 4, ratingAvg: 4.9, ratingCount: 60 })], none);
      expect(r.map((x) => x.item.id)).toEqual(['loved', 'near', 'far']);
      expect(r[0].reasons).toEqual(['Rated 4.9 (60)']);
      expect(r[1].reasons).toEqual(['Under 1 km away']);
    });

    it('skips partners who serve none of their pets; history counts', () => {
      const s = {
        pets: [mia],
        categories: new Map([['groom', { weight: 3, name: 'Grooming', acted: true }]]),
        bookedPartners: new Map<string, number | null>([['again', 5], ['bad', 1]]),
      };
      const r = rankPartners(
        [
          c({ id: 'dogs-only', services: [{ categoryId: 'groom', speciesIds: [DOG] }] }),
          c({ id: 'again' }),
          c({ id: 'bad' }),
          c({ id: 'cats', services: [{ categoryId: 'walk', speciesIds: [CAT] }] }),
        ],
        s,
      );
      expect(r.map((x) => x.item.id)).toEqual(['again', 'cats', 'bad']);
      expect(r[0].reasons).toEqual(['You booked here before', '2.0 km away']);
      expect(r[1].reasons).toEqual(['2.0 km away', 'Good for Mia']);
    });
  });

  describe('contests', () => {
    const k = (o: Partial<ContestCandidate> & { id: string }): ContestCandidate => ({
      categoryId: null, eligibleSpeciesIds: [], feePaise: 9900, registrationClosesAt: new Date(NOW.getTime() + 10 * 86_400_000), entries: 0, maxParticipants: null, ...o,
    });
    const none = { pets: [], categories: new Map(), entered: new Map(), now: NOW };

    it('leaves out full contests, ones their pets cannot enter, and ones every pet already entered', () => {
      const s = { ...none, pets: [bruno], entered: new Map([['done', new Set(['pet-bruno'])]]) };
      const r = rankContests([k({ id: 'full', maxParticipants: 5, entries: 5 }), k({ id: 'cats', eligibleSpeciesIds: [CAT] }), k({ id: 'done' }), k({ id: 'dogs', eligibleSpeciesIds: [DOG] })], s);
      expect(r.map((x) => x.item.id)).toEqual(['dogs']);
      expect(r[0].reasons).toEqual(['Bruno can enter']);
    });

    it('closing soon, free and familiar categories rise', () => {
      const s = { ...none, categories: new Map([['cute', { weight: 3, name: 'Cutest pet', acted: true }]]) };
      const r = rankContests(
        [k({ id: 'later' }), k({ id: 'soon', registrationClosesAt: new Date(NOW.getTime() + 1.5 * 86_400_000) }), k({ id: 'free', feePaise: 0 }), k({ id: 'fav', categoryId: 'cute' })],
        s,
      );
      expect(r.map((x) => x.item.id)).toEqual(['fav', 'soon', 'free', 'later']);
      expect(r[0].reasons).toEqual(['You entered Cutest pet contests before']);
      expect(r[1].reasons).toEqual(['Entries close in 1 day']);
      expect(r[2].reasons).toEqual(['Free to enter']);
    });
  });

  describe('reels', () => {
    const reel = (o: Partial<ReelCandidate> & { id: string }): ReelCandidate => ({
      authorId: `u-${o.id}`, petIds: [], speciesIds: [], hashtags: [], trending: 0.01, publishedAt: new Date(NOW.getTime() - 3 * 86_400_000), ...o,
    });
    const none = { viewerId: 'me', followedUsers: new Set<string>(), followedPets: new Set<string>(), petSpecies: new Map(), likedAuthors: new Map(), hashtags: new Map(), now: NOW };

    it('trending first without signals; never their own', () => {
      const r = rankReels([reel({ id: 'mine', authorId: 'me', trending: 9 }), reel({ id: 'calm' }), reel({ id: 'hot', trending: 2 })], none);
      expect(r.map((x) => x.item.id)).toEqual(['hot', 'calm']);
    });

    it('follows, species, hashtags and liked authors lift a reel, with one reason', () => {
      const s = {
        ...none,
        followedUsers: new Set(['u-friend']),
        followedPets: new Set(['pet-star']),
        petSpecies: new Map([[DOG, 'Dog']]),
        hashtags: new Map([['zoomies', 3]]),
        likedAuthors: new Map([['u-fan', 2]]),
      };
      const hot = reel({ id: 'hot', trending: 0.5 });
      const r = rankReels([hot, reel({ id: 'friend' }), reel({ id: 'star', petIds: ['pet-star'] }), reel({ id: 'dog', speciesIds: [DOG] }), reel({ id: 'tag', hashtags: ['zoomies'] }), reel({ id: 'fan' })], s);
      const reason = Object.fromEntries(r.map((x) => [x.item.id, x.reasons[0]]));
      expect(reason).toMatchObject({ friend: 'From someone you follow', star: 'From a pet you follow', dog: 'Because you have a dog', tag: 'You like #zoomies', fan: 'You liked their posts' });
      expect(r.map((x) => x.item.id).slice(0, 2).sort()).toEqual(['friend', 'star']);
    });

    it('one creator does not fill the list', () => {
      const r = rankReels([reel({ id: 'a1', authorId: 'A', trending: 1 }), reel({ id: 'a2', authorId: 'A', trending: 0.9 }), reel({ id: 'b1', authorId: 'B', trending: 0.3 })], none);
      expect(r.map((x) => x.item.id)).toEqual(['a1', 'b1', 'a2']);
    });
  });

  describe('home sections', () => {
    const sec = { isActive: true, startsAt: null, endsAt: null, cities: [], speciesIds: [] };
    const who = { city: 'Pune', speciesIds: [DOG] };
    it('active, scheduled, city and species rules', () => {
      expect(sectionShown(sec, who, NOW)).toBe(true);
      expect(sectionShown({ ...sec, isActive: false }, who, NOW)).toBe(false);
      expect(sectionShown({ ...sec, startsAt: new Date(NOW.getTime() + 1000) }, who, NOW)).toBe(false);
      expect(sectionShown({ ...sec, endsAt: NOW }, who, NOW)).toBe(false);
      expect(sectionShown({ ...sec, cities: ['pune', 'mumbai'] }, who, NOW)).toBe(true);
      expect(sectionShown({ ...sec, cities: ['mumbai'] }, who, NOW)).toBe(false);
      expect(sectionShown({ ...sec, cities: ['pune'] }, { city: null, speciesIds: [] }, NOW)).toBe(false);
      expect(sectionShown({ ...sec, speciesIds: [CAT] }, who, NOW)).toBe(false);
      expect(sectionShown({ ...sec, speciesIds: [CAT, DOG] }, who, NOW)).toBe(true);
    });
    it('pinned items first, no duplicates, up to the limit', () => {
      const r = withPins([{ id: 'p2' }, { id: 'p1' }], [{ id: 'p1' }, { id: 'x' }, { id: 'y' }], 3);
      expect(r).toEqual([{ id: 'p2', pinned: true }, { id: 'p1', pinned: true }, { id: 'x', pinned: false }]);
    });
  });
});
