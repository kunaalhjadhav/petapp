import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { SMS_PROVIDER, type SmsMessage } from '../src/providers/sms/sms.provider';
import { PUSH_PROVIDER } from '../src/providers/push/push.provider';
import { syncRbac } from '../src/modules/rbac/rbac.seed';
import { WorkerModule } from '../src/worker/worker.module';

const API = '/api/v1';
jest.setTimeout(150_000);
type User = { token: string; id: string };

// Mumbai: Bandra (partner), a customer 1 km away, Andheri ~7 km away, Thane ~20 km away.
const BANDRA = { lat: 19.0596, lng: 72.8295 };
const NEARBY = { lat: 19.0667, lng: 72.8335 };
const ANDHERI = { lat: 19.1136, lng: 72.8697 };
const THANE = { lat: 19.2183, lng: 72.9781 };

/** India calendar date N days from now. */
const indiaDate = (days: number) => new Date(Date.now() + days * 86_400_000 + 330 * 60_000).toISOString().slice(0, 10);
/** UTC ISO of HH:MM India time on an India date. */
const istAt = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`).toISOString();

describe('Services marketplace (e2e)', () => {
  let app: INestApplication;
  let worker: TestingModule;
  let prisma: PrismaService;
  let redis: RedisService;
  const inbox = new Map<string, string>();
  let admin: string;
  let dogId: string;
  let groomingId: string;
  let partner: User;
  let partnerId: string;
  let serviceId: string;
  const customers: User[] = [];
  const pets: string[] = [];
  const D = indiaDate(3);

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

  async function uploadDoc(u: User, mime: string, bytes: Buffer) {
    const r = await http().post(`${API}/media/uploads`).set(bearer(u.token)).send({ kind: 'DOCUMENT', mimeType: mime, sizeBytes: bytes.length }).expect(201);
    await fetch(r.body.data.upload.url, { method: 'PUT', headers: r.body.data.upload.headers, body: new Uint8Array(bytes) });
    return { id: r.body.data.media.id as string, complete: () => http().post(`${API}/media/${r.body.data.media.id}/complete`).set(bearer(u.token)) };
  }

  const slots = async (date = D) => (await http().get(`${API}/partner-services/${serviceId}/slots?date=${date}`).expect(200)).body.data.slots.map((s: { startsAt: string }) => s.startsAt) as string[];
  const book = (u: User, pet: string, startsAt: string, extra: Record<string, unknown> = {}) =>
    http().post(`${API}/bookings`).set(bearer(u.token)).send({ serviceId, petId: pet, startsAt, mode: 'AT_CENTER', ...extra });
  const pay = (u: User, paymentId: string) => http().post(`${API}/payments/${paymentId}/simulate`).set(bearer(u.token)).expect(200);

  async function waitFor(u: User, type: string) {
    for (let i = 0; i < 60; i++) {
      const items = (await http().get(`${API}/notifications?limit=50`).set(bearer(u.token)).expect(200)).body.data.items as Array<{ type: string; body: string; title: string }>;
      const hit = items.find((n) => n.type === type);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(`no ${type} notification`);
  }

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
    await prisma.featureFlag.create({ data: { key: 'ENABLE_SERVICES', enabled: true } });
    dogId = (await prisma.petSpecies.create({ data: { key: 'dog', name: 'Dog' } })).id;
    await new S3Client({
      endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION, forcePathStyle: true,
      credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! },
    }).send(new CreateBucketCommand({ Bucket: process.env.S3_BUCKET, CreateBucketConfiguration: { LocationConstraint: 'ap-south-1' } })).catch(() => undefined);
    const role = await prisma.role.findUniqueOrThrow({ where: { key: 'SUPER_ADMIN' } });
    await prisma.user.create({ data: { email: 'root@svc.test', passwordHash: await bcrypt.hash('Root-Password-1', 10), roles: { create: [{ roleId: role.id }] } } });
    admin = (await http().post(`${API}/admin/auth/login`).send({ email: 'root@svc.test', password: 'Root-Password-1' }).expect(200)).body.data.tokens.accessToken;
    groomingId = (await http().post(`${API}/admin/service-categories`).set(bearer(admin)).send({ key: 'grooming', name: 'Grooming', commissionBps: 1500 }).expect(201)).body.data.id;
    for (const [i, name] of ['Cust A', 'Cust B', 'Cust C'].entries()) {
      const u = await login(`+91988880000${i}`, name);
      customers.push(u);
      pets.push((await http().post(`${API}/pets`).set(bearer(u.token)).send({ name: `Pet ${i}`, speciesId: dogId }).expect(201)).body.data.id);
    }
    worker = await Test.createTestingModule({ imports: [WorkerModule] }).overrideProvider(PUSH_PROVIDER).useValue({ name: 'none', send: async () => 'sent' }).compile();
    await worker.init();
  });

  beforeEach(unthrottle);
  afterAll(async () => {
    await worker.close();
    await app.close();
  });

  it('onboards a partner: profile, a verified document, services and hours, then admin approval', async () => {
    partner = await login('+919888811111', 'Priya Groomer');
    const p = await http()
      .post(`${API}/partner/profile`)
      .set(bearer(partner.token))
      .send({ businessName: 'Pawfect Grooming', kind: 'BUSINESS', phone: '9888811111', addressLine: '12 Hill Road', area: 'Bandra West', city: 'Mumbai', state: 'Maharashtra', pincode: '400050', ...BANDRA, homeVisitRadiusKm: 5, concurrency: 1, slotStepMin: 30 })
      .expect(201);
    partnerId = p.body.data.id;
    expect(p.body.data.checklist).toEqual(['Upload an ID proof.', 'Add at least one service.', 'Set your opening hours.']);

    // A "PDF" that isn't one is rejected by its file signature.
    const fake = await uploadDoc(partner, 'application/pdf', Buffer.from('not really a pdf'));
    expect((await fake.complete().expect(400)).body.message).toMatch(/isn’t a valid PDF/);
    const doc = await uploadDoc(partner, 'application/pdf', Buffer.from('%PDF-1.4\n% ID proof\n%%EOF'));
    expect((await doc.complete().expect(200)).body.data.status).toBe('READY');
    const withDoc = await http().post(`${API}/partner/documents`).set(bearer(partner.token)).send({ kind: 'ID_PROOF', mediaId: doc.id }).expect(201);
    expect(withDoc.body.data.documents[0].url).toMatch(/uploads\/.*X-Amz-Signature/); // private, short-lived

    const early = await http().post(`${API}/partner/submit`).set(bearer(partner.token)).expect(400);
    expect(early.body.errors.map((e: { message: string }) => e.message)).toEqual(['Add at least one service.', 'Set your opening hours.']);
    const svc = await http()
      .post(`${API}/partner/services`)
      .set(bearer(partner.token))
      .send({ categoryId: groomingId, name: 'Full groom', durationMin: 60, bufferMin: 15, pricePaise: 799_00, modes: ['AT_CENTER', 'AT_HOME'], speciesIds: [dogId] })
      .expect(201);
    serviceId = svc.body.data.services[0].id;
    await http().put(`${API}/partner/hours`).set(bearer(partner.token)).send({ hours: [{ weekday: 1, opensMin: 600, closesMin: 540 }] }).expect(400);
    await http().put(`${API}/partner/hours`).set(bearer(partner.token)).send({ hours: Array.from({ length: 7 }, (_, d) => ({ weekday: d, opensMin: 9 * 60, closesMin: 18 * 60 })) }).expect(200);
    await http().post(`${API}/partner/submit`).set(bearer(partner.token)).expect(200);

    // Not visible to customers until approved.
    expect((await http().get(`${API}/services/nearby?lat=${NEARBY.lat}&lng=${NEARBY.lng}`).expect(200)).body.data).toHaveLength(0);
    const queue = await http().get(`${API}/admin/partners?status=SUBMITTED`).set(bearer(admin)).expect(200);
    expect(queue.body.data[0]).toMatchObject({ id: partnerId, businessName: 'Pawfect Grooming' });
    await http().post(`${API}/admin/partners/${partnerId}/review`).set(bearer(admin)).send({ decision: 'APPROVE' }).expect(400); // ID not accepted yet
    const docId = (await http().get(`${API}/admin/partners/${partnerId}`).set(bearer(admin)).expect(200)).body.data.documents.find((d: { kind: string }) => d.kind === 'ID_PROOF').id;
    await http().post(`${API}/admin/partners/${partnerId}/review`).set(bearer(admin)).send({ decision: 'APPROVE', documents: [{ id: docId, status: 'ACCEPTED' }] }).expect(200);
    const roles = await prisma.userRole.findMany({ where: { userId: partner.id }, include: { role: true } });
    expect(roles.map((r) => r.role.key)).toContain('SERVICE_PARTNER');
    expect((await waitFor(partner, 'PARTNER_STATUS')).title).toBe('You’re approved!');
  });

  it('finds partners nearby with PostGIS, by radius, category and mode', async () => {
    const near = await http().get(`${API}/services/nearby?lat=${NEARBY.lat}&lng=${NEARBY.lng}&categoryId=${groomingId}`).expect(200);
    expect(near.body.data[0]).toMatchObject({ id: partnerId, fromPaise: 799_00 });
    expect(near.body.data[0].distanceKm).toBeGreaterThan(0.5);
    expect(near.body.data[0].distanceKm).toBeLessThan(1.5);
    expect((await http().get(`${API}/services/nearby?lat=${ANDHERI.lat}&lng=${ANDHERI.lng}&radiusKm=3`).expect(200)).body.data).toHaveLength(0);
    expect((await http().get(`${API}/services/nearby?lat=${ANDHERI.lat}&lng=${ANDHERI.lng}&radiusKm=10&mode=AT_HOME`).expect(200)).body.data).toHaveLength(1);
    const page = (await http().get(`${API}/service-partners/${partnerId}`).expect(200)).body.data;
    expect(page.services[0]).toMatchObject({ name: 'Full groom', pricePaise: 799_00, durationMin: 60 });
    expect(page.hours).toHaveLength(7);
  });

  it('books a slot: held while unpaid, confirmed only by a verified payment, never double-booked', async () => {
    const free = await slots();
    expect(free[0]).toBe(istAt(D, '09:00'));
    // 60 min + 15 min buffer, every 30 min from 09:00, last start 17:00 → 17 starts.
    expect(free).toHaveLength(17);

    const r = await book(customers[0], pets[0], free[0]).expect(201);
    expect(r.body.data).toMatchObject({ status: 'PENDING_PAYMENT', pricePaise: 799_00, payment: { amountPaise: 799_00 } });
    expect(r.body.data.partner.phone).toBeNull(); // contact details only after payment
    expect(await slots()).not.toContain(istAt(D, '09:00'));
    expect(await slots()).not.toContain(istAt(D, '09:30')); // 09:30 would overlap 09:00–10:15
    expect((await book(customers[1], pets[1], free[0]).expect(409)).body.message).toMatch(/isn’t available any more/);

    await pay(customers[0], r.body.data.payment.paymentId);
    const after = (await http().get(`${API}/bookings/${r.body.data.id}`).set(bearer(customers[0].token)).expect(200)).body.data;
    expect(after).toMatchObject({ status: 'CONFIRMED', code: expect.stringMatching(/^PB-/) });
    expect(after.partner.phone).toBe('+919888811111');
    const forPartner = (await http().get(`${API}/partner/bookings`).set(bearer(partner.token)).expect(200)).body.data[0];
    expect(forPartner).toMatchObject({ id: r.body.data.id, customer: { name: 'Cust A', phone: '+919888800000' }, earnings: { platformFeePaise: 119_85, partnerEarningPaise: 679_15 } });
    expect((await waitFor(customers[0], 'BOOKING_CONFIRMED')).body).toMatch(/^Full groom at Pawfect Grooming on .+ Code PB-/);
    expect((await waitFor(partner, 'BOOKING_CONFIRMED')).title).toBe('New booking');
  });

  it('two customers racing for the same slot: exactly one wins', async () => {
    const target = istAt(D, '12:00');
    const results = await Promise.all([book(customers[1], pets[1], target), book(customers[2], pets[2], target)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.booking.count({ where: { startsAt: new Date(target), status: { in: ['PENDING_PAYMENT', 'CONFIRMED'] } } })).toBe(1);
  });

  it('under repeated three-way races, every round has exactly one winner and never a server error', async () => {
    // A day of its own (other tests book on days 3–6). Each booking blocks 75 minutes (60 + 15 buffer),
    // so rounds are 90 minutes apart and the last one ends before the 18:00 close.
    const D5 = indiaDate(7);
    for (const time of ['09:00', '10:30', '12:00', '13:30', '15:00', '16:30']) {
      await unthrottle(); // each round is three real bookings; the rate limit has its own tests
      const target = istAt(D5, time);
      const results = await Promise.all([0, 1, 2].map((i) => book(customers[i], pets[i], target)));
      const codes = results.map((r) => r.status).sort();
      expect(codes).toEqual([201, 409, 409]);
      expect(await prisma.booking.count({ where: { startsAt: new Date(target), status: { in: ['PENDING_PAYMENT', 'CONFIRMED'] } } })).toBe(1);
    }
  });

  it('an unpaid hold expires; paying late revives it if the slot is still free, otherwise it is refunded', async () => {
    const late = (await book(customers[1], pets[1], istAt(D, '14:00')).expect(201)).body.data;
    await prisma.booking.update({ where: { id: late.id }, data: { createdAt: new Date(Date.now() - 20 * 60_000) } });
    expect(await slots()).toContain(istAt(D, '14:00')); // released
    await pay(customers[1], late.payment.paymentId);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: late.id } })).status).toBe('CONFIRMED');

    const lost = (await book(customers[2], pets[2], istAt(D, '16:00')).expect(201)).body.data;
    await prisma.booking.update({ where: { id: lost.id }, data: { createdAt: new Date(Date.now() - 20 * 60_000) } });
    const taker = (await book(customers[0], pets[0], istAt(D, '16:00')).expect(201)).body.data; // takes the released slot
    await pay(customers[0], taker.payment.paymentId);
    await pay(customers[2], lost.payment.paymentId); // too late
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: lost.id } })).toMatchObject({ status: 'EXPIRED', refundPaise: 799_00, cancelledBy: 'SYSTEM' });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: lost.payment.paymentId } })).status).toBe('REFUND_PENDING');
  });

  it('home visits only within the partner’s travel radius; you can’t book yourself', async () => {
    const D2 = indiaDate(4);
    expect((await book(customers[0], pets[0], istAt(D2, '10:00'), { mode: 'AT_HOME', address: { line: 'Far away, Thane', ...THANE } }).expect(400)).body.message).toMatch(/^This service is unavailable at this location: .*km away; Pawfect Grooming visits within 5 km/);
    await book(customers[0], pets[0], istAt(D2, '10:00'), { mode: 'AT_HOME', address: { line: '5 Carter Road', ...NEARBY } }).expect(201);
    const own = (await http().post(`${API}/pets`).set(bearer(partner.token)).send({ name: 'Own dog', speciesId: dogId }).expect(201)).body.data.id;
    await book(partner, own, istAt(D2, '15:00')).expect(400);
  });

  it('cancellations follow the refund policy', async () => {
    const D3 = indiaDate(5);
    const early = (await book(customers[0], pets[0], istAt(D3, '09:00')).expect(201)).body.data;
    await pay(customers[0], early.payment.paymentId);
    const c1 = await http().post(`${API}/bookings/${early.id}/cancel`).set(bearer(customers[0].token)).send({}).expect(200);
    expect(c1.body.data).toMatchObject({ status: 'CANCELLED', refundPaise: 799_00 }); // > 24 h ahead
    expect((await waitFor(partner, 'BOOKING_CANCELLED')).title).toBe('Booking cancelled');

    const soon = (await book(customers[1], pets[1], istAt(D3, '11:00')).expect(201)).body.data;
    await pay(customers[1], soon.payment.paymentId);
    const start = new Date(Date.now() + 4 * 3_600_000);
    await prisma.booking.update({ where: { id: soon.id }, data: { startsAt: start, endsAt: new Date(start.getTime() + 75 * 60_000) } });
    expect((await http().post(`${API}/bookings/${soon.id}/cancel`).set(bearer(customers[1].token)).send({}).expect(200)).body.data.refundPaise).toBe(399_50); // 50%

    const byPartner = (await book(customers[2], pets[2], istAt(D3, '15:00')).expect(201)).body.data;
    await pay(customers[2], byPartner.payment.paymentId);
    await http().post(`${API}/partner/bookings/${byPartner.id}/cancel`).set(bearer(partner.token)).send({}).expect(400); // reason required
    expect((await http().post(`${API}/partner/bookings/${byPartner.id}/cancel`).set(bearer(partner.token)).send({ reason: 'Groomer unwell' }).expect(200)).body.data.refundPaise).toBe(799_00);
    expect((await waitFor(customers[2], 'BOOKING_CANCELLED')).body).toMatch(/cancelled by the partner\. ₹799 will be refunded\./);
  });

  it('completes, collects one review per booking, and keeps the rating honest', async () => {
    const D4 = indiaDate(6);
    const b = (await book(customers[2], pets[2], istAt(D4, '10:00')).expect(201)).body.data;
    await pay(customers[2], b.payment.paymentId);
    await http().post(`${API}/partner/bookings/${b.id}/complete`).set(bearer(partner.token)).expect(400); // not started
    await http().post(`${API}/bookings/${b.id}/review`).set(bearer(customers[2].token)).send({ rating: 5 }).expect(400);
    const past = new Date(Date.now() - 2 * 3_600_000);
    await prisma.booking.update({ where: { id: b.id }, data: { startsAt: past, endsAt: new Date(past.getTime() + 75 * 60_000) } });
    await http().post(`${API}/partner/bookings/${b.id}/complete`).set(bearer(partner.token)).expect(200);
    expect((await waitFor(customers[2], 'BOOKING_COMPLETED')).title).toBe('How was it?');

    await http().post(`${API}/bookings/${b.id}/review`).set(bearer(customers[2].token)).send({ rating: 4, comment: 'Lovely trim, very patient.' }).expect(201);
    await http().post(`${API}/bookings/${b.id}/review`).set(bearer(customers[2].token)).send({ rating: 1 }).expect(409);
    let page = (await http().get(`${API}/service-partners/${partnerId}`).expect(200)).body.data;
    expect(page).toMatchObject({ ratingAvg: 4, ratingCount: 1 });
    const reviewId = page.reviews[0].id;
    await http().post(`${API}/partner/reviews/${reviewId}/reply`).set(bearer(partner.token)).send({ reply: 'Thank you! See you next time.' }).expect(200);
    await http().post(`${API}/admin/service-reviews/${reviewId}/status`).set(bearer(admin)).send({ status: 'HIDDEN' }).expect(200);
    page = (await http().get(`${API}/service-partners/${partnerId}`).expect(200)).body.data;
    expect(page).toMatchObject({ ratingAvg: 0, ratingCount: 0, reviews: [] });
  });

  it('shows the partner what they have earned and what is coming, by month in India time', async () => {
    const e = (await http().get(`${API}/partner/earnings`).set(bearer(partner.token)).expect(200)).body.data;
    const done = await prisma.booking.findMany({ where: { partnerId, status: 'COMPLETED' } });
    const upcoming = await prisma.booking.findMany({ where: { partnerId, status: 'CONFIRMED', startsAt: { gt: new Date() } } });
    const sum = (rows: typeof done, k: 'pricePaise' | 'platformFeePaise' | 'partnerEarningPaise') => rows.reduce((a, b) => a + b[k], 0);
    expect(done.length).toBeGreaterThan(0);
    expect(e.completed).toEqual({ visits: done.length, grossPaise: sum(done, 'pricePaise'), platformFeesPaise: sum(done, 'platformFeePaise'), earnedPaise: sum(done, 'partnerEarningPaise') });
    expect(e.completed.grossPaise).toBe(e.completed.platformFeesPaise + e.completed.earnedPaise); // every rupee is either a fee or earnings
    expect(e.upcoming).toEqual({ visits: upcoming.length, expectedPaise: sum(upcoming, 'partnerEarningPaise') });
    const istMonth = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 7);
    const months = new Map<string, number>();
    for (const b of done) months.set(istMonth(b.startsAt), (months.get(istMonth(b.startsAt)) ?? 0) + 1);
    expect(Object.fromEntries(e.months.map((m: { month: string; visits: number }) => [m.month, m.visits]))).toEqual(Object.fromEntries(months));
    await http().get(`${API}/partner/earnings`).set(bearer(customers[0].token)).expect(404); // not a partner
  });

  it('suspension hides the partner; the feature switch hides everything', async () => {
    await http().post(`${API}/admin/partners/${partnerId}/review`).set(bearer(admin)).send({ decision: 'SUSPEND' }).expect(400); // reason
    await http().post(`${API}/admin/partners/${partnerId}/review`).set(bearer(admin)).send({ decision: 'SUSPEND', reason: 'Complaints under review' }).expect(200);
    expect((await http().get(`${API}/services/nearby?lat=${NEARBY.lat}&lng=${NEARBY.lng}`).expect(200)).body.data).toHaveLength(0);
    await http().get(`${API}/service-partners/${partnerId}`).expect(404);
    await http().post(`${API}/admin/partners/${partnerId}/review`).set(bearer(admin)).send({ decision: 'REINSTATE' }).expect(200);

    await prisma.featureFlag.update({ where: { key: 'ENABLE_SERVICES' }, data: { enabled: false } });
    await redis.client.del('platform:flags');
    await http().get(`${API}/service-categories`).expect(404);
    await prisma.featureFlag.update({ where: { key: 'ENABLE_SERVICES' }, data: { enabled: true } });
    await redis.client.del('platform:flags');
  });

  it('admins filter bookings by partner and by upcoming or past', async () => {
    const all = (await http().get(`${API}/admin/bookings?limit=100`).set(bearer(admin)).expect(200)).body;
    const mine = (await http().get(`${API}/admin/bookings?limit=100&partnerId=${partnerId}`).set(bearer(admin)).expect(200)).body;
    expect(mine.meta.total).toBeGreaterThan(0);
    expect(mine.data.every((b: { partner: { id: string } }) => b.partner.id === partnerId)).toBe(true);
    expect(mine.meta.total).toBeLessThanOrEqual(all.meta.total);
    const none = (await http().get(`${API}/admin/bookings?partnerId=00000000-0000-4000-8000-000000000000`).set(bearer(admin)).expect(200)).body;
    expect(none.meta.total).toBe(0);
    const now = Date.now();
    const up = (await http().get(`${API}/admin/bookings?when=upcoming&limit=100`).set(bearer(admin)).expect(200)).body.data as Array<{ startsAt: string }>;
    const past = (await http().get(`${API}/admin/bookings?when=past&limit=100`).set(bearer(admin)).expect(200)).body.data as Array<{ startsAt: string }>;
    expect(up.every((b) => new Date(b.startsAt).getTime() >= now - 5_000)).toBe(true);
    expect(past.every((b) => new Date(b.startsAt).getTime() < now)).toBe(true);
    expect(up.map((b) => b.startsAt)).toEqual([...up.map((b) => b.startsAt)].sort()); // soonest first
    await http().get(`${API}/admin/bookings?partnerId=not-a-uuid`).set(bearer(admin)).expect(400);
  });
});
