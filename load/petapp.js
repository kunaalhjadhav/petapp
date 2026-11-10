// PetApp load test (k6, https://k6.io). Two kinds of traffic at once:
//   browse  — people (and crawlers) opening shared links and browsing without signing in
//   member  — signed-in people using the app: home, feed, notifications, a contest, the shop
//
//   k6 run load/petapp.js                                   # against http://localhost:4000
//   k6 run -e BASE_URL=https://api.staging.petapp.in -e RATE=50 -e DURATION=10m load/petapp.js
//
// Run it against staging, never production. The API must run with RATE_LIMIT_MULTIPLIER (e.g. 100): all traffic
// comes from one address, which the normal limits would block. The member scenario creates USERS accounts with
// emails like load-<run>-<n>@petapp.test (delete them afterwards if you like).
import http from 'k6/http';
import { check, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE = (__ENV.BASE_URL || 'http://localhost:4000') + '/api/v1';
const RATE = Number(__ENV.RATE || 20); // requests per second, per scenario
const DURATION = __ENV.DURATION || '1m';
const USERS = Number(__ENV.USERS || 20);
const LAT = Number(__ENV.LAT || 18.5204);
const LNG = Number(__ENV.LNG || 73.8567);

const failures = new Rate('petapp_failures');
const slow = new Trend('petapp_slowest_ms', true);

export const options = {
  scenarios: {
    browse: { executor: 'constant-arrival-rate', exec: 'browse', rate: RATE, timeUnit: '1s', duration: DURATION, preAllocatedVUs: 20, maxVUs: 200 },
    member: { executor: 'constant-arrival-rate', exec: 'member', rate: Math.max(1, Math.round(RATE / 2)), timeUnit: '1s', duration: DURATION, preAllocatedVUs: 20, maxVUs: 200 },
  },
  // The targets from the spec's performance section: fast API responses, under load.
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{scenario:browse}': ['p(95)<400', 'p(99)<1000'],
    'http_req_duration{scenario:member}': ['p(95)<500', 'p(99)<1200'],
    petapp_failures: ['rate<0.01'],
    // Per-endpoint timings, so the summary shows which one is slowest (each must stay under 1.5 s at p95).
    ...Object.fromEntries(
      ['/pets/:handle', '/posts/:id', '/products/:slug', '/products?q', '/service-partners/:slug', '/services/nearby', '/contests/:slug', '/contests', '/feed/trending',
        '/home', '/feed', '/notifications', '/users/me', '/cart', '/recommendations/products'].map((n) => [`http_req_duration{name:${n}}`, ['p(95)<1500']]),
    ),
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const json = (r) => {
  try {
    return r.json('data');
  } catch {
    return null;
  }
};
function get(path, params, name) {
  const r = http.get(BASE + path, { ...params, tags: { name: name || path } });
  const ok = check(r, { 'status is 2xx': (x) => x.status >= 200 && x.status < 300 });
  failures.add(!ok);
  if (!ok && __ENV.DEBUG) console.warn(`${r.status} ${name || path}: ${String(r.body).slice(0, 160)}`);
  slow.add(r.timings.duration);
  return r;
}

/** Real ids to browse, and signed-in accounts. Runs once before the test. */
export function setup() {
  const map = json(http.get(`${BASE}/public/sitemap`)) || {};
  const keys = (k) => (map[k] || []).map((e) => e.key).slice(0, 200);
  const trending = json(http.get(`${BASE}/feed/trending?limit=30`));
  const posts = ((trending && trending.items) || []).map((p) => p.id);
  const run = Date.now().toString(36);
  const tokens = [];
  for (let i = 0; i < USERS; i++) {
    const r = http.post(`${BASE}/auth/email/register`, JSON.stringify({ email: `load-${run}-${i}@petapp.test`, password: `Load-test-${run}-pass`, name: `Load ${i}` }), { headers: { 'Content-Type': 'application/json' } });
    const d = r.status < 300 ? r.json('data') : null;
    if (d) tokens.push(d.tokens.accessToken);
  }
  if (!tokens.length) throw new Error('Could not create signed-in test accounts: is RATE_LIMIT_MULTIPLIER set on the API?');
  return { pets: keys('pets'), products: keys('products'), services: keys('services'), contests: keys('contests'), challenges: keys('challenges'), posts, tokens };
}

export function browse(d) {
  const roll = Math.random();
  group('browse', () => {
    if (roll < 0.2 && d.pets.length) get(`/pets/${pick(d.pets)}`, {}, '/pets/:handle');
    else if (roll < 0.35 && d.posts.length) get(`/posts/${pick(d.posts)}`, {}, '/posts/:id');
    else if (roll < 0.5 && d.products.length) get(`/products/${pick(d.products)}`, {}, '/products/:slug');
    else if (roll < 0.6) get(`/products?q=${encodeURIComponent(pick(['dog food', 'treats', 'toy', 'shampoo', 'collar']))}&limit=20`, {}, '/products?q');
    else if (roll < 0.72 && d.services.length) get(`/service-partners/${pick(d.services)}`, {}, '/service-partners/:slug');
    else if (roll < 0.82) get(`/services/nearby?lat=${LAT}&lng=${LNG}&radiusKm=10`, {}, '/services/nearby');
    else if (roll < 0.92 && d.contests.length) get(`/contests/${pick(d.contests)}`, {}, '/contests/:slug');
    else if (roll < 0.97) get('/contests?when=live&limit=20', {}, '/contests');
    else get('/feed/trending?limit=20', {}, '/feed/trending');
  });
}

export function member(d) {
  const auth = { headers: { Authorization: `Bearer ${pick(d.tokens)}` } };
  const roll = Math.random();
  group('member', () => {
    if (roll < 0.25) get(`/home?lat=${LAT}&lng=${LNG}`, auth, '/home');
    else if (roll < 0.45) get('/feed?limit=20', auth, '/feed');
    else if (roll < 0.6) get('/notifications?limit=30', auth, '/notifications');
    else if (roll < 0.7) get('/users/me', auth, '/users/me');
    else if (roll < 0.8) get('/cart', auth, '/cart');
    else if (roll < 0.9 && d.contests.length) get(`/contests/${pick(d.contests)}`, auth, '/contests/:slug');
    else get('/recommendations/products?limit=10', auth, '/recommendations/products');
  });
}
