import { test } from 'node:test';
import assert from 'node:assert/strict';
import { age, clip, clock, hhmm, isoDuration, rupees } from './format';
import { appUrl, webPath } from './links';
import { contestLd, faqLd, ldJson, partnerLd, petLd, postLd, productLd, ratingLd } from './seo';
import { contestStage, challengeStage } from './status';
import { postTitle } from './titles';
import type { Challenge, Contest, Partner, Pet, Post, Product } from './types';

const SITE = 'https://petapp.in';

test('formatting', () => {
  assert.equal(rupees(49900), '₹499');
  assert.equal(rupees(1500000), '₹15,000');
  assert.equal(clock(540), '9:00 am');
  assert.equal(clock(1080), '6:00 pm');
  assert.equal(clock(720), '12:00 pm');
  assert.equal(hhmm(570), '09:30');
  assert.equal(age(56), '4 years 8 months');
  assert.equal(age(12), '1 year');
  assert.equal(age(0), 'Under a month');
  assert.equal(age(null), '');
  assert.equal(isoDuration(75_000), 'PT1M15S');
  assert.equal(isoDuration(3_000), 'PT3S');
  assert.equal(isoDuration(120_000), 'PT2M');
  assert.equal(clip('short'), 'short');
  const long = clip('word '.repeat(60), 50);
  assert.ok(long.length <= 50 && long.endsWith('…') && !long.includes('  '));
});

test('links: the same path on the web and in the app', () => {
  assert.equal(webPath('pet', 'bruno.lab'), '/pet/bruno.lab');
  assert.equal(webPath('product', 'a b'), '/product/a%20b');
  assert.equal(appUrl('petapp', 'reel', 'abc'), 'petapp://reel/abc');
});

const pet: Pet = {
  id: 'p1',
  name: 'Bruno',
  handle: 'bruno',
  avatarUrl: 'https://cdn/b.jpg',
  species: { key: 'dog', name: 'Dog' },
  breed: { name: 'Labrador' },
  isVerified: false,
  followerCount: 12,
  about: 'Good boy',
  restricted: false,
};

test('pet structured data has no owner details', () => {
  const ld = petLd(SITE, pet, `${SITE}/pet/bruno`);
  assert.equal(ld['@type'], 'ProfilePage');
  assert.equal((ld.mainEntity as Record<string, unknown>).name, 'Bruno');
  assert.doesNotMatch(JSON.stringify(ld), /owner/i);
});

test('product structured data: one offer, or a price range', () => {
  const base: Product = {
    id: 'x',
    slug: 'chew',
    title: 'Yak chew',
    description: 'Long-lasting.',
    brand: 'Wag',
    category: { name: 'Chews' },
    vendor: { businessName: 'Wag & Co', city: 'Pune', ratingAvg: 0, ratingCount: 0 },
    images: [],
    variants: [
      { id: 'v1', title: 'M', sku: 'YC-1', mrpPaise: 59900, pricePaise: 49900, inStock: true },
    ],
  };
  const one = productLd(base, `${SITE}/product/chew`);
  assert.deepEqual(one.offers, {
    '@type': 'Offer',
    url: `${SITE}/product/chew`,
    priceCurrency: 'INR',
    price: '499.00',
    availability: 'https://schema.org/InStock',
    seller: { '@type': 'Organization', name: 'Wag & Co' },
  });
  const range = productLd(
    {
      ...base,
      variants: [
        ...base.variants,
        { id: 'v2', title: 'L', sku: null, mrpPaise: 89900, pricePaise: 79900, inStock: false },
      ],
    },
    'u',
  );
  const o = range.offers as Record<string, unknown>;
  assert.equal(o['@type'], 'AggregateOffer');
  assert.equal(o.lowPrice, '499.00');
  assert.equal(o.highPrice, '799.00');
});

test('ratings and reviews appear in structured data only once there are reviews', () => {
  assert.deepEqual(ratingLd(0, 0, []), {});
  const review = { id: 'r', rating: 4, comment: 'Loved it', photos: [], reply: null, by: 'Riya S.', at: '2026-10-01T10:00:00.000Z', verified: true };
  const ld = ratingLd(4.25, 3, [review, review, review, review]);
  assert.deepEqual(ld.aggregateRating, { '@type': 'AggregateRating', ratingValue: '4.3', reviewCount: 3, bestRating: 5, worstRating: 1 });
  const reviews = ld.review as Array<Record<string, unknown>>;
  assert.equal(reviews.length, 3);
  assert.deepEqual(reviews[0], {
    '@type': 'Review',
    reviewRating: { '@type': 'Rating', ratingValue: 4, bestRating: 5, worstRating: 1 },
    author: { '@type': 'Person', name: 'Riya S.' },
    datePublished: '2026-10-01',
    reviewBody: 'Loved it',
  });
});

test('a service partner: hours grouped by time, rating only once reviewed', () => {
  const p: Partner = {
    id: 's',
    slug: 'paws',
    businessName: 'Paws',
    about: null,
    area: 'Baner',
    city: 'Pune',
    addressLine: '1 Road',
    lat: 18.5,
    lng: 73.8,
    homeVisitRadiusKm: 0,
    ratingAvg: 0,
    ratingCount: 0,
    services: [
      {
        id: 'a',
        name: 'Bath',
        description: null,
        category: { name: 'Grooming' },
        durationMin: 30,
        pricePaise: 50000,
        modes: ['AT_CENTER'],
      },
    ],
    hours: [
      { weekday: 1, opensMin: 540, closesMin: 1080 },
      { weekday: 2, opensMin: 540, closesMin: 1080 },
      { weekday: 6, opensMin: 600, closesMin: 840 },
    ],
    reviews: [],
  };
  const ld = partnerLd(p, 'u');
  assert.equal(ld.aggregateRating, undefined);
  assert.deepEqual(ld.openingHoursSpecification, [
    {
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['https://schema.org/Monday', 'https://schema.org/Tuesday'],
      opens: '09:00',
      closes: '18:00',
    },
    {
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['https://schema.org/Saturday'],
      opens: '10:00',
      closes: '14:00',
    },
  ]);
  const rated = partnerLd({ ...p, ratingAvg: 4.25, ratingCount: 8 }, 'u');
  assert.deepEqual(rated.aggregateRating, {
    '@type': 'AggregateRating',
    ratingValue: '4.3',
    reviewCount: 8,
    bestRating: 5,
    worstRating: 1,
  });
});

const contest: Contest = {
  id: 'c',
  slug: 'glam',
  title: 'Glam',
  bannerUrl: null,
  category: null,
  status: 'SCHEDULED',
  feePaise: 9900,
  entries: 0,
  maxParticipants: null,
  registrationOpensAt: '2026-10-10T00:00:00Z',
  registrationClosesAt: '2026-10-20T00:00:00Z',
  submissionClosesAt: null,
  votingClosesAt: '2026-10-25T00:00:00Z',
  prizes: [],
  description: null,
  rules: null,
  publicWeight: 100,
  votesPerUserPerDay: 1,
  cancelReason: null,
  tasks: [],
};

test('contests: stage in words, and an online event', () => {
  assert.equal(contestStage(contest, Date.parse('2026-10-05T00:00:00Z')), 'Entries open soon');
  assert.equal(contestStage(contest, Date.parse('2026-10-15T00:00:00Z')), 'Entries are open');
  assert.equal(contestStage(contest, Date.parse('2026-10-21T00:00:00Z')), 'Entries closed');
  assert.equal(contestStage({ ...contest, status: 'VOTING' }), 'Voting is open');
  const ld = contestLd(SITE, { ...contest, status: 'CANCELLED' }, 'u');
  assert.equal(ld.eventStatus, 'https://schema.org/EventCancelled');
  assert.equal(ld.endDate, '2026-10-25T00:00:00Z');
  assert.equal((ld.offers as Record<string, unknown>).price, '99.00');
  const ch = {
    startsAt: '2026-10-10T00:00:00Z',
    endsAt: '2026-10-17T00:00:00Z',
    status: 'PUBLISHED',
  } as Challenge;
  assert.equal(challengeStage(ch, Date.parse('2026-10-12T00:00:00Z')), 'Running now');
  assert.equal(challengeStage(ch, Date.parse('2026-10-18T00:00:00Z')), 'Finished');
});

test('posts: titled by their pets, never by people; reels are videos', () => {
  const post: Post = {
    id: 'r',
    type: 'REEL',
    caption: 'Zoomies',
    locationName: null,
    pets: [{ id: '1', name: 'Kiwi', handle: 'kiwi', avatarUrl: null }],
    hashtags: [],
    counts: { likes: 1, comments: 0, views: 9 },
    publishedAt: '2026-10-01T00:00:00Z',
    media: [
      {
        id: 'm',
        kind: 'VIDEO',
        status: 'READY',
        width: 720,
        height: 1280,
        durationMs: 15000,
        poster: 'https://cdn/p.jpg',
      },
    ],
  };
  assert.equal(postTitle(post), 'Kiwi’s reel');
  assert.equal(
    postTitle({
      ...post,
      type: 'PHOTO',
      pets: [
        ...post.pets,
        { id: '2', name: 'Momo', handle: 'momo', avatarUrl: null },
        { id: '3', name: 'Coco', handle: 'coco', avatarUrl: null },
      ],
    }),
    'A photo of Kiwi, Momo and Coco',
  );
  assert.equal(postTitle({ ...post, pets: [] }), 'A PetApp reel');
  const ld = postLd(SITE, post, 'u', 'Kiwi’s reel');
  assert.equal(ld['@type'], 'VideoObject');
  assert.equal(ld.duration, 'PT15S');
});

test('JSON-LD can’t break out of its script tag, and empty fields are dropped', () => {
  const s = ldJson({ name: '</script><script>alert(1)</script>', empty: undefined, list: [] });
  assert.doesNotMatch(s, /<\/script>/);
  assert.doesNotMatch(s, /empty|list/);
});

test('help center questions become FAQ structured data in plain text', () => {
  const ld = faqLd([{ question: 'How do I return an order?', answer: 'Open **My orders** and tap **Return**.\n\n- It must be within the return window' }]);
  assert.equal(ld['@type'], 'FAQPage');
  const q = (ld.mainEntity as Array<{ name: string; acceptedAnswer: { text: string } }>)[0];
  assert.equal(q.name, 'How do I return an order?');
  assert.equal(q.acceptedAnswer.text, 'Open My orders and tap Return. It must be within the return window');
});
