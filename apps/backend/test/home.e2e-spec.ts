import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { SMS_PROVIDER, type SmsMessage } from '../src/providers/sms/sms.provider';
import { syncRbac } from '../src/modules/rbac/rbac.seed';
import { InterestService } from '../src/modules/recommendations/interest.service';

const API = '/api/v1';
jest.setTimeout(120_000);

type User = { token: string; id: string };
const DAY = 86_400_000;
const PUNE = { lat: 18.5204, lng: 73.8567 };

describe('Home screen and recommendations (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  const inbox = new Map<string, string>();
  let admin: string;
  let moderator: string;
  let alice: User; // dog owner: Bruno (3 years) and Coco (a puppy)
  let bob: User; // creator
  let carol: User; // cat owner: Mia
  let dave: User; // no pets
  let dog: string;
  let cat: string;
  let bruno: string;
  const ids: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const unthrottle = async () => {
    const k = await redis.client.keys('throttle:*');
    if (k.length) await redis.client.del(...k);
  };
  async function login(phone: string, name: string): Promise<User> {
    await unthrottle();
    await http().post(`${API}/auth/otp/request`).send({ phone }).expect(200);
    const r = await http().post(`${API}/auth/otp/verify`).send({ phone, code: inbox.get(phone) }).expect(200);
    const u = { token: r.body.data.tokens.accessToken, id: r.body.data.user.id };
    await http().patch(`${API}/users/me`).set(bearer(u.token)).send({ name }).expect(200);
    return u;
  }
  async function staff(email: string, role: string) {
    const r = await prisma.role.findUniqueOrThrow({ where: { key: role } });
    await prisma.user.create({ data: { email, passwordHash: await bcrypt.hash('Staff-Password-1', 10), roles: { create: [{ roleId: r.id }] } } });
    return (await http().post(`${API}/admin/auth/login`).send({ email, password: 'Staff-Password-1' }).expect(200)).body.data.tokens.accessToken as string;
  }
  const get = (path: string, u?: User) => (u ? http().get(`${API}${path}`).set(bearer(u.token)) : http().get(`${API}${path}`)).expect(200).then((r) => r.body.data);
  const titles = (list: Array<{ title?: string; businessName?: string }>) => list.map((x) => x.title ?? x.businessName);
  const flag = async (key: string, enabled: boolean) => {
    await prisma.featureFlag.update({ where: { key }, data: { enabled } });
    await redis.client.del('platform:flags');
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_PROVIDER)
      .useValue({ name: 'capture', send: async (m: SmsMessage) => (inbox.set(m.to, m.body.match(/\d{6}/)![0]), {}) })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    await redis.client.flushdb();
    const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'spatial_ref_sys')`;
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
    await syncRbac(prisma);
    await prisma.featureFlag.createMany({
      data: ['ENABLE_REELS', 'ENABLE_CONTESTS', 'ENABLE_SERVICES', 'ENABLE_MARKETPLACE'].map((key) => ({ key, enabled: true })),
    });
    admin = await staff('root@home.test', 'SUPER_ADMIN');
    moderator = await staff('mod@home.test', 'MODERATOR');
    [alice, bob, carol, dave] = await Promise.all([
      login('+919730000001', 'Alice Rao'),
      login('+919730000002', 'Bob Nair'),
      login('+919730000003', 'Carol Das'),
      login('+919730000004', 'Dave Iyer'),
    ]);
    dog = (await prisma.petSpecies.create({ data: { key: 'dog', name: 'Dog' } })).id;
    cat = (await prisma.petSpecies.create({ data: { key: 'cat', name: 'Cat' } })).id;
    const pet = (ownerId: string, name: string, speciesId: string, years: number) =>
      prisma.pet.create({ data: { ownerId, name, handle: name.toLowerCase(), speciesId, dateOfBirth: new Date(Date.now() - years * 365.25 * DAY), city: 'Pune' } });
    bruno = (await pet(alice.id, 'Bruno', dog, 3)).id;
    ids.coco = (await pet(alice.id, 'Coco', dog, 0.4)).id;
    ids.mia = (await pet(carol.id, 'Mia', cat, 12)).id;
    ids.rex = (await pet(bob.id, 'Rex', dog, 5)).id;

    // Shop: dog, cat and any-pet products, one out of stock.
    const seller = await prisma.user.create({ data: { phone: '+919730000099', name: 'Seller' } });
    const vendor = await prisma.vendor.create({ data: { userId: seller.id, businessName: 'Paws Mart', slug: 'paws-mart', phone: '+919800000000', addressLine: '1 Road', city: 'Pune', state: 'Maharashtra', pincode: '411001', status: 'APPROVED' } });
    const food = await prisma.productCategory.create({ data: { key: 'food', name: 'Food' } });
    const toys = await prisma.productCategory.create({ data: { key: 'toys', name: 'Toys' } });
    const product = async (slug: string, title: string, categoryId: string, speciesIds: string[], stock = 10, brand?: string) =>
      (ids[slug] = (await prisma.product.create({
        data: { vendorId: vendor.id, categoryId, title, slug, description: title, brand, speciesIds, status: 'ACTIVE', variants: { create: [{ sku: `${slug}-1`, title: '1 kg', mrpPaise: 50000, pricePaise: 45000, stock }] } },
      })).id);
    await product('dog-food', 'Adult dog food', food.id, [dog], 10, 'Pawsome');
    await product('puppy-kibble', 'Puppy kibble', food.id, [dog]);
    await product('senior-dog', 'Senior dog food', food.id, [dog]);
    await product('cat-food', 'Cat food', food.id, [cat]);
    await product('rope-toy', 'Rope toy', toys.id, []);
    await product('gone-toy', 'Squeaky ball', toys.id, [], 0);
    ids.coupon = (await prisma.coupon.create({ data: { code: 'PAWS10', description: '10% off at Paws Mart', kind: 'PERCENT', value: 1000, vendorId: vendor.id, startsAt: new Date(Date.now() - DAY), endsAt: new Date(Date.now() + 30 * DAY) } })).id;
    await prisma.coupon.create({ data: { code: 'OLD5', kind: 'FLAT', value: 500, startsAt: new Date(Date.now() - 30 * DAY), endsAt: new Date(Date.now() - DAY) } });

    // Services in Pune: one for dogs (2 km), one for cats (1 km), and one in Mumbai.
    const groom = await prisma.serviceCategory.create({ data: { key: 'grooming', name: 'Grooming' } });
    const partner = async (slug: string, name: string, lat: number, lng: number, speciesIds: string[], rating: [number, number]) => {
      const owner = await prisma.user.create({ data: { phone: `+91974${String(Object.keys(ids).length).padStart(7, '0')}`, name } });
      const p = await prisma.servicePartner.create({
        data: { userId: owner.id, slug, businessName: name, phone: '+919800000001', addressLine: '1 Lane', city: lat > 19 ? 'Mumbai' : 'Pune', state: 'Maharashtra', pincode: '411001', lat, lng, status: 'APPROVED', ratingAvg: rating[0], ratingCount: rating[1],
          services: { create: [{ categoryId: groom.id, name: 'Full groom', durationMin: 60, pricePaise: 120000, modes: ['AT_CENTER'], speciesIds }] } },
      });
      await prisma.$executeRaw`UPDATE "ServicePartner" SET "location" = ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography WHERE "id" = ${p.id}::uuid`;
      return (ids[slug] = p.id);
    };
    await partner('wag-spa', 'Wag Spa', PUNE.lat + 0.018, PUNE.lng, [dog], [4.8, 40]);
    await partner('cat-corner', 'Cat Corner', PUNE.lat + 0.009, PUNE.lng, [cat], [4.5, 10]);
    await partner('mumbai-paws', 'Mumbai Paws', 19.076, 72.8777, [], [5, 99]);

    // Contests: open for dogs, open for cats, full, and opening next week.
    const contest = async (slug: string, o: Record<string, unknown> = {}) =>
      (ids[slug] = (await prisma.contest.create({
        data: { slug, title: slug.replace(/-/g, ' '), description: 'x', status: 'LIVE', createdById: alice.id,
          registrationOpensAt: new Date(Date.now() - DAY), registrationClosesAt: new Date(Date.now() + 10 * DAY), submissionClosesAt: new Date(Date.now() + 12 * DAY), votingClosesAt: new Date(Date.now() + 14 * DAY), ...o },
      })).id);
    await contest('dog-of-the-month', { eligibleSpeciesIds: [dog], feePaise: 0 });
    await contest('cat-show', { eligibleSpeciesIds: [cat] });
    await contest('full-house', { maxParticipants: 1 });
    await prisma.contestParticipant.create({ data: { contestId: ids['full-house'], userId: bob.id, petId: ids.rex, status: 'REGISTERED' } });
    await contest('winter-wonder', { status: 'SCHEDULED', registrationOpensAt: new Date(Date.now() + 5 * DAY), registrationClosesAt: new Date(Date.now() + 15 * DAY) });
    ids.walk = (await prisma.challenge.create({ data: { slug: 'walk-30', title: '30-day walk', description: 'Walk daily', status: 'PUBLISHED', startsAt: new Date(Date.now() - DAY), endsAt: new Date(Date.now() + 29 * DAY), requiredCheckIns: 20, createdById: alice.id } })).id;

    // Reels: Bob's (Alice follows him), a popular stranger's dog reel, and a cat reel.
    const reel = async (key: string, authorId: string, score: number, petId?: string, tags: string[] = []) =>
      (ids[key] = (await prisma.post.create({
        data: { authorId, type: 'REEL', caption: key, status: 'PUBLISHED', publishedAt: new Date(Date.now() - 3600_000), score,
          pets: petId ? { create: [{ petId }] } : undefined,
          hashtags: tags.length ? { create: await Promise.all(tags.map(async (t) => ({ hashtag: { connectOrCreate: { where: { tag: t }, create: { tag: t } } } }))) } : undefined },
      })).id);
    await reel('bob-reel', bob.id, 0.02, ids.rex);
    await reel('hot-cat', carol.id, 0.6, ids.mia);
    await reel('dave-reel', dave.id, 0.05);
    for (let i = 0; i < 12; i++) await reel(`filler-${i}`, dave.id, 0.01);
    await http().post(`${API}/users/${bob.id}/follow`).set(bearer(alice.token)).expect((r) => expect([200, 201, 204]).toContain(r.status));
  });

  afterAll(async () => {
    await app.close();
  });

  describe('recommendations', () => {
    it('products: for the pets they have, at the right age, in stock; signed out gets popular items', async () => {
      const mine = await get('/recommendations/products?limit=10', alice);
      expect(titles(mine)).not.toContain('Cat food');
      expect(titles(mine)).not.toContain('Squeaky ball');
      expect(titles(mine).at(-1)).toBe('Senior dog food'); // both dogs are younger, so it comes last
      expect(mine[0]).toMatchObject({ title: 'Puppy kibble', reason: 'For Coco' });
      expect(mine.find((p: { title: string }) => p.title === 'Adult dog food')).toMatchObject({ reason: 'For Bruno', fromPaise: 45000, vendor: { businessName: 'Paws Mart' } });

      const anyone = await get('/recommendations/products?limit=10');
      expect(titles(anyone)).toEqual(expect.arrayContaining(['Cat food', 'Rope toy', 'Senior dog food']));
      expect(anyone.every((p: { reason: string | null }) => !p.reason?.startsWith('For '))).toBe(true);
    });

    it('viewing a product is remembered once a day and shapes later picks; "Not interested" removes it', async () => {
      await get('/products/rope-toy', dave);
      await get('/products/rope-toy', dave);
      await new Promise((r) => setTimeout(r, 300));
      expect(await prisma.interestEvent.count({ where: { userId: dave.id, kind: 'PRODUCT_VIEW' } })).toBe(1);
      const picks = await get('/recommendations/products', dave);
      expect(picks[0]).toMatchObject({ title: 'Rope toy', reason: 'You looked at toys' });

      await http().post(`${API}/recommendations/dismiss`).set(bearer(dave.token)).send({ targetType: 'PRODUCT', targetId: ids['rope-toy'] }).expect(204);
      expect(titles(await get('/recommendations/products', dave))).not.toContain('Rope toy');
      await http().post(`${API}/recommendations/dismiss`).set(bearer(dave.token)).send({ targetType: 'SHOE', targetId: ids['rope-toy'] }).expect(400);
      await http().post(`${API}/recommendations/dismiss`).send({ targetType: 'PRODUCT', targetId: ids['rope-toy'] }).expect(401);
    });

    it('personalisation can be turned off (history is deleted and nothing new is recorded) and history cleared', async () => {
      let s = await get('/me/recommendations', dave);
      expect(s).toMatchObject({ personalised: true, availableOnPlatform: true, historyDays: 90, viewsKept: 1, hiddenItems: 1 });
      expect(s.basedOn.length).toBeGreaterThan(0);

      s = (await http().put(`${API}/me/recommendations`).set(bearer(alice.token)).send({ personalised: false }).expect(200)).body.data;
      expect(s).toMatchObject({ personalised: false, basedOn: [] });
      const plain = await get('/recommendations/products?limit=10', alice);
      expect(titles(plain)).toContain('Cat food'); // no longer filtered by her pets
      await get('/products/dog-food', alice);
      await new Promise((r) => setTimeout(r, 300));
      expect(await prisma.interestEvent.count({ where: { userId: alice.id } })).toBe(0);
      await http().put(`${API}/me/recommendations`).set(bearer(alice.token)).send({ personalised: true }).expect(200);

      s = (await http().delete(`${API}/me/recommendations/history`).set(bearer(dave.token)).expect(200)).body.data;
      expect(s).toMatchObject({ viewsKept: 0, hiddenItems: 0 });
      expect(titles(await get('/recommendations/products', dave))).toContain('Rope toy');
    });

    it('a platform switch turns personalisation off for everyone', async () => {
      await http().put(`${API}/admin/settings/reco.personalisationEnabled`).set(bearer(admin)).send({ value: false }).expect(200);
      expect(titles(await get('/recommendations/products?limit=10', alice))).toContain('Cat food');
      expect(await get('/me/recommendations', alice)).toMatchObject({ personalised: true, availableOnPlatform: false, basedOn: [] });
      await http().put(`${API}/admin/settings/reco.personalisationEnabled`).set(bearer(admin)).send({ value: true }).expect(200);
      await http().put(`${API}/admin/settings/reco.historyDays`).set(bearer(admin)).send({ value: 0 }).expect(400);
    });

    it('services: nearby partners who serve their pets, with reasons; nothing without a location', async () => {
      const forAlice = await get(`/recommendations/services?lat=${PUNE.lat}&lng=${PUNE.lng}`, alice);
      expect(titles(forAlice)).toEqual(['Wag Spa']); // the cat groomer is skipped, Mumbai is too far
      expect(forAlice[0]).toMatchObject({ distanceKm: 2, fromPaise: 120000, reason: '2.0 km away' });
      const forCarol = await get(`/recommendations/services?lat=${PUNE.lat}&lng=${PUNE.lng}`, carol);
      expect(titles(forCarol)).toEqual(['Cat Corner']);
      expect(forCarol[0].reason).toBe('1.0 km away');
      expect(titles(await get(`/recommendations/services?lat=${PUNE.lat}&lng=${PUNE.lng}`, dave))).toEqual(['Wag Spa', 'Cat Corner']); // better rated outweighs 1 km
      expect(await get('/recommendations/services', dave)).toEqual([]);
      await http().get(`${API}/recommendations/services?lat=200&lng=1`).expect(400);
    });

    it('contests: ones their pets can still enter, then contests open for voting', async () => {
      const forAlice = await get('/recommendations/contests', alice);
      expect(titles(forAlice)).toEqual(['dog of the month']);
      expect(forAlice[0].reason).toBe('Bruno can enter');
      expect(titles(await get('/recommendations/contests', carol))).toEqual(['cat show']);
      expect(titles(await get('/recommendations/contests'))).toEqual(expect.arrayContaining(['dog of the month', 'cat show']));
      expect(titles(await get('/recommendations/contests'))).not.toContain('full house');
    });

    it('reels: people they follow first, one creator never fills the page, pages never repeat', async () => {
      const first = await http().get(`${API}/recommendations/reels?limit=5`).set(bearer(alice.token)).expect(200);
      const page1 = first.body.data.items as Array<{ id: string; reason: string | null; author: { id: string } }>;
      expect(page1[0]).toMatchObject({ id: ids['bob-reel'], reason: 'From someone you follow' });
      expect(page1.slice(0, 4).filter((p) => p.author.id === dave.id).length).toBeLessThanOrEqual(2);
      const seen = new Set(page1.map((p) => p.id));
      let cursor = first.body.data.nextCursor as string | null;
      while (cursor) {
        const r = await http().get(`${API}/recommendations/reels?limit=5&cursor=${cursor}`).set(bearer(alice.token)).expect(200);
        for (const p of r.body.data.items) {
          expect(seen.has(p.id)).toBe(false);
          seen.add(p.id);
        }
        cursor = r.body.data.nextCursor;
      }
      expect(seen.size).toBe(15);
      await http().post(`${API}/recommendations/dismiss`).set(bearer(alice.token)).send({ targetType: 'POST', targetId: ids['hot-cat'] }).expect(204);
      const again = (await get('/recommendations/reels?limit=30', alice)).items.map((p: { id: string }) => p.id);
      expect(again).not.toContain(ids['hot-cat']);
      expect((await get('/recommendations/reels?limit=30')).items.map((p: { id: string }) => p.id)[0]).toBe(ids['hot-cat']);
    });
  });

  describe('home screen sections', () => {
    const create = (body: Record<string, unknown>, token = admin, expect = 201) => http().post(`${API}/admin/home-sections`).set(bearer(token)).send(body).expect(expect).then((r) => r.body.data);

    it('admins build the home screen; each section is filled for the person looking, empty ones are left out', async () => {
      for (const [kind, title] of [
        ['FEATURED_REELS', 'Featured reels'], ['TRENDING_PETS', 'Trending pets'], ['ACTIVE_CONTESTS', 'Contests'], ['CHALLENGES', 'Challenges'],
        ['NEARBY_SERVICES', 'Near you'], ['RECOMMENDED_PRODUCTS', 'Picked for your pets'], ['PARTNER_OFFERS', 'Offers'], ['UPCOMING_EVENTS', 'Coming up'],
      ]) ids[kind] = (await create({ kind, title })).id;
      await create({ kind: 'TRENDING_PETS', title: 'x' }, moderator, 403);
      await create({ kind: 'NOPE', title: 'x' }, admin, 400);
      await create({ kind: 'TRENDING_PETS', title: 'x', itemLimit: 50 }, admin, 400);
      await create({ kind: 'TRENDING_PETS', title: 'x', startsAt: '2026-12-02T00:00:00Z', endsAt: '2026-12-01T00:00:00Z' }, admin, 400);

      const home = await get(`/home?lat=${PUNE.lat}&lng=${PUNE.lng}&city=Pune`, alice);
      expect(home).toMatchObject({ city: 'Pune', personalised: true });
      // No offers picked yet, so that section is left out.
      expect(home.sections.map((s: { kind: string }) => s.kind)).toEqual(['FEATURED_REELS', 'TRENDING_PETS', 'ACTIVE_CONTESTS', 'CHALLENGES', 'NEARBY_SERVICES', 'RECOMMENDED_PRODUCTS', 'UPCOMING_EVENTS']);
      const sec = (kind: string) => home.sections.find((s: { kind: string }) => s.kind === kind);
      expect(sec('NEARBY_SERVICES').items.map((x: { businessName: string }) => x.businessName)).toEqual(['Wag Spa']);
      expect(sec('RECOMMENDED_PRODUCTS').items[0]).toMatchObject({ title: 'Puppy kibble', reason: 'For Coco', pinned: false });
      expect(sec('TRENDING_PETS').items.map((p: { name: string }) => p.name)).not.toContain('Bruno'); // not her own pets
      expect(sec('UPCOMING_EVENTS').items.map((x: { title: string; label: string }) => `${x.label}: ${x.title}`)).toContain('Entries open: winter wonder');
      expect(sec('CHALLENGES').items[0]).toMatchObject({ title: '30-day walk', mine: null });
    });

    it('pins go first; offers appear once picked; links, handles, slugs and codes all work', async () => {
      const pin = (id: string, ref: string, expect = 201) => http().post(`${API}/admin/home-sections/${id}/pins`).set(bearer(admin)).send({ ref }).expect(expect).then((r) => r.body);
      let s = (await pin(ids.RECOMMENDED_PRODUCTS, 'https://petapp.in/product/rope-toy')).data;
      expect(s.pins).toEqual([{ id: ids['rope-toy'], label: 'Rope toy · Paws Mart', live: true }]);
      expect((await pin(ids.RECOMMENDED_PRODUCTS, 'rope-toy', 400)).message).toMatch(/already pinned/);
      expect((await pin(ids.RECOMMENDED_PRODUCTS, 'no-such-thing', 400)).message).toMatch(/Couldn’t find that. Enter a product/);
      expect((await pin(ids.UPCOMING_EVENTS, 'winter-wonder', 400)).message).toMatch(/different for everyone/);
      s = (await pin(ids.TRENDING_PETS, '@mia')).data;
      expect(s.pins[0]).toMatchObject({ label: 'Mia (@mia)', live: true });
      await pin(ids.PARTNER_OFFERS, 'paws10');
      await pin(ids.PARTNER_OFFERS, 'OLD5');

      const home = await get(`/home?lat=${PUNE.lat}&lng=${PUNE.lng}&city=Pune`, alice);
      const sec = (kind: string) => home.sections.find((x: { kind: string }) => x.kind === kind);
      expect(sec('RECOMMENDED_PRODUCTS').items[0]).toMatchObject({ title: 'Rope toy', pinned: true, reason: null });
      expect(sec('RECOMMENDED_PRODUCTS').items.filter((x: { title: string }) => x.title === 'Rope toy')).toHaveLength(1);
      expect(sec('TRENDING_PETS').items[0]).toMatchObject({ name: 'Mia', pinned: true });
      expect(sec('PARTNER_OFFERS').items).toEqual([expect.objectContaining({ code: 'PAWS10', kind: 'PERCENT', value: 1000, vendor: { id: expect.any(String), businessName: 'Paws Mart', slug: 'paws-mart' } })]); // the expired one isn't shown

      s = (await http().delete(`${API}/admin/home-sections/${ids.RECOMMENDED_PRODUCTS}/pins/${ids['rope-toy']}`).set(bearer(admin)).expect(200)).body.data;
      expect(s.pins).toEqual([]);
      const audit = await prisma.auditLog.findMany({ where: { action: { startsWith: 'home.' } }, select: { action: true } });
      expect(new Set(audit.map((a) => a.action))).toEqual(new Set(['home.section_create', 'home.pin_add', 'home.pin_remove']));
    });

    it('order, city and pet targeting, schedules and feature switches decide what shows', async () => {
      const all = (await get('/admin/home-sections', { token: admin, id: '' })) as Array<{ id: string; kind: string }>;
      const order = [ids.RECOMMENDED_PRODUCTS, ...all.map((s) => s.id).filter((id) => id !== ids.RECOMMENDED_PRODUCTS)];
      await http().put(`${API}/admin/home-sections/order`).set(bearer(admin)).send({ ids: order.slice(1) }).expect(400);
      await http().put(`${API}/admin/home-sections/order`).set(bearer(admin)).send({ ids: order }).expect(200);
      const patch = (id: string, body: Record<string, unknown>) => http().patch(`${API}/admin/home-sections/${id}`).set(bearer(admin)).send(body).expect(200);
      await patch(ids.CHALLENGES, { cities: ['Mumbai'] });
      await patch(ids.TRENDING_PETS, { speciesIds: [cat], title: 'Cats to follow' });
      await patch(ids.FEATURED_REELS, { startsAt: new Date(Date.now() + DAY).toISOString() });
      await flag('ENABLE_SERVICES', false);

      const kinds = async (u?: User, q = `?lat=${PUNE.lat}&lng=${PUNE.lng}&city=Pune`) => (await get(`/home${q}`, u)).sections.map((s: { kind: string }) => s.kind);
      expect(await kinds(alice)).toEqual(['RECOMMENDED_PRODUCTS', 'ACTIVE_CONTESTS', 'PARTNER_OFFERS', 'UPCOMING_EVENTS']);
      expect(await kinds(carol)).toContain('TRENDING_PETS'); // she has a cat
      expect(await kinds(alice, `?city=mumbai`)).toContain('CHALLENGES');

      const preview = (await http().get(`${API}/admin/home-sections/preview?city=Pune&lat=${PUNE.lat}&lng=${PUNE.lng}`).set(bearer(admin)).expect(200)).body.data;
      const why = Object.fromEntries(preview.skipped.map((s: { id: string; why: string }) => [s.id, s.why]));
      expect(why).toMatchObject({
        [ids.CHALLENGES]: 'only for other cities',
        [ids.TRENDING_PETS]: 'only for people with certain pets',
        [ids.FEATURED_REELS]: 'scheduled for later',
        [ids.NEARBY_SERVICES]: 'Services is switched off',
      });
      await flag('ENABLE_SERVICES', true);
      await patch(ids.FEATURED_REELS, { startsAt: null, isActive: false });
      expect(await kinds(alice)).not.toContain('FEATURED_REELS');
      await http().delete(`${API}/admin/home-sections/${ids.FEATURED_REELS}`).set(bearer(admin)).expect(204);
      expect((await get('/admin/home-sections', { token: admin, id: '' })).map((s: { id: string }) => s.id)).not.toContain(ids.FEATURED_REELS);
    });

    it('"Coming up" lists their own booking first, then contests and challenges starting soon', async () => {
      const service = await prisma.partnerService.findFirstOrThrow({ where: { partnerId: ids['wag-spa'] } });
      const at = new Date(Date.now() + 2 * DAY);
      await prisma.booking.create({
        data: { code: 'PB-HOME1', customerId: alice.id, partnerId: ids['wag-spa'], serviceId: service.id, petId: bruno, slotIndex: 0, startsAt: at, endsAt: new Date(at.getTime() + 3600_000), mode: 'AT_CENTER', pricePaise: 120000, commissionBps: 1500, platformFeePaise: 18000, partnerEarningPaise: 102000, status: 'CONFIRMED' },
      });
      const home = await get(`/home?city=Pune`, alice);
      const up = home.sections.find((s: { kind: string }) => s.kind === 'UPCOMING_EVENTS').items;
      expect(up[0]).toMatchObject({ kind: 'BOOKING', title: 'Full groom at Wag Spa', subtitle: 'Bruno', label: 'Your booking' });
      expect((await get('/home?city=Pune', bob)).sections.find((s: { kind: string }) => s.kind === 'UPCOMING_EVENTS').items[0].kind).not.toBe('BOOKING');
    });

    it('the saved address is used when the app sends no location', async () => {
      await prisma.address.create({ data: { userId: dave.id, line1: '2 Street', city: 'Pune', state: 'Maharashtra', pincode: '411001', latitude: PUNE.lat, longitude: PUNE.lng, isDefault: true } });
      const home = await get('/home', dave);
      expect(home.city).toBe('Pune');
      expect(home.sections.find((s: { kind: string }) => s.kind === 'NEARBY_SERVICES').items.length).toBe(2);
    });
  });

  it('old viewing history is deleted after the retention period', async () => {
    await prisma.interestEvent.create({ data: { userId: bob.id, kind: 'PRODUCT_VIEW', targetId: ids['dog-food'], day: new Date('2026-01-01'), createdAt: new Date(Date.now() - 100 * DAY) } });
    await prisma.interestEvent.create({ data: { userId: bob.id, kind: 'PRODUCT_VIEW', targetId: ids['cat-food'], day: new Date('2026-10-01'), createdAt: new Date(Date.now() - 2 * DAY) } });
    expect(await app.get(InterestService).purge()).toBe(1);
    expect(await prisma.interestEvent.count({ where: { userId: bob.id } })).toBe(1);
  });
});
