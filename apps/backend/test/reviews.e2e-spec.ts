import { Test, type TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import * as bcrypt from 'bcryptjs';
import { readFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { WorkerModule } from '../src/worker/worker.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { SMS_PROVIDER, type SmsMessage } from '../src/providers/sms/sms.provider';
import { PUSH_PROVIDER } from '../src/providers/push/push.provider';
import { AiModerationService } from '../src/modules/trust/ai-moderation.service';
import { AccountEraser } from '../src/modules/privacy/account-eraser';
import { syncRbac } from '../src/modules/rbac/rbac.seed';

const API = '/api/v1';
const PHOTO = readFileSync(join(__dirname, 'fixtures', 'photo-gps.jpg'));
jest.setTimeout(180_000);
type User = { token: string; id: string; phone: string };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Reviews and reporting (e2e)', () => {
  let app: NestExpressApplication;
  let worker: TestingModule;
  let prisma: PrismaService;
  let redis: RedisService;
  const inbox = new Map<string, string>();
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const unthrottle = async () => {
    const k = await redis.client.keys('throttle:*');
    if (k.length) await redis.client.del(...k);
  };
  const flag = (key: string, enabled: boolean) => prisma.featureFlag.upsert({ where: { key }, update: { enabled }, create: { key, enabled } }).then(() => redis.client.del('platform:flags'));

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
  async function photo(token: string, isPrivate = false) {
    const r = await http().post(`${API}/media/uploads`).set(bearer(token)).send({ kind: 'IMAGE', mimeType: 'image/jpeg', sizeBytes: PHOTO.length, private: isPrivate }).expect(201);
    await fetch(r.body.data.upload.url, { method: 'PUT', headers: r.body.data.upload.headers, body: new Uint8Array(PHOTO) });
    await http().post(`${API}/media/${r.body.data.media.id}/complete`).set(bearer(token)).expect(200);
    for (let i = 0; i < 120; i++) {
      const m = await http().get(`${API}/media/${r.body.data.media.id}`).set(bearer(token)).expect(200);
      if (m.body.data.status === 'READY') return r.body.data.media.id as string;
      await sleep(250);
    }
    throw new Error('photo never got ready');
  }
  async function notification(userId: string, type: string) {
    for (let i = 0; i < 80; i++) {
      const n = await prisma.notification.findFirst({ where: { userId, type: type as never }, orderBy: { createdAt: 'desc' } });
      if (n) return n;
      await sleep(100);
    }
    throw new Error(`no ${type} notification`);
  }

  let ana: User; // buyer of kibble, booked grooming
  let ben: User; // buyer of the toy only
  let pia: User; // service partner
  let vik: User; // seller
  let admin: { token: string; id: string };
  let moderator: { token: string; id: string };
  let finance: { token: string; id: string };
  let partnerId: string;
  let vendorId: string;
  let productId: string;
  let toyId: string;
  let parcelId: string;
  let bookingId: string;
  let productReviewId: string;
  let serviceReviewId: string;

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
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' AND tablename <> 'spatial_ref_sys'`;
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
    await syncRbac(prisma);
    for (const k of ['ENABLE_SERVICES', 'ENABLE_MARKETPLACE']) await flag(k, true);
    await new S3Client({ region: process.env.S3_REGION, endpoint: process.env.S3_ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! } })
      .send(new CreateBucketCommand({ Bucket: process.env.S3_BUCKET })).catch(() => undefined);

    ana = await login('+919800000201', 'Ana Rao');
    ben = await login('+919800000202', 'Ben Das');
    pia = await login('+919800000203', 'Pia Groomer');
    vik = await login('+919800000204', 'Vik Seller');
    admin = await staff('root@reviews.test', 'SUPER_ADMIN', 'Root Admin');
    moderator = await staff('mod@reviews.test', 'MODERATOR', 'Mo Derator');
    finance = await staff('fin@reviews.test', 'FINANCE', 'Fin Ance');

    partnerId = (await prisma.servicePartner.create({
      data: { userId: pia.id, slug: 'pia-grooming', businessName: 'Pia Grooming', phone: pia.phone, addressLine: '1 MG Road', city: 'Pune', state: 'Maharashtra', pincode: '411001', lat: 18.52, lng: 73.85, status: 'APPROVED' },
    })).id;
    vendorId = (await prisma.vendor.create({ data: { userId: vik.id, slug: 'vik-pets', businessName: 'Vik Pet Supplies', phone: vik.phone, addressLine: '2 FC Road', city: 'Pune', state: 'Maharashtra', pincode: '411004', status: 'APPROVED' } })).id;
    const cat = await prisma.productCategory.create({ data: { key: 'food', name: 'Food' } });
    const kibble = await prisma.product.create({ data: { vendorId, categoryId: cat.id, title: 'Chicken kibble', slug: 'chicken-kibble', description: 'Dry food', status: 'ACTIVE', variants: { create: [{ sku: 'K3', title: '3 kg', mrpPaise: 99900, pricePaise: 89900, stock: 5 }] } }, include: { variants: true } });
    const toy = await prisma.product.create({ data: { vendorId, categoryId: cat.id, title: 'Rope toy', slug: 'rope-toy', description: 'Toy', status: 'ACTIVE', variants: { create: [{ sku: 'T1', title: 'Large', mrpPaise: 29900, pricePaise: 24900, stock: 5 }] } }, include: { variants: true } });
    productId = kibble.id;
    toyId = toy.id;

    // Ana's kibble is on its way; Ben's toy arrived.
    const parcel = async (userId: string, code: string, v: { id: string; title: string; pricePaise: number }, title: string, status: 'SHIPPED' | 'DELIVERED') => {
      const order = await prisma.order.create({ data: { code: `O-${code}`, userId, status: 'PAID', itemsPaise: v.pricePaise, discountPaise: 0, shippingPaise: 0, totalPaise: v.pricePaise, shipTo: { name: 'X', line1: 'Y', city: 'Pune', pincode: '411001' } } });
      return prisma.subOrder.create({
        data: {
          orderId: order.id, vendorId, code: `S-${code}`, status, itemsPaise: v.pricePaise, discountPaise: 0, shippingPaise: 0, totalPaise: v.pricePaise, commissionPaise: 0, vendorEarningPaise: v.pricePaise,
          deliveredAt: status === 'DELIVERED' ? new Date() : null,
          items: { create: [{ variantId: v.id, productTitle: title, variantTitle: v.title, sku: 'X', qty: 1, unitPricePaise: v.pricePaise, gstRateBps: 1800, gstPaise: 0, lineTotalPaise: v.pricePaise, commissionBps: 1000 }] },
        },
      });
    };
    parcelId = (await parcel(ana.id, 'A1', kibble.variants[0], kibble.title, 'SHIPPED')).id;
    await parcel(ben.id, 'B1', toy.variants[0], toy.title, 'DELIVERED');

    const sc = await prisma.serviceCategory.create({ data: { key: 'grooming', name: 'Grooming' } });
    const service = await prisma.partnerService.create({ data: { partnerId, categoryId: sc.id, name: 'Full groom', durationMin: 60, pricePaise: 120000, modes: ['AT_CENTER'] } });
    const dog = await prisma.petSpecies.create({ data: { key: 'dog', name: 'Dog' } });
    const pet = await prisma.pet.create({ data: { ownerId: ana.id, speciesId: dog.id, name: 'Bruno', handle: 'bruno-rv' } });
    const at = new Date(Date.now() - 2 * 86_400_000);
    bookingId = (await prisma.booking.create({
      data: { code: 'B-RV1', customerId: ana.id, partnerId, serviceId: service.id, petId: pet.id, slotIndex: 0, startsAt: at, endsAt: new Date(at.getTime() + 3_600_000), mode: 'AT_CENTER', pricePaise: 120000, commissionBps: 1500, platformFeePaise: 18000, partnerEarningPaise: 102000, status: 'COMPLETED', completedAt: at },
    })).id;

    worker = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(PUSH_PROVIDER)
      .useValue({ name: 'capture', send: async () => 'sent' })
      .compile();
    await worker.init();
  });

  afterAll(async () => {
    await worker?.close();
    await app?.close();
  });

  beforeEach(unthrottle);

  describe('product reviews', () => {
    it('need the product to have been delivered to the person', async () => {
      await http().post(`${API}/products/${productId}/reviews`).set(bearer(ana.token)).send({ rating: 5 }).expect(400);
      // Ben never bought the kibble.
      await http().post(`${API}/products/${productId}/reviews`).set(bearer(ben.token)).send({ rating: 1, comment: 'Bad' }).expect(400);
      const order = (await http().get(`${API}/orders`).set(bearer(ana.token)).expect(200)).body.data[0];
      const view = (await http().get(`${API}/orders/${order.id}`).set(bearer(ana.token)).expect(200)).body.data;
      expect(view.parcels[0].items[0]).toMatchObject({ productId, productSlug: 'chicken-kibble', review: null, canReview: false });
      await prisma.subOrder.update({ where: { id: parcelId }, data: { status: 'DELIVERED', deliveredAt: new Date() } });
      const after = (await http().get(`${API}/orders/${order.id}`).set(bearer(ana.token)).expect(200)).body.data;
      expect(after.parcels[0].items[0].canReview).toBe(true);
    });

    it('takes stars, words and public photos; one per person per product', async () => {
      const pic = await photo(ana.token);
      const secret = await photo(ana.token, true);
      const bens = await photo(ben.token);
      // Private uploads and other people's photos can't be used.
      await http().post(`${API}/products/${productId}/reviews`).set(bearer(ana.token)).send({ rating: 4, photoIds: [secret] }).expect(400);
      await http().post(`${API}/products/${productId}/reviews`).set(bearer(ana.token)).send({ rating: 4, photoIds: [bens] }).expect(400);
      await http().post(`${API}/products/${productId}/reviews`).set(bearer(ana.token)).send({ rating: 6 }).expect(400);

      const r = await http().post(`${API}/products/${productId}/reviews`).set(bearer(ana.token)).send({ rating: 4, comment: '  My dog loves it  ', photoIds: [pic] }).expect(201);
      productReviewId = r.body.data.id;
      expect(r.body.data).toMatchObject({ rating: 4, comment: 'My dog loves it', by: 'Ana R.', verified: true, variantTitle: '3 kg', status: 'VISIBLE', reply: null });
      expect(r.body.data.photos).toHaveLength(1);
      await http().post(`${API}/products/${productId}/reviews`).set(bearer(ana.token)).send({ rating: 5 }).expect(409);
      expect((await http().get(`${API}/products/${productId}/reviews/mine`).set(bearer(ana.token)).expect(200)).body.data.id).toBe(productReviewId);

      // The seller hears about it.
      const n = await notification(vik.id, 'REVIEW_RECEIVED');
      expect(n).toMatchObject({ entityType: 'ProductReview', entityId: productReviewId });
      // It's queued for an AI check, with its photo.
      const jobs = await app.get(AiModerationService).assess('PRODUCT_REVIEW', productReviewId);
      expect(['clear', 'flagged', 'unchanged']).toContain(jobs);

      await http().post(`${API}/products/${toyId}/reviews`).set(bearer(ben.token)).send({ rating: 2 }).expect(201);
    });

    it('shows ratings on the product page, cards and the review list', async () => {
      const p = (await http().get(`${API}/products/chicken-kibble`).expect(200)).body.data;
      expect(p).toMatchObject({ ratingAvg: 4, ratingCount: 1 });
      expect(p.ratingSummary.stars).toEqual([{ stars: 5, count: 0 }, { stars: 4, count: 1 }, { stars: 3, count: 0 }, { stars: 2, count: 0 }, { stars: 1, count: 0 }]);
      expect(p.reviews[0]).toMatchObject({ id: productReviewId, by: 'Ana R.', verified: true });

      const cards = (await http().get(`${API}/products?sort=rating`).expect(200)).body.data;
      expect(cards.map((c: { slug: string }) => c.slug)).toEqual(['chicken-kibble', 'rope-toy']);
      expect(cards[0]).toMatchObject({ ratingAvg: 4, ratingCount: 1 });

      const list = (await http().get(`${API}/products/chicken-kibble/reviews?photos=true`).expect(200)).body;
      expect(list.data).toHaveLength(1);
      expect(list.meta.total).toBe(1);
      expect((await http().get(`${API}/products/${productId}/reviews?stars=5`).expect(200)).body.data).toHaveLength(0);
      expect((await http().get(`${API}/products/${toyId}/reviews?photos=true`).expect(200)).body.data).toHaveLength(0);
      // The seller's average covers all their products.
      expect((await prisma.vendor.findUniqueOrThrow({ where: { id: vendorId } })).ratingAvg).toBe(3);
    });

    it('lets the seller reply once, and tells the customer', async () => {
      const mine = (await http().get(`${API}/vendor/reviews?unanswered=true`).set(bearer(vik.token)).expect(200)).body.data;
      expect(mine).toHaveLength(2);
      expect(mine.find((r: { id: string }) => r.id === productReviewId)).toMatchObject({ product: { id: productId, title: 'Chicken kibble' }, order: { code: 'S-A1' }, status: 'VISIBLE' });
      expect((await http().get(`${API}/vendor/reviews/summary`).set(bearer(vik.token)).expect(200)).body.data).toMatchObject({ unanswered: 2, summary: { count: 2, avg: 3 } });

      // Only the seller can reply.
      await http().post(`${API}/vendor/reviews/${productReviewId}/reply`).set(bearer(ben.token)).send({ reply: 'Thanks!' }).expect(404);
      await http().post(`${API}/partner/reviews/${productReviewId}/reply`).set(bearer(pia.token)).send({ reply: 'Thanks!' }).expect(404);
      await http().post(`${API}/vendor/reviews/${productReviewId}/reply`).set(bearer(vik.token)).send({ reply: 'Thank you, Ana!' }).expect(200);
      await http().post(`${API}/vendor/reviews/${productReviewId}/reply`).set(bearer(vik.token)).send({ reply: 'Again' }).expect(400);
      expect((await http().get(`${API}/vendor/reviews?unanswered=true`).set(bearer(vik.token)).expect(200)).body.data).toHaveLength(1);
      const n = await notification(ana.id, 'REVIEW_REPLY');
      expect(n).toMatchObject({ entityType: 'Product', entityId: productId });
      expect((n.data as { reply: string }).reply).toBe('Thank you, Ana!');
    });
  });

  describe('service reviews', () => {
    it('take photos and show a breakdown on the partner page', async () => {
      const pic = await photo(ana.token);
      const r = await http().post(`${API}/bookings/${bookingId}/review`).set(bearer(ana.token)).send({ rating: 5, comment: 'Gentle with Bruno', photoIds: [pic] }).expect(201);
      expect(r.body.data.review).toMatchObject({ rating: 5, status: 'VISIBLE' });
      expect(r.body.data.review.photos).toHaveLength(1);
      serviceReviewId = r.body.data.review.id;
      const page = (await http().get(`${API}/service-partners/pia-grooming`).expect(200)).body.data;
      expect(page).toMatchObject({ ratingAvg: 5, ratingCount: 1, ratingSummary: { count: 1, avg: 5 } });
      expect(page.reviews[0]).toMatchObject({ by: 'Ana R.', comment: 'Gentle with Bruno', verified: true });
      expect(page.reviews[0].photos).toHaveLength(1);
      expect((await http().get(`${API}/service-partners/${partnerId}/reviews?photos=true`).expect(200)).body.data).toHaveLength(1);
      expect((await notification(pia.id, 'REVIEW_RECEIVED')).entityType).toBe('ServiceReview');
    });

    it('lets the partner see and reply', async () => {
      const list = (await http().get(`${API}/partner/reviews`).set(bearer(pia.token)).expect(200)).body.data;
      expect(list[0]).toMatchObject({ id: serviceReviewId, booking: { id: bookingId, code: 'B-RV1', service: 'Full groom' } });
      expect((await http().get(`${API}/partner/reviews/summary`).set(bearer(pia.token)).expect(200)).body.data.unanswered).toBe(1);
      await http().post(`${API}/partner/reviews/${serviceReviewId}/reply`).set(bearer(vik.token)).send({ reply: 'Hi' }).expect(404);
      await http().post(`${API}/partner/reviews/${serviceReviewId}/reply`).set(bearer(pia.token)).send({ reply: 'See you next month!' }).expect(200);
      expect((await notification(ana.id, 'REVIEW_REPLY'))).toBeTruthy();
      const b = (await http().get(`${API}/bookings/${bookingId}`).set(bearer(ana.token)).expect(200)).body.data;
      expect(b.review).toMatchObject({ reply: 'See you next month!' });
    });
  });

  describe('moderation', () => {
    it('lists reviews for staff and hides one, which updates the rating', async () => {
      await http().get(`${API}/admin/reviews`).set(bearer(finance.token)).expect(403);
      const all = (await http().get(`${API}/admin/reviews?kind=PRODUCT`).set(bearer(moderator.token)).expect(200)).body.data;
      expect(all).toHaveLength(2);
      const found = (await http().get(`${API}/admin/reviews?kind=PRODUCT&q=loves`).set(bearer(moderator.token)).expect(200)).body.data;
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ id: productReviewId, business: { name: 'Vik Pet Supplies' }, subject: { label: 'Chicken kibble' }, customer: { name: 'Ana Rao' }, openCase: null });
      expect((await http().get(`${API}/admin/reviews?kind=SERVICE&stars=5`).set(bearer(moderator.token)).expect(200)).body.data[0].id).toBe(serviceReviewId);

      await http().post(`${API}/admin/product-reviews/${productReviewId}/status`).set(bearer(moderator.token)).send({ status: 'HIDDEN', note: 'Testing' }).expect(200);
      expect(await prisma.product.findUniqueOrThrow({ where: { id: productId } })).toMatchObject({ ratingAvg: 0, ratingCount: 0 });
      expect((await http().get(`${API}/products/${productId}/reviews`).expect(200)).body.data).toHaveLength(0);
      // The customer still sees their own review, marked hidden, and can't write another.
      expect((await http().get(`${API}/products/${productId}/reviews/mine`).set(bearer(ana.token)).expect(200)).body.data.status).toBe('HIDDEN');
      // Hidden reviews can't be replied to.
      const toyReview = (await prisma.productReview.findFirstOrThrow({ where: { productId: toyId } })).id;
      await http().post(`${API}/admin/product-reviews/${toyReview}/status`).set(bearer(moderator.token)).send({ status: 'HIDDEN' }).expect(200);
      await http().post(`${API}/vendor/reviews/${toyReview}/reply`).set(bearer(vik.token)).send({ reply: 'Sorry' }).expect(400);
      await http().post(`${API}/admin/product-reviews/${toyReview}/status`).set(bearer(moderator.token)).send({ status: 'VISIBLE' }).expect(200);
      await http().post(`${API}/admin/product-reviews/${productReviewId}/status`).set(bearer(moderator.token)).send({ status: 'VISIBLE' }).expect(200);
      expect(await prisma.product.findUniqueOrThrow({ where: { id: productId } })).toMatchObject({ ratingAvg: 4, ratingCount: 1 });
      expect(await prisma.auditLog.count({ where: { action: 'product_review.status', entityId: productReviewId } })).toBe(2);
    });
  });

  describe('reporting', () => {
    let caseId: string;

    it('accepts every kind of content, with private screenshots as evidence', async () => {
      const shot = await photo(ben.token, true);
      const pub = await photo(ben.token);
      // Evidence must be the reporter's own private upload.
      await http().post(`${API}/reports`).set(bearer(ben.token)).send({ targetType: 'PRODUCT_REVIEW', targetId: productReviewId, reason: 'SPAM', evidenceIds: [pub] }).expect(400);
      const r = await http().post(`${API}/reports`).set(bearer(ben.token)).send({ targetType: 'PRODUCT_REVIEW', targetId: productReviewId, reason: 'SPAM', details: 'Fake review', evidenceIds: [shot] }).expect(201);
      expect(r.body.data.status).toBe('received');
      await http().post(`${API}/reports`).set(bearer(ben.token)).send({ targetType: 'SERVICE_PARTNER', targetId: partnerId, reason: 'IMPERSONATION' }).expect(201);
      await http().post(`${API}/reports`).set(bearer(ben.token)).send({ targetType: 'SERVICE_REVIEW', targetId: serviceReviewId, reason: 'ABUSE' }).expect(201);
      await http().post(`${API}/reports`).set(bearer(ana.token)).send({ targetType: 'PRODUCT', targetId: toyId, reason: 'MISINFORMATION' }).expect(201);
      // Not your own; not unknown things; not twice.
      await http().post(`${API}/reports`).set(bearer(ana.token)).send({ targetType: 'PRODUCT_REVIEW', targetId: productReviewId, reason: 'SPAM' }).expect(400);
      await http().post(`${API}/reports`).set(bearer(ana.token)).send({ targetType: 'SERVICE_PARTNER', targetId: '00000000-0000-4000-8000-000000000000', reason: 'SPAM' }).expect(404);
      await http().post(`${API}/reports`).set(bearer(ben.token)).send({ targetType: 'SERVICE_PARTNER', targetId: partnerId, reason: 'SPAM' }).expect(409);
    });

    it('shows the reports dashboard: type, reason, reporter, entity, evidence, status, moderator and resolution', async () => {
      await http().get(`${API}/admin/moderation/reports`).set(bearer(finance.token)).expect(403);
      const res = await http().get(`${API}/admin/moderation/reports`).set(bearer(moderator.token)).expect(200);
      expect(res.body.meta.total).toBe(4);
      const rr = res.body.data.find((x: { targetType: string }) => x.targetType === 'PRODUCT_REVIEW');
      expect(rr).toMatchObject({ reason: 'SPAM', details: 'Fake review', status: 'OPEN', reporter: { id: ben.id, name: 'Ben Das' }, entity: { label: '4★ for Chicken kibble: My dog loves it', owner: { id: ana.id }, exists: true }, case: { status: 'OPEN', moderator: null, resolution: null } });
      expect(rr.evidence).toHaveLength(1);
      expect(rr.evidence[0].images[0].url).toContain('private/');
      caseId = rr.case.id;
      const partner = res.body.data.find((x: { targetType: string }) => x.targetType === 'SERVICE_PARTNER');
      expect(partner.entity).toMatchObject({ label: 'Pia Grooming', status: 'APPROVED' });

      expect((await http().get(`${API}/admin/moderation/reports?targetType=SERVICE_PARTNER`).set(bearer(moderator.token)).expect(200)).body.data).toHaveLength(1);
      expect((await http().get(`${API}/admin/moderation/reports?reason=MISINFORMATION`).set(bearer(moderator.token)).expect(200)).body.data[0].reporter.id).toBe(ana.id);
      expect((await http().get(`${API}/admin/moderation/reports?q=fake`).set(bearer(moderator.token)).expect(200)).body.data).toHaveLength(1);
      expect((await http().get(`${API}/admin/moderation/reports?q=ben%20das`).set(bearer(moderator.token)).expect(200)).body.data).toHaveLength(3);
      const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
      expect((await http().get(`${API}/admin/moderation/reports?from=${today}&to=${today}`).set(bearer(moderator.token)).expect(200)).body.meta.total).toBe(4);
      expect((await http().get(`${API}/admin/moderation/reports?to=2020-01-01`).set(bearer(moderator.token)).expect(200)).body.meta.total).toBe(0);
      const s = (await http().get(`${API}/admin/moderation/reports/summary`).set(bearer(moderator.token)).expect(200)).body.data;
      expect(s).toMatchObject({ open: 4, actioned: 0, dismissed: 0, today: 4, last7Days: 4 });
      expect(s.openByType).toHaveLength(4);

      const detail = (await http().get(`${API}/admin/moderation/cases/${caseId}`).set(bearer(moderator.token)).expect(200)).body.data;
      expect(detail.target).toMatchObject({ kind: 'PRODUCT_REVIEW', rating: 4, name: 'Chicken kibble', reply: 'Thank you, Ana!' });
      expect(detail.target.media).toHaveLength(1);
      expect(detail.reports[0].evidence).toHaveLength(1);
    });

    it('resolving hides the review, recomputes the rating, and records the moderator', async () => {
      await http().post(`${API}/admin/moderation/cases/${caseId}/resolve`).set(bearer(moderator.token)).send({ resolution: 'CONTENT_HIDDEN', note: 'Not about the product' }).expect(200);
      expect(await prisma.productReview.findUniqueOrThrow({ where: { id: productReviewId } })).toMatchObject({ status: 'HIDDEN' });
      expect(await prisma.product.findUniqueOrThrow({ where: { id: productId } })).toMatchObject({ ratingCount: 0 });
      const row = (await http().get(`${API}/admin/moderation/reports?status=ACTIONED`).set(bearer(moderator.token)).expect(200)).body.data[0];
      expect(row).toMatchObject({ status: 'ACTIONED', case: { status: 'RESOLVED', resolution: 'CONTENT_HIDDEN', resolutionNote: 'Not about the product', moderator: { id: moderator.id, name: 'Mo Derator' } } });

      // A hidden service review stops counting too (through moderation, not only the reviews page).
      const sr = (await http().get(`${API}/admin/moderation/reports?targetType=SERVICE_REVIEW`).set(bearer(moderator.token)).expect(200)).body.data[0];
      await http().post(`${API}/admin/moderation/cases/${sr.case.id}/resolve`).set(bearer(moderator.token)).send({ resolution: 'CONTENT_HIDDEN', note: 'Checking' }).expect(200);
      expect(await prisma.servicePartner.findUniqueOrThrow({ where: { id: partnerId } })).toMatchObject({ ratingAvg: 0, ratingCount: 0 });

      // A business isn't hidden from a case: it's suspended on its own page.
      const pr = (await http().get(`${API}/admin/moderation/reports?targetType=SERVICE_PARTNER`).set(bearer(moderator.token)).expect(200)).body.data[0];
      await http().post(`${API}/admin/moderation/cases/${pr.case.id}/resolve`).set(bearer(moderator.token)).send({ resolution: 'CONTENT_HIDDEN', note: 'Nope' }).expect(400);
      await http().post(`${API}/admin/moderation/cases/${pr.case.id}/resolve`).set(bearer(moderator.token)).send({ resolution: 'DISMISSED', note: 'Real business' }).expect(200);
      expect((await http().get(`${API}/admin/moderation/reports/summary`).set(bearer(admin.token)).expect(200)).body.data).toMatchObject({ open: 1, actioned: 2, dismissed: 1 });
    });
  });

  it('erasing an account keeps the stars but removes the words, photos and name', async () => {
    await prisma.user.update({ where: { id: ben.id }, data: { status: 'PENDING_DELETION', deletedAt: new Date() } });
    expect((await app.get(AccountEraser).erase(ben.id)).status).toBe('erased');
    const r = await prisma.productReview.findFirstOrThrow({ where: { customerId: ben.id } });
    expect(r).toMatchObject({ rating: 2, comment: null, photoIds: [] });
    const list = (await http().get(`${API}/products/${toyId}/reviews`).expect(200)).body.data;
    expect(list[0]).toMatchObject({ by: 'PetApp user', rating: 2 });
    expect((await prisma.report.findMany({ where: { reporterId: ben.id } })).every((x) => x.evidenceIds.length === 0 && x.details === null)).toBe(true);
  });
});
