// Realistic OTP limits for this suite (the shared test setup relaxes them); must come before the app is imported.
import './strict-otp.env';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { SMS_PROVIDER, type SmsMessage } from '../src/providers/sms/sms.provider';
import { FakePaymentProvider } from '../src/providers/payments/payment.provider';
import { syncRbac } from '../src/modules/rbac/rbac.seed';

const API = '/api/v1';
const DAY = 86_400_000;
jest.setTimeout(120_000);
type User = { token: string; refresh: string; id: string };

/**
 * Fraud and security tests (spec §73), in one place: OTP abuse, rate-limit bypass, token abuse, admin and partner
 * access, IDOR, mass assignment, upload attacks, SQL injection, payment replay, duplicate webhooks and vote manipulation.
 * Each test attacks the API the way an outsider (or a curious customer, partner or staff member) would.
 */
describe('Security (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  const inbox = new Map<string, string>();
  let alice: User;
  let bob: User;
  let moderator: string;
  let dog: string;
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
    const u = { token: r.body.data.tokens.accessToken, refresh: r.body.data.tokens.refreshToken, id: r.body.data.user.id };
    await http().patch(`${API}/users/me`).set(bearer(u.token)).send({ name }).expect(200);
    return u;
  }
  async function staff(email: string, role: string) {
    const r = await prisma.role.findUniqueOrThrow({ where: { key: role } });
    await prisma.user.create({ data: { email, passwordHash: await bcrypt.hash('Staff-Password-1', 10), roles: { create: [{ roleId: r.id }] } } });
    await unthrottle();
    return (await http().post(`${API}/admin/auth/login`).send({ email, password: 'Staff-Password-1' }).expect(200)).body.data.tokens.accessToken as string;
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
    await prisma.featureFlag.createMany({
      data: ['ENABLE_CONTESTS', 'ENABLE_PUBLIC_VOTING', 'ENABLE_MARKETPLACE', 'ENABLE_SERVICES', 'ENABLE_REELS', 'ENABLE_AI_ASSISTANT'].map((key) => ({ key, enabled: true })),
    });
    dog = (await prisma.petSpecies.create({ data: { key: 'dog', name: 'Dog' } })).id;
    alice = await login('+919780000001', 'Alice Rao');
    bob = await login('+919780000002', 'Bob Nair');
    moderator = await staff('mod@security.test', 'MODERATOR');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('OTP abuse', () => {
    it('a code can’t be guessed: wrong guesses use up the code, after which even the right one fails', async () => {
      await unthrottle();
      const phone = '+919780000101';
      await http().post(`${API}/auth/otp/request`).send({ phone }).expect(200);
      const right = inbox.get(phone)!;
      const wrong = right === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) await http().post(`${API}/auth/otp/verify`).send({ phone, code: wrong }).expect((r) => expect([400, 401, 429]).toContain(r.status));
      await unthrottle();
      const last = await http().post(`${API}/auth/otp/verify`).send({ phone, code: right });
      expect(last.status).not.toBe(200);
    });

    it('codes per number are capped per hour, so a number can’t be SMS-bombed', async () => {
      const phone = '+919780000102';
      for (let i = 0; i < 3; i++) {
        await unthrottle();
        await http().post(`${API}/auth/otp/request`).send({ phone }).expect(200);
      }
      await unthrottle();
      const r = await http().post(`${API}/auth/otp/request`).send({ phone });
      expect(r.status).toBe(429);
    });

    it('rotating X-Forwarded-For doesn’t get round the per-IP limit (proxy headers aren’t trusted by default)', async () => {
      await unthrottle();
      const codes: number[] = [];
      for (let i = 0; i < 8; i++) {
        const r = await http().post(`${API}/auth/otp/request`).set('X-Forwarded-For', `10.0.0.${i + 1}`).send({ phone: `+91978000020${i}` });
        codes.push(r.status);
      }
      expect(codes.slice(0, 5).every((c) => c === 200)).toBe(true);
      expect(codes.slice(5).every((c) => c === 429)).toBe(true);
    });
  });

  describe('token abuse', () => {
    const jwt = new JwtService();
    const secret = () => process.env.JWT_ACCESS_SECRET!;

    it('tampered, unsigned, wrongly signed and expired tokens are refused', async () => {
      const [h, p] = alice.token.split('.');
      const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
      const bumped = Buffer.from(JSON.stringify({ ...claims, sub: bob.id })).toString('base64url');
      await http().get(`${API}/users/me`).set(bearer(`${h}.${bumped}.${alice.token.split('.')[2]}`)).expect(401);
      const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${p}.`;
      await http().get(`${API}/users/me`).set(bearer(none)).expect(401);
      const forged = await jwt.signAsync({ sub: alice.id, sid: claims.sid }, { secret: 'not-the-real-secret-0123456789abcdef', issuer: 'petapp', audience: 'petapp:app' });
      await http().get(`${API}/users/me`).set(bearer(forged)).expect(401);
      const expired = await jwt.signAsync({ sub: alice.id, sid: claims.sid, exp: Math.floor(Date.now() / 1000) - 60 }, { secret: secret(), issuer: 'petapp', audience: 'petapp:app' });
      await http().get(`${API}/users/me`).set(bearer(expired)).expect(401);
      const otherIssuer = await jwt.signAsync({ sub: alice.id, sid: claims.sid }, { secret: secret(), issuer: 'evil', audience: 'petapp:app', expiresIn: 60 });
      await http().get(`${API}/users/me`).set(bearer(otherIssuer)).expect(401);
    });

    it('after logout, the access token stops working at once and the refresh token is dead', async () => {
      const carol = await login('+919780000003', 'Carol Das');
      await http().get(`${API}/users/me`).set(bearer(carol.token)).expect(200);
      await http().post(`${API}/auth/logout`).set(bearer(carol.token)).send({ refreshToken: carol.refresh }).expect((r) => expect([200, 204]).toContain(r.status));
      await http().get(`${API}/users/me`).set(bearer(carol.token)).expect(401);
      await http().post(`${API}/auth/refresh`).send({ refreshToken: carol.refresh }).expect(401);
    });

    it('a reused (stolen) refresh token signs out every session in that chain, access tokens included', async () => {
      const dan = await login('+919780000004', 'Dan Roy');
      const next = (await http().post(`${API}/auth/refresh`).send({ refreshToken: dan.refresh }).expect(200)).body.data;
      await http().get(`${API}/users/me`).set(bearer(next.accessToken)).expect(200);
      await http().post(`${API}/auth/refresh`).send({ refreshToken: dan.refresh }).expect(401); // the thief replays the old one
      await http().get(`${API}/users/me`).set(bearer(next.accessToken)).expect(401);
      await http().post(`${API}/auth/refresh`).send({ refreshToken: next.refreshToken }).expect(401);
    });
  });

  describe('admin and staff access', () => {
    it('customers can’t use staff endpoints, and staff tokens can’t be used in the app', async () => {
      for (const path of ['/admin/users', '/admin/settings', '/admin/finance/overview', '/admin/home-sections', '/admin/assistant/status', '/admin/risk']) {
        await http().get(`${API}${path}`).set(bearer(alice.token)).expect(403);
      }
      await http().get(`${API}/users/me`).set(bearer(moderator)).expect(403);
      await http().get(`${API}/admin/users`).expect(401);
    });

    it('staff only get what their role allows', async () => {
      await http().get(`${API}/admin/users`).set(bearer(moderator)).expect(200);
      await http().get(`${API}/admin/finance/overview`).set(bearer(moderator)).expect(403);
      await http().put(`${API}/admin/settings/app.name`).set(bearer(moderator)).send({ value: 'Hacked' }).expect(403);
      await http().patch(`${API}/admin/flags/ENABLE_CONTESTS`).set(bearer(moderator)).send({ enabled: false }).expect(403);
      await http().post(`${API}/admin/home-sections`).set(bearer(moderator)).send({ kind: 'TRENDING_PETS', title: 'x' }).expect(403);
    });

    it('a customer can’t sign in to the dashboard, even with the right password', async () => {
      await prisma.user.update({ where: { id: bob.id }, data: { email: 'bob@security.test', passwordHash: await bcrypt.hash('Bob-Password-1', 10) } });
      await unthrottle();
      const r = await http().post(`${API}/admin/auth/login`).send({ email: 'bob@security.test', password: 'Bob-Password-1' });
      expect([401, 403]).toContain(r.status);
    });
  });

  describe('other people’s data (IDOR) and mass assignment', () => {
    it('one customer can’t read or change another’s pets, posts, addresses, orders, bookings or chats', async () => {
      const pet = (await http().post(`${API}/pets`).set(bearer(alice.token)).send({ name: 'Bruno', speciesId: dog }).expect(201)).body.data;
      await http().patch(`${API}/pets/${pet.id}`).set(bearer(bob.token)).send({ name: 'Mine now' }).expect((r) => expect([403, 404]).toContain(r.status));
      await http().delete(`${API}/pets/${pet.id}`).set(bearer(bob.token)).expect((r) => expect([403, 404]).toContain(r.status));
      const addr = (await http().post(`${API}/users/me/addresses`).set(bearer(alice.token)).send({ line1: '1 Road', city: 'Pune', state: 'MH', pincode: '411001' }).expect(201)).body.data;
      await http().patch(`${API}/users/me/addresses/${addr.id}`).set(bearer(bob.token)).send({ city: 'Mumbai' }).expect(404);
      await http().delete(`${API}/users/me/addresses/${addr.id}`).set(bearer(bob.token)).expect(404);
      const order = await prisma.order.create({ data: { code: 'PO-SEC1', userId: alice.id, itemsPaise: 100, discountPaise: 0, shippingPaise: 0, totalPaise: 100, shipTo: {} } });
      await http().get(`${API}/orders/${order.id}`).set(bearer(bob.token)).expect(404);
      await http().get(`${API}/orders/${order.id}`).set(bearer(alice.token)).expect(200);
      const conv = await prisma.assistantConversation.create({ data: { userId: alice.id, title: 'private' } });
      await http().get(`${API}/assistant/conversations/${conv.id}`).set(bearer(bob.token)).expect(404);
      await http().delete(`${API}/assistant/conversations/${conv.id}`).set(bearer(bob.token)).expect(404);
      expect(await prisma.pet.findUniqueOrThrow({ where: { id: pet.id } })).toMatchObject({ name: 'Bruno', deletedAt: null });
    });

    it('fields people mustn’t set are rejected, not silently ignored', async () => {
      await http().patch(`${API}/users/me`).set(bearer(alice.token)).send({ status: 'ACTIVE', roles: ['SUPER_ADMIN'] }).expect(400);
      await http().post(`${API}/pets`).set(bearer(alice.token)).send({ name: 'X', speciesId: dog, ownerId: bob.id, isVerified: true }).expect(400);
      expect((await prisma.userRole.count({ where: { userId: alice.id } }))).toBeLessThanOrEqual(1);
    });
  });

  describe('partners can only see their own work', () => {
    it('a service partner can’t see or act on another partner’s bookings; a seller can’t touch another seller’s products or orders', async () => {
      const mk = async (phone: string, name: string) => login(phone, name);
      const pa = await mk('+919780000301', 'Partner A');
      const pb = await mk('+919780000302', 'Partner B');
      const cat = await prisma.serviceCategory.create({ data: { key: 'groom', name: 'Grooming' } });
      const partnerA = await prisma.servicePartner.create({
        data: { userId: pa.id, slug: 'pa', businessName: 'A', phone: '+919800000001', addressLine: 'x', city: 'Pune', state: 'MH', pincode: '411001', lat: 18.5, lng: 73.8, status: 'APPROVED',
          services: { create: [{ categoryId: cat.id, name: 'Groom', durationMin: 30, pricePaise: 10000, modes: ['AT_CENTER'] }] } },
        include: { services: true },
      });
      await prisma.servicePartner.create({ data: { userId: pb.id, slug: 'pb', businessName: 'B', phone: '+919800000002', addressLine: 'x', city: 'Pune', state: 'MH', pincode: '411001', lat: 18.5, lng: 73.8, status: 'APPROVED' } });
      for (const u of [pa, pb]) await prisma.userRole.create({ data: { userId: u.id, roleId: (await prisma.role.findUniqueOrThrow({ where: { key: 'SERVICE_PARTNER' } })).id } }).catch(() => undefined);
      const pet = await prisma.pet.create({ data: { ownerId: alice.id, name: 'Coco', handle: 'coco-sec', speciesId: dog } });
      const at = new Date(Date.now() + 2 * DAY);
      const booking = await prisma.booking.create({
        data: { code: 'PB-SEC1', customerId: alice.id, partnerId: partnerA.id, serviceId: partnerA.services[0].id, petId: pet.id, slotIndex: 0, startsAt: at, endsAt: new Date(at.getTime() + 1_800_000), mode: 'AT_CENTER', pricePaise: 10000, commissionBps: 1500, platformFeePaise: 1500, partnerEarningPaise: 8500, status: 'CONFIRMED' },
      });
      await http().get(`${API}/partner/bookings/${booking.id}`).set(bearer(pb.token)).expect(404);
      await http().post(`${API}/partner/bookings/${booking.id}/complete`).set(bearer(pb.token)).send({}).expect(404);
      await http().get(`${API}/bookings/${booking.id}`).set(bearer(bob.token)).expect(404);
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('CONFIRMED');

      const va = await mk('+919780000303', 'Seller A');
      const vb = await mk('+919780000304', 'Seller B');
      const vendorA = await prisma.vendor.create({ data: { userId: va.id, businessName: 'VA', slug: 'va', phone: '+919800000003', addressLine: 'x', city: 'Pune', state: 'MH', pincode: '411001', status: 'APPROVED' } });
      await prisma.vendor.create({ data: { userId: vb.id, businessName: 'VB', slug: 'vb', phone: '+919800000004', addressLine: 'x', city: 'Pune', state: 'MH', pincode: '411001', status: 'APPROVED' } });
      const pcat = await prisma.productCategory.create({ data: { key: 'toys', name: 'Toys' } });
      const product = await prisma.product.create({ data: { vendorId: vendorA.id, categoryId: pcat.id, title: 'Ball', slug: 'ball-sec', description: 'x', status: 'ACTIVE' } });
      await http().patch(`${API}/vendor/products/${product.id}`).set(bearer(vb.token)).send({ title: 'Stolen' }).expect(404);
      const order = await prisma.order.create({ data: { code: 'PO-SEC2', userId: alice.id, itemsPaise: 100, discountPaise: 0, shippingPaise: 0, totalPaise: 100, shipTo: {}, status: 'PAID' } });
      const sub = await prisma.subOrder.create({ data: { orderId: order.id, vendorId: vendorA.id, code: 'PO-SEC2-1', status: 'CONFIRMED', itemsPaise: 100, discountPaise: 0, shippingPaise: 0, totalPaise: 100, commissionPaise: 10, vendorEarningPaise: 90 } });
      await http().post(`${API}/vendor/orders/${sub.id}/pack`).set(bearer(vb.token)).expect(404);
      await http().post(`${API}/vendor/orders/${sub.id}/cancel`).set(bearer(vb.token)).send({ reason: 'not mine' }).expect(404);
      expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).title).toBe('Ball');
      expect((await prisma.subOrder.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe('CONFIRMED');
    });
  });

  describe('uploads', () => {
    it('only real photo, video and document types, with honest sizes', async () => {
      const ask = (body: Record<string, unknown>) => http().post(`${API}/media/uploads`).set(bearer(alice.token)).send(body);
      for (const [kind, mimeType] of [['IMAGE', 'image/svg+xml'], ['IMAGE', 'text/html'], ['VIDEO', 'application/x-msdownload'], ['DOCUMENT', 'application/javascript'], ['IMAGE', 'image/jpeg; charset=../../etc']]) {
        expect({ mimeType, status: (await ask({ kind, mimeType, sizeBytes: 1000 })).status }).toEqual({ mimeType, status: 400 });
      }
      expect((await ask({ kind: 'IMAGE', mimeType: 'image/jpeg', sizeBytes: 10 * 1024 ** 3 })).status).toBe(400);
      expect((await ask({ kind: 'IMAGE', mimeType: 'image/jpeg', sizeBytes: -5 })).status).toBe(400);
      expect((await ask({ kind: 'IMAGE', mimeType: 'image/jpeg', sizeBytes: 1000, storageKey: '../../etc/passwd' })).status).toBe(400);
    });
  });

  describe('SQL injection', () => {
    it('search boxes and filters treat input as text; ids and numbers are validated', async () => {
      const users = await prisma.user.count();
      for (const q of ["' OR '1'='1", "'; DROP TABLE \"User\"; --", '%', '\\', "Bruno' UNION SELECT * FROM \"Session\" --"]) {
        const enc = encodeURIComponent(q);
        expect((await http().get(`${API}/products?q=${enc}`)).status).toBe(200);
        const pets = await http().get(`${API}/pets?search=${enc}`).set(bearer(alice.token));
        expect(pets.status).toBe(200);
        expect(pets.body.data.length).toBe(0); // wildcards are searched for literally, not as "anything"
        expect((await http().get(`${API}/admin/users?search=${enc}`).set(bearer(moderator))).status).toBe(200);
        expect((await http().get(`${API}/hashtags/${enc}/posts`)).status).toBeLessThan(500);
      }
      expect((await http().get(`${API}/services/nearby?lat=18.5&lng=73.8&categoryId=1%27%20OR%201=1`)).status).toBe(400);
      expect((await http().get(`${API}/home?lat=18.5;DROP&lng=73.8`)).status).toBe(400);
      expect((await http().get(`${API}/posts/1%20OR%201=1`)).status).toBe(400);
      expect(await prisma.user.count()).toBe(users);
    });
  });

  describe('payments', () => {
    it('a payment is only confirmed with a signature for that payment: no replays from other payments, no confirming someone else’s', async () => {
      const contest = await prisma.contest.create({
        data: { slug: 'sec-paid', title: 'Paid', description: 'x', status: 'LIVE', feePaise: 9900, createdById: alice.id, legalReviewApprovedAt: new Date(),
          finance: { prizePoolPct: 60, platformFeePct: 20, gatewayPct: 2, gstOnPlatformFeePct: 18, promotionPct: 4.4, refundReservePct: 5, judgeFeesPaise: 0 },
          registrationOpensAt: new Date(Date.now() - DAY), registrationClosesAt: new Date(Date.now() + 5 * DAY), submissionClosesAt: new Date(Date.now() + 6 * DAY), votingClosesAt: new Date(Date.now() + 7 * DAY) },
      });
      const pa = await prisma.pet.create({ data: { ownerId: alice.id, name: 'Rex', handle: 'rex-sec', speciesId: dog } });
      const pb = await prisma.pet.create({ data: { ownerId: bob.id, name: 'Max', handle: 'max-sec', speciesId: dog } });
      await unthrottle();
      const payA = (await http().post(`${API}/contests/${contest.id}/register`).set(bearer(alice.token)).send({ petId: pa.id }).expect(201)).body.data.payment;
      const payB = (await http().post(`${API}/contests/${contest.id}/register`).set(bearer(bob.token)).send({ petId: pb.id }).expect(201)).body.data.payment;
      const realA = FakePaymentProvider.checkout(payA.orderId, 9900);
      // Bob replays Alice's genuine gateway reply against his own payment.
      await http().post(`${API}/payments/${payB.paymentId}/verify`).set(bearer(bob.token)).send({ providerPaymentId: realA.paymentId, signature: realA.signature }).expect(400);
      // Bob tries to confirm Alice's payment.
      await http().post(`${API}/payments/${payA.paymentId}/verify`).set(bearer(bob.token)).send({ providerPaymentId: realA.paymentId, signature: realA.signature }).expect(404);
      // Alice's genuine reply works, and sending it again changes nothing.
      expect((await http().post(`${API}/payments/${payA.paymentId}/verify`).set(bearer(alice.token)).send({ providerPaymentId: realA.paymentId, signature: realA.signature }).expect(200)).body.data.status).toBe('CAPTURED');
      expect((await http().post(`${API}/payments/${payA.paymentId}/verify`).set(bearer(alice.token)).send({ providerPaymentId: realA.paymentId, signature: realA.signature }).expect(200)).body.data.status).toBe('CAPTURED');
      expect(await prisma.payment.findUniqueOrThrow({ where: { id: payB.paymentId } })).toMatchObject({ status: 'CREATED', providerPaymentId: null });
      expect(await prisma.contestParticipant.count({ where: { contestId: contest.id, status: 'REGISTERED' } })).toBe(1);
      expect(await prisma.ledgerTransaction.count({ where: { kind: 'PAYMENT_CAPTURED', sourceId: payA.paymentId } })).toBe(1); // booked once

      // Webhooks: forged signature refused; a genuine one sent twice is handled once.
      const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_sec_dup', order_id: payA.orderId, amount: 9900, status: 'captured' } } } });
      const send = (sig: string, id: string) =>
        http().post(`${API}/webhooks/payments`).set('Content-Type', 'application/json').set('x-razorpay-event-id', id).set('x-razorpay-signature', sig).send(body);
      await send('ab'.repeat(32), 'evt_sec_forged').expect(400);
      expect((await send(FakePaymentProvider.signWebhook(body), 'evt_sec_1').expect(200)).body.data.status).not.toBe('duplicate');
      expect((await send(FakePaymentProvider.signWebhook(body), 'evt_sec_1').expect(200)).body.data.status).toBe('duplicate');
      expect(await prisma.paymentWebhookEvent.count({ where: { eventId: 'evt_sec_1' } })).toBe(1);
    });
  });

  describe('contest votes', () => {
    it('voting fast from many requests at once still counts only the daily allowance; no voting for yourself', async () => {
      const voters = [alice, bob];
      const contest = await prisma.contest.create({
        data: { slug: 'sec-vote', title: 'Vote', description: 'x', status: 'VOTING', createdById: alice.id, votesPerUserPerDay: 1, publicWeight: 50,
          registrationOpensAt: new Date(Date.now() - 5 * DAY), registrationClosesAt: new Date(Date.now() - 3 * DAY), submissionClosesAt: new Date(Date.now() - 2 * DAY), votingClosesAt: new Date(Date.now() + 2 * DAY) },
      });
      const entries = [];
      for (let i = 0; i < 4; i++) {
        const owner = await login(`+91978000040${i}`, `Owner ${i}`);
        const pet = await prisma.pet.create({ data: { ownerId: owner.id, name: `P${i}`, handle: `p-sec-${i}`, speciesId: dog } });
        entries.push(await prisma.contestParticipant.create({ data: { contestId: contest.id, userId: owner.id, petId: pet.id, status: 'SUBMITTED', registeredAt: new Date() } }));
      }
      const own = await prisma.contestParticipant.create({ data: { contestId: contest.id, userId: alice.id, petId: (await prisma.pet.create({ data: { ownerId: alice.id, name: 'Self', handle: 'self-sec', speciesId: dog } })).id, status: 'SUBMITTED', registeredAt: new Date() } });
      await unthrottle();
      expect((await http().post(`${API}/contest-entries/${own.id}/vote`).set(bearer(alice.token))).status).toBe(400);
      for (const v of voters) {
        await unthrottle();
        const results = await Promise.all(entries.map((e) => http().post(`${API}/contest-entries/${e.id}/vote`).set(bearer(v.token))));
        expect(results.filter((r) => r.status < 300)).toHaveLength(1);
        expect(results.every((r) => r.status < 500)).toBe(true);
        expect(await prisma.contestVote.count({ where: { voterId: v.id, participant: { contestId: contest.id } } })).toBe(1);
      }
      await http().post(`${API}/contest-entries/${entries[0].id}/vote`).set(bearer(moderator)).expect(403);
    });
  });
});
