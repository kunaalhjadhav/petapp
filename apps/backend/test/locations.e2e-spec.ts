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
import { seedLocations } from '../src/modules/locations/locations.seed';
import { MAP_PROVIDER, MapProviderError, type MapPlace } from '../src/providers/maps/map.provider';

const API = '/api/v1';
jest.setTimeout(180_000);
type User = { token: string; id: string; phone: string };

/** Phase 9c: the location database and its management, delivery zones at checkout, global search and pet discovery. */
describe('Locations, search and discovery (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  const inbox = new Map<string, string>();
  // A map provider the test controls (MAP_PROVIDER=google in production).
  const mapCalls: string[] = [];
  let mapFails = false;
  const bkc: MapPlace = { label: 'Bandra Kurla Complex', detail: 'Mumbai, Maharashtra, 400051', lat: 19.0656, lng: 72.8654, pincode: '400051', city: 'Mumbai' };
  const maps = {
    name: 'test', configured: true,
    search: async (q: string) => {
      mapCalls.push(`search:${q}`);
      if (mapFails) throw new MapProviderError('down');
      return q.toLowerCase().startsWith('bandra') ? [{ ...bkc, label: 'Bandra West', lat: 19.0596, lng: 72.8295 }, bkc] : [];
    },
    reverse: async (lat: number, lng: number) => (mapCalls.push(`reverse:${lat},${lng}`), lat === 0 ? null : bkc),
  };
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const unthrottle = async () => {
    const k = await redis.client.keys('throttle:*');
    if (k.length) await redis.client.del(...k);
  };
  const flag = (key: string, enabled: boolean) => prisma.featureFlag.upsert({ where: { key }, update: { enabled }, create: { key, enabled } }).then(() => redis.client.del('platform:flags'));
  const setting = (key: string, value: unknown) => prisma.appSetting.upsert({ where: { key }, update: { value: value as never }, create: { key, value: value as never } });

  async function login(phone: string, name: string): Promise<User> {
    await unthrottle();
    await http().post(`${API}/auth/otp/request`).send({ phone }).expect(200);
    const r = await http().post(`${API}/auth/otp/verify`).send({ phone, code: inbox.get(phone) }).expect(200);
    const u = { token: r.body.data.tokens.accessToken, id: r.body.data.user.id, phone };
    await http().patch(`${API}/users/me`).set(bearer(u.token)).send({ name }).expect(200);
    return u;
  }
  async function staff(email: string, role: string, name: string) {
    const r = await prisma.role.findUniqueOrThrow({ where: { key: role } });
    await prisma.user.create({ data: { email, name, passwordHash: await bcrypt.hash('Staff-Password-1', 10), roles: { create: [{ roleId: r.id }] } } });
    const res = await http().post(`${API}/admin/auth/login`).send({ email, password: 'Staff-Password-1' }).expect(200);
    return { token: res.body.data.tokens.accessToken as string, id: res.body.data.user.id as string };
  }

  let ana: User;
  let ben: User;
  let cy: User;
  let admin: { token: string };
  let agent: { token: string };
  let moderator: { token: string };
  let pune: string;
  let mumbai: string;
  let dog: string;
  let partnerId: string;
  let farPartnerId: string;
  let anaAddress: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_PROVIDER)
      .useValue({ name: 'capture', send: async (m: SmsMessage) => (inbox.set(m.to, m.body.match(/\d{6}/)![0]), {}) })
      .overrideProvider(MAP_PROVIDER)
      .useValue(maps)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    await redis.client.flushdb();
    const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' AND tablename <> 'spatial_ref_sys'`;
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
    await syncRbac(prisma);
    expect(await seedLocations(prisma)).toBeGreaterThan(20);
    expect(await seedLocations(prisma)).toBe(0); // idempotent
    for (const k of ['ENABLE_SERVICES', 'ENABLE_MARKETPLACE', 'ENABLE_REELS', 'ENABLE_CONTESTS']) await flag(k, true);
    pune = (await prisma.city.findUniqueOrThrow({ where: { slug: 'pune' } })).id;
    mumbai = (await prisma.city.findUniqueOrThrow({ where: { slug: 'mumbai' } })).id;

    ana = await login('+919800000301', 'Ana Rao');
    ben = await login('+919800000302', 'Ben Das');
    cy = await login('+919800000303', 'Cy Rao');
    admin = await staff('root@loc.test', 'SUPER_ADMIN', 'Root Admin');
    agent = await staff('agent@loc.test', 'SUPPORT_AGENT', 'Sana Iyer');
    moderator = await staff('mod@loc.test', 'MODERATOR', 'Mo Derator');

    dog = (await prisma.petSpecies.create({ data: { key: 'dog', name: 'Dog' } })).id;
    const sc = await prisma.serviceCategory.create({ data: { key: 'grooming', name: 'Grooming' } });
    const groomer = await login('+919800000304', 'Pia Groomer');
    partnerId = (await prisma.servicePartner.create({
      data: { userId: groomer.id, slug: 'pia-grooming', businessName: 'Pia Grooming Studio', phone: groomer.phone, addressLine: '1 Lane', area: 'Koregaon Park', city: 'Pune', state: 'Maharashtra', pincode: '411001', lat: 18.5362, lng: 73.8939, status: 'APPROVED', homeVisitRadiusKm: 5,
        services: { create: [{ categoryId: sc.id, name: 'Full groom', durationMin: 60, pricePaise: 120000, modes: ['AT_CENTER', 'AT_HOME'] }] } },
    })).id;
    const far = await login('+919800000305', 'Far Away');
    farPartnerId = (await prisma.servicePartner.create({
      data: { userId: far.id, slug: 'kochi-pets', businessName: 'Kochi Pet Spa', phone: far.phone, addressLine: '2 Road', city: 'Kochi', state: 'Kerala', pincode: '682001', lat: 9.9312, lng: 76.2673, status: 'APPROVED',
        services: { create: [{ categoryId: sc.id, name: 'Bath and groom', durationMin: 45, pricePaise: 90000, modes: ['AT_CENTER'] }] } },
    })).id;
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(unthrottle);

  describe('the location database', () => {
    it('lists states and cities', async () => {
      const states = (await http().get(`${API}/locations/states`).expect(200)).body.data;
      expect(states).toHaveLength(36);
      expect(states.find((s: { code: string }) => s.code === 'MH')).toMatchObject({ name: 'Maharashtra', isUnionTerritory: false });
      const mh = (await http().get(`${API}/locations/cities?stateCode=MH`).expect(200)).body.data;
      expect(mh.map((c: { slug: string }) => c.slug)).toEqual(expect.arrayContaining(['pune', 'mumbai', 'nagpur']));
      expect((await http().get(`${API}/locations/cities?q=bengal`).expect(200)).body.data[0]).toMatchObject({ name: 'Bengaluru', state: { code: 'KA' } });
      await http().get(`${API}/locations/pincodes/411001`).expect(404);
      await http().get(`${API}/locations/pincodes/abc`).expect(400);
    });

    it('needs location permissions to manage', async () => {
      await http().get(`${API}/admin/locations/cities`).set(bearer(moderator.token)).expect(403);
      expect((await http().get(`${API}/admin/locations/cities`).set(bearer(agent.token)).expect(200)).body.meta.total).toBeGreaterThan(20);
      await http().post(`${API}/admin/locations/cities/${pune}/localities`).set(bearer(agent.token)).send({ name: 'Camp' }).expect(403);
    });

    it('adds areas and imports PIN codes (with a dry run and line-by-line errors)', async () => {
      const kp = await http().post(`${API}/admin/locations/cities/${pune}/localities`).set(bearer(admin.token)).send({ name: 'Koregaon Park', lat: 18.5362, lng: 73.8939 }).expect(201);
      expect(kp.body.data.slug).toBe('koregaon-park');
      await http().post(`${API}/admin/locations/cities/${pune}/localities`).set(bearer(admin.token)).send({ name: 'Koregaon  park' }).expect(409);
      await http().post(`${API}/admin/locations/cities/${pune}/localities`).set(bearer(admin.token)).send({ name: 'Half', lat: 18.5 }).expect(400);

      await http().post(`${API}/admin/locations/cities/${mumbai}/pincodes`).set(bearer(admin.token)).send({ code: '400001' }).expect(201);
      const csv = 'pincode,locality,lat,lng\n411001,Koregaon Park,18.5362,73.8939\n411014,Viman Nagar,18.5679,73.9143\n411036,Mundhwa,,\n400001,Fort,,\nbad,Row,,\n';
      const dry = (await http().post(`${API}/admin/locations/cities/${pune}/import`).set(bearer(admin.token)).send({ csv, dryRun: true }).expect(200)).body.data;
      expect(dry).toMatchObject({ dryRun: true, rows: 4, areasCreated: 2, pincodesAdded: 3, pincodesUpdated: 0 });
      expect(dry.errors).toEqual(['Line 6: “bad” isn’t a 6-digit PIN code.', 'Line 5: 400001 is already in Mumbai.']);
      expect(await prisma.pincode.count({ where: { cityId: pune } })).toBe(0);
      const done = (await http().post(`${API}/admin/locations/cities/${pune}/import`).set(bearer(admin.token)).send({ csv }).expect(200)).body.data;
      expect(done).toMatchObject({ dryRun: false, areasCreated: 2, pincodesAdded: 3 });
      const again = (await http().post(`${API}/admin/locations/cities/${pune}/import`).set(bearer(admin.token)).send({ csv: '411036,Mundhwa,18.53,73.93' }).expect(200)).body.data;
      expect(again).toMatchObject({ areasCreated: 0, pincodesAdded: 0, pincodesUpdated: 1, errors: [] });

      const city = (await http().get(`${API}/admin/locations/cities/${pune}`).set(bearer(agent.token)).expect(200)).body.data;
      expect(city).toMatchObject({ name: 'Pune', pincodes: 3, partnersNearby: 1 });
      expect(city.localities.map((l: { name: string }) => l.name)).toEqual(['Koregaon Park', 'Mundhwa', 'Viman Nagar']);
      const pins = (await http().get(`${API}/admin/locations/cities/${pune}/pincodes?q=4110`).set(bearer(agent.token)).expect(200)).body.data;
      expect(pins.map((p: { code: string }) => p.code)).toEqual(['411001', '411014', '411036']);
      expect(await prisma.auditLog.count({ where: { action: 'location.import' } })).toBe(2);
    });

    it('looks up PIN codes and points', async () => {
      const p = (await http().get(`${API}/locations/pincodes/411 014`).expect(200)).body.data;
      expect(p).toMatchObject({ pincode: '411014', city: { name: 'Pune', slug: 'pune' }, state: { code: 'MH' }, locality: { name: 'Viman Nagar' }, lat: 18.5679 });
      const r = (await http().get(`${API}/locations/resolve?lat=18.537&lng=73.894`).expect(200)).body.data;
      expect(r).toMatchObject({ city: { slug: 'pune' }, locality: { name: 'Koregaon Park' } });
      expect((await http().get(`${API}/locations/resolve?lat=0&lng=0`).expect(200)).body.data.city).toBeNull();
      const page = (await http().get(`${API}/locations/cities/pune`).expect(200)).body.data;
      expect(page.localities).toHaveLength(3);
    });

    it('searches places: a PIN code, cities and areas from PetApp, then the map provider (spec §19)', async () => {
      const pin = (await http().get(`${API}/locations/search?q=411014`).expect(200)).body.data;
      expect(pin.places).toEqual([expect.objectContaining({ kind: 'PINCODE', label: 'Viman Nagar, Pune', pincode: '411014', citySlug: 'pune', source: 'petapp' })]);
      const area = (await http().get(`${API}/locations/search?q=koregaon`).expect(200)).body.data.places;
      expect(area[0]).toMatchObject({ kind: 'LOCALITY', label: 'Koregaon Park', detail: 'Pune 411001', lat: 18.5362, citySlug: 'pune', source: 'petapp' });
      const city = (await http().get(`${API}/locations/search?q=pun`).expect(200)).body.data.places;
      expect(city[0]).toMatchObject({ kind: 'CITY', label: 'Pune', citySlug: 'pune' });
      // Not in PetApp's database: the map provider fills in, once a day per search.
      mapCalls.length = 0;
      const b = (await http().get(`${API}/locations/search?q=Bandra%20`).expect(200)).body.data;
      expect(b).toMatchObject({ maps: 'test' });
      expect(b.places.map((x: { label: string; source: string }) => [x.label, x.source])).toEqual([['Bandra West', 'maps'], ['Bandra Kurla Complex', 'maps']]);
      await http().get(`${API}/locations/search?q=bandra`).expect(200);
      expect(mapCalls).toEqual(['search:Bandra']);
      // A map failure never stops PetApp's own answers.
      mapFails = true;
      expect((await http().get(`${API}/locations/search?q=viman`).expect(200)).body.data.places[0]).toMatchObject({ label: 'Viman Nagar', source: 'petapp' });
      expect((await http().get(`${API}/locations/search?q=nowhere-at-all`).expect(200)).body.data.places).toEqual([]);
      mapFails = false;
      expect((await http().get(`${API}/locations/search?q=x`).expect(400)).body.message).toBe('Validation failed');
      // A point with no PetApp area gets the map's name for it; one with an area doesn't ask.
      mapCalls.length = 0;
      expect((await http().get(`${API}/locations/resolve?lat=19.0656&lng=72.8654`).expect(200)).body.data.place).toEqual({ label: 'Bandra Kurla Complex', detail: 'Mumbai, Maharashtra, 400051', pincode: '400051' });
      expect((await http().get(`${API}/locations/resolve?lat=18.537&lng=73.894`).expect(200)).body.data.place).toBeNull();
      expect(mapCalls).toEqual(['reverse:19.066,72.865']);
    });

    it('turns on service coverage city by city', async () => {
      // Nothing switched on yet: everywhere is covered.
      expect((await http().get(`${API}/locations/coverage?lat=9.93&lng=76.26`).expect(200)).body.data).toMatchObject({ covered: true, liveCities: 0 });
      await http().patch(`${API}/admin/locations/cities/${pune}`).set(bearer(admin.token)).send({ servicesLive: true }).expect(200);
      expect((await http().get(`${API}/locations/coverage?lat=18.6&lng=73.8`).expect(200)).body.data).toMatchObject({ covered: true, city: { slug: 'pune' } });
      const kochi = (await http().get(`${API}/locations/coverage?lat=9.93&lng=76.26`).expect(200)).body.data;
      expect(kochi).toMatchObject({ covered: false, city: null, nearest: { name: 'Pune' } });
      expect(await prisma.auditLog.count({ where: { action: 'location.coverage', entityId: pune } })).toBe(1);

      const ov = (await http().get(`${API}/admin/locations/coverage`).set(bearer(agent.token)).expect(200)).body.data;
      expect(ov).toMatchObject({ liveCities: 1, partnersOutside: 1 });
      expect(ov.cities[0]).toMatchObject({ slug: 'pune', servicesLive: true, partners: 1, homeVisits: 1 });
    });

    it('lists partner locations and lets staff correct one', async () => {
      const all = (await http().get(`${API}/admin/locations/partners`).set(bearer(agent.token)).expect(200)).body.data;
      expect(all.find((p: { id: string }) => p.id === partnerId)).toMatchObject({ covered: true, nearestCity: { name: 'Pune' }, homeVisitRadiusKm: 5 });
      const outside = (await http().get(`${API}/admin/locations/partners?outside=true`).set(bearer(agent.token)).expect(200)).body.data;
      expect(outside.map((p: { id: string }) => p.id)).toEqual([farPartnerId]);
      await http().patch(`${API}/admin/locations/partners/${farPartnerId}`).set(bearer(agent.token)).send({ homeVisitRadiusKm: 3, reason: 'Asked by phone' }).expect(403);
      await http().patch(`${API}/admin/locations/partners/${farPartnerId}`).set(bearer(admin.token)).send({ lat: 18.52 }).expect(400);
      const moved = (await http().patch(`${API}/admin/locations/partners/${farPartnerId}`).set(bearer(admin.token)).send({ lat: 18.52, lng: 73.85, city: 'Pune', state: 'Maharashtra', pincode: '411036', homeVisitRadiusKm: 3, reason: 'Moved to Pune' }).expect(200)).body.data;
      expect(moved).toMatchObject({ covered: true, city: 'Pune', homeVisitRadiusKm: 3 });
      expect(await prisma.auditLog.count({ where: { action: 'location.partner_update', entityId: farPartnerId } })).toBe(1);
      await http().patch(`${API}/admin/locations/partners/${farPartnerId}`).set(bearer(admin.token)).send({ lat: 9.9312, lng: 76.2673, city: 'Kochi', state: 'Kerala', pincode: '682001', reason: 'Back' }).expect(200);
    });

    it('protects cities that have areas', async () => {
      await http().delete(`${API}/admin/locations/cities/${pune}`).set(bearer(admin.token)).expect(409);
      const c = await http().post(`${API}/admin/locations/cities`).set(bearer(admin.token)).send({ name: 'Nashik', stateCode: 'MH', lat: 19.9975, lng: 73.7898 }).expect(201);
      await http().post(`${API}/admin/locations/cities`).set(bearer(admin.token)).send({ name: 'Nashik', stateCode: 'MH', lat: 19.9, lng: 73.7 }).expect(409);
      await http().post(`${API}/admin/locations/cities`).set(bearer(admin.token)).send({ name: 'Nowhere', stateCode: 'ZZ', lat: 1, lng: 1 }).expect(400);
      await http().delete(`${API}/admin/locations/cities/${c.body.data.id}`).set(bearer(admin.token)).expect(200);
    });
  });

  describe('delivery zones', () => {
    let productVariant: string;
    let zoneId: string;

    beforeAll(async () => {
      const vendorUser = await login('+919800000306', 'Vik Seller');
      const vendor = await prisma.vendor.create({ data: { userId: vendorUser.id, slug: 'vik', businessName: 'Vik Pet Supplies', phone: vendorUser.phone, addressLine: '2 Road', city: 'Pune', state: 'Maharashtra', pincode: '411004', status: 'APPROVED' } });
      const cat = await prisma.productCategory.create({ data: { key: 'food', name: 'Food' } });
      const p = await prisma.product.create({ data: { vendorId: vendor.id, categoryId: cat.id, title: 'Chicken kibble', slug: 'chicken-kibble', description: 'Dry food', brand: 'Wag', status: 'ACTIVE', variants: { create: [{ sku: 'K', title: '3 kg', mrpPaise: 99900, pricePaise: 20000, stock: 9 }] } }, include: { variants: true } });
      productVariant = p.variants[0].id;
      anaAddress = (await prisma.address.create({ data: { userId: ana.id, line1: '5 Lane', city: 'Pune', state: 'Maharashtra', pincode: '411014' } })).id;
      await http().put(`${API}/cart/items`).set(bearer(ana.token)).send({ variantId: productVariant, qty: 1 }).expect(200);
    });

    it('checks zones and prices delivery for an address', async () => {
      await http().post(`${API}/admin/locations/zones`).set(bearer(admin.token)).send({ name: 'Empty' }).expect(400);
      await http().post(`${API}/admin/locations/zones`).set(bearer(admin.token)).send({ name: 'Bad', pincodes: ['41*0'] }).expect(400);
      await http().post(`${API}/admin/locations/zones`).set(bearer(admin.token)).send({ name: 'Slow', stateCodes: ['MH'], minDays: 5, maxDays: 2 }).expect(400);
      // Without an address, nothing changes.
      const plain = (await http().post(`${API}/checkout/preview`).set(bearer(ana.token)).send({}).expect(200)).body.data;
      expect(plain).toMatchObject({ shippingPaise: 4900, delivery: null, canCheckout: true });

      await http().post(`${API}/admin/locations/zones`).set(bearer(admin.token)).send({ name: 'Maharashtra', stateCodes: ['MH'], minDays: 3, maxDays: 5 }).expect(201);
      zoneId = (await http().post(`${API}/admin/locations/zones`).set(bearer(admin.token)).send({ name: 'Pune city', cityIds: [pune], pincodes: ['4110*'], shippingFlatPaise: 0, minDays: 1, maxDays: 2 }).expect(201)).body.data.id;
      const p = (await http().post(`${API}/checkout/preview`).set(bearer(ana.token)).send({ addressId: anaAddress }).expect(200)).body.data;
      expect(p).toMatchObject({ shippingPaise: 0, delivery: { deliverable: true, zone: { name: 'Pune city' }, line: 'Delivery in 1–2 days' }, canCheckout: true });
      const check = (await http().get(`${API}/admin/locations/zones/check?pincode=411014`).set(bearer(agent.token)).expect(200)).body.data;
      expect(check).toMatchObject({ known: true, city: { name: 'Pune' }, zone: { name: 'Pune city' } });
      // An unknown PIN code only matches zones listed by PIN; at checkout, the address's state matches too.
      expect((await http().get(`${API}/admin/locations/zones/check?pincode=440001`).set(bearer(agent.token)).expect(200)).body.data).toMatchObject({ known: false, zone: null });
      const nagpur = (await prisma.address.create({ data: { userId: ana.id, line1: '9 Road', city: 'Nagpur', state: 'Maharashtra', pincode: '440001' } })).id;
      expect((await http().post(`${API}/checkout/preview`).set(bearer(ana.token)).send({ addressId: nagpur }).expect(200)).body.data).toMatchObject({ shippingPaise: 4900, delivery: { zone: { name: 'Maharashtra' }, line: 'Delivery in 3–5 days' } });
      await http().post(`${API}/checkout/preview`).set(bearer(ben.token)).send({ addressId: anaAddress }).expect(404);
    });

    it('refuses addresses outside every zone when zones are required, and blocked zones', async () => {
      const goa = (await prisma.address.create({ data: { userId: ana.id, line1: '1 Beach', city: 'Panaji', state: 'Goa', pincode: '403001' } })).id;
      expect((await http().post(`${API}/checkout/preview`).set(bearer(ana.token)).send({ addressId: goa }).expect(200)).body.data).toMatchObject({ shippingPaise: 4900, delivery: { deliverable: true, zone: null }, canCheckout: true });
      await setting('marketplace.deliveryZonesOnly', true);
      const out = (await http().post(`${API}/checkout/preview`).set(bearer(ana.token)).send({ addressId: goa }).expect(200)).body.data;
      expect(out).toMatchObject({ canCheckout: false, delivery: { deliverable: false, problem: 'We don’t deliver to 403001 yet.' } });
      expect((await http().post(`${API}/orders`).set(bearer(ana.token)).send({ addressId: goa }).expect(400)).body.message).toBe('We don’t deliver to 403001 yet.');
      await setting('marketplace.deliveryZonesOnly', false);

      await http().patch(`${API}/admin/locations/zones/${zoneId}`).set(bearer(admin.token)).send({ deliverable: false, note: 'Paused during the floods.' }).expect(200);
      expect((await http().post(`${API}/checkout/preview`).set(bearer(ana.token)).send({ addressId: anaAddress }).expect(200)).body.data.delivery).toMatchObject({ deliverable: false, problem: 'Paused during the floods.' });
      await http().delete(`${API}/admin/locations/zones/${zoneId}`).set(bearer(admin.token)).expect(200);
      expect((await http().get(`${API}/admin/locations/zones`).set(bearer(agent.token)).expect(200)).body.data.map((z: { name: string }) => z.name)).toEqual(['Maharashtra']);
    });
  });

  describe('global search', () => {
    beforeAll(async () => {
      const pet = (owner: string, name: string, handle: string, extra: Record<string, unknown> = {}) =>
        prisma.pet.create({ data: { ownerId: owner, speciesId: dog, name, handle, city: 'Pune', ...extra } });
      await pet(ana.id, 'Bruno', 'bruno.ana', { followerCount: 5, latitude: 18.5362, longitude: 73.8939, discoverable: true });
      await pet(ben.id, 'Bruno Jr', 'brunojr.ben', { latitude: 18.54, longitude: 73.9, discoverable: true });
      await pet(ben.id, 'Big Bruno', 'bigbruno.ben', { visibility: 'PRIVATE', latitude: 18.54, longitude: 73.9, discoverable: true });
      await pet(cy.id, 'Brunella', 'brunella.cy', { latitude: 18.55, longitude: 73.9 }); // not discoverable
      await prisma.pet.create({ data: { ownerId: cy.id, speciesId: dog, name: 'Far Dog', handle: 'far.cy', latitude: 19.07, longitude: 72.87, discoverable: true } });
      const tag = await prisma.hashtag.create({ data: { tag: 'beachday' } });
      await prisma.post.create({ data: { authorId: ben.id, type: 'REEL', status: 'PUBLISHED', visibility: 'PUBLIC', caption: 'Zoomies at the beach', publishedAt: new Date(), likeCount: 3, hashtags: { create: [{ hashtagId: tag.id }] } } });
      await prisma.post.create({ data: { authorId: ben.id, type: 'REEL', status: 'HIDDEN', visibility: 'PUBLIC', caption: 'Hidden beach reel', publishedAt: new Date() } });
      const creator = (await prisma.user.findFirstOrThrow({ where: { email: 'root@loc.test' } })).id;
      const day = 86_400_000;
      const now = Date.now();
      const contest = await prisma.contest.create({
        data: { slug: 'bruno-look-alike', title: 'Bruno look-alike', description: 'x', status: 'LIVE', createdById: creator,
          registrationOpensAt: new Date(now - day), registrationClosesAt: new Date(now + day), submissionClosesAt: new Date(now + 2 * day), votingClosesAt: new Date(now + 3 * day) },
      });
      await prisma.contest.create({
        data: { slug: 'bruno-draft', title: 'Bruno draft contest', description: 'x', status: 'DRAFT', createdById: creator,
          registrationOpensAt: new Date(now), registrationClosesAt: new Date(now + day), submissionClosesAt: new Date(now + 2 * day), votingClosesAt: new Date(now + 3 * day) },
      });
      const challenge = await prisma.challenge.create({ data: { slug: 'walk-with-bruno', title: 'Walk with Bruno', description: 'x', status: 'PUBLISHED', startsAt: new Date(now - day), endsAt: new Date(now + 10 * day), requiredCheckIns: 7, createdById: creator } });
      const bruno = await prisma.pet.findUniqueOrThrow({ where: { handle: 'bruno.ana' } });
      await prisma.contestParticipant.create({ data: { contestId: contest.id, userId: ana.id, petId: bruno.id, status: 'REGISTERED' } });
      await prisma.challengeParticipant.create({ data: { challengeId: challenge.id, userId: ana.id, petId: bruno.id, status: 'ACTIVE', points: 40, checkIns: 4 } });
    });

    it('finds every kind, best matches first, public things only', async () => {
      const all = (await http().get(`${API}/search?q=bruno`).set(bearer(cy.token)).expect(200)).body.data;
      const by = Object.fromEntries(all.groups.map((g: { type: string; items: Array<{ title: string }> }) => [g.type, g.items.map((i) => i.title)]));
      expect(by.pets).toEqual(['Bruno', 'Bruno Jr']); // exact first; the private pet never appears
      expect(by.contests).toEqual(['Bruno look-alike']); // not the draft
      expect(by.challenges).toEqual(['Walk with Bruno']);
      expect(all.groups[0].items[0]).toMatchObject({ type: 'PET', link: { kind: 'pet', key: 'bruno.ana' }, subtitle: '@bruno.ana · Dog · Pune' });

      const tags = (await http().get(`${API}/search?q=%23beachday`).expect(200)).body.data;
      expect(tags.groups[0]).toMatchObject({ type: 'reels', items: [{ title: 'Zoomies at the beach', link: { kind: 'reel' } }] });
      expect((await http().get(`${API}/search/reels?q=beach`).expect(200)).body.data).toHaveLength(1);

      const svc = (await http().get(`${API}/search/services?q=groom&lat=18.53&lng=73.89&radiusKm=10`).expect(200)).body.data;
      expect(svc).toHaveLength(1);
      expect(svc[0]).toMatchObject({ type: 'SERVICE', title: 'Full groom', link: { kind: 'service', key: 'pia-grooming' }, meta: { homeVisit: true } });
      expect(svc[0].meta.distance).toMatch(/m$|km$/);
      expect((await http().get(`${API}/search/services?q=groom`).expect(200)).body.data).toHaveLength(2);
      expect((await http().get(`${API}/search/services?q=groom&mode=AT_HOME`).expect(200)).body.data).toHaveLength(1);
      expect((await http().get(`${API}/search/partners?q=koregaon`).expect(200)).body.data[0]).toMatchObject({ title: 'Pia Grooming Studio' });
      expect((await http().get(`${API}/search/products?q=wag`).expect(200)).body.data[0]).toMatchObject({ type: 'PRODUCT', link: { kind: 'product', key: 'chicken-kibble' }, meta: { fromPaise: 20000 } });
      expect((await http().get(`${API}/search/contests?q=bruno&when=past`).expect(200)).body.data).toHaveLength(0);
      expect((await http().get(`${API}/search/challenges?q=walk&when=active`).expect(200)).body.data).toHaveLength(1);
      const pets = (await http().get(`${API}/search/pets?q=bru&speciesId=${dog}`).expect(200)).body;
      expect(pets.meta.total).toBe(3);
      expect(pets.data[0].title).toBe('Bruno');
      expect((await http().get(`${API}/search/pets?q=%40bigbruno`).expect(200)).body.data).toHaveLength(0);
    });

    it('finds people, never staff, and hides people you blocked', async () => {
      const people = (await http().get(`${API}/search/users?q=rao`).set(bearer(ben.token)).expect(200)).body.data;
      expect(people.map((u: { title: string }) => u.title).sort()).toEqual(['Ana Rao', 'Cy Rao']);
      expect(people[0]).not.toHaveProperty('phone');
      expect((await http().get(`${API}/search/users?q=admin`).expect(200)).body.data).toHaveLength(0);
      await http().post(`${API}/users/${ana.id}/block`).set(bearer(ben.token)).expect(200);
      expect((await http().get(`${API}/search/users?q=rao`).set(bearer(ben.token)).expect(200)).body.data.map((u: { title: string }) => u.title)).toEqual(['Cy Rao']);
      expect((await http().get(`${API}/search/pets?q=bruno`).set(bearer(ben.token)).expect(200)).body.data.map((p: { title: string }) => p.title)).toEqual(['Bruno Jr']);
      await http().delete(`${API}/users/${ana.id}/block`).set(bearer(ben.token)).expect(200);
    });

    it('offers filters for each kind and respects switched-off features', async () => {
      const f = (await http().get(`${API}/search/filters`).expect(200)).body.data;
      expect(f.types).toEqual(['pets', 'users', 'reels', 'products', 'services', 'partners', 'contests', 'challenges']);
      expect(f.pets.species).toEqual([{ id: dog, name: 'Dog' }]);
      expect(f.services.modes).toHaveLength(2);
      await flag('ENABLE_MARKETPLACE', false);
      await http().get(`${API}/search/products?q=wag`).expect(404);
      expect((await http().get(`${API}/search?q=wag`).expect(200)).body.data.groups.map((g: { type: string }) => g.type)).not.toContain('products');
      await flag('ENABLE_MARKETPLACE', true);
      await http().get(`${API}/search/everything?q=wag`).expect(400);
      expect((await http().get(`${API}/search?q=a`).expect(200)).body.data.groups).toEqual([]);
    });
  });

  describe('pet discovery', () => {
    it('shows pets near you only when their owners allow it, with a rounded distance', async () => {
      const near = (await http().get(`${API}/discover/pets/nearby?lat=18.5362&lng=73.8939`).set(bearer(cy.token)).expect(200)).body.data;
      expect(near.map((p: { name: string }) => p.name)).toEqual(['Bruno', 'Bruno Jr']); // not private, not opted out, not Mumbai
      expect(near[0].distanceKm).toBe(1);
      expect(near[0]).not.toHaveProperty('latitude');
      expect(near[0]).not.toHaveProperty('location');
      // Your own pets aren't "near you".
      expect((await http().get(`${API}/discover/pets/nearby?lat=18.5362&lng=73.8939`).set(bearer(ana.token)).expect(200)).body.data.map((p: { name: string }) => p.name)).toEqual(['Bruno Jr']);
      expect((await http().get(`${API}/discover/pets/nearby?lat=18.5362&lng=73.8939&radiusKm=50`).expect(200)).body.meta.total).toBe(2);
      await http().get(`${API}/discover/pets/nearby?lat=18.5362&lng=73.8939&radiusKm=200`).expect(400);
      // Owners switch it on and off.
      const bruno = await prisma.pet.findUniqueOrThrow({ where: { handle: 'bruno.ana' } });
      const off = (await http().patch(`${API}/pets/${bruno.id}`).set(bearer(ana.token)).send({ discoverable: false }).expect(200)).body.data;
      expect(off.discoverable).toBe(false);
      expect((await http().get(`${API}/discover/pets/nearby?lat=18.5362&lng=73.8939`).expect(200)).body.data.map((p: { name: string }) => p.name)).toEqual(['Bruno Jr']);
      await http().patch(`${API}/pets/${bruno.id}`).set(bearer(ana.token)).send({ discoverable: true }).expect(200);
      // Others never see the setting.
      expect((await http().get(`${API}/pets/bruno.ana`).set(bearer(cy.token)).expect(200)).body.data).not.toHaveProperty('discoverable');
    });

    it('shows trending pets, popular reels and pets in contests and challenges', async () => {
      expect((await http().get(`${API}/discover/pets/trending`).expect(200)).body.data[0]).toMatchObject({ name: 'Bruno' });
      const entries = (await http().get(`${API}/discover/contest-entries`).expect(200)).body.data;
      expect(entries).toEqual([expect.objectContaining({ pet: expect.objectContaining({ name: 'Bruno' }), contest: expect.objectContaining({ slug: 'bruno-look-alike' }), voting: false })]);
      const ch = (await http().get(`${API}/discover/challenge-entries`).expect(200)).body.data;
      expect(ch[0]).toMatchObject({ points: 40, checkIns: 4, pet: { name: 'Bruno' }, challenge: { slug: 'walk-with-bruno', requiredCheckIns: 7 } });
      const reels = (await http().get(`${API}/discover/reels`).expect(200)).body.data;
      expect(reels.items.map((p: { caption: string }) => p.caption)).toEqual(['Zoomies at the beach']);
    });
  });
});
