import { Test, type TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import * as bcrypt from 'bcryptjs';
import { readFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { WebSocket } from 'ws';
import { AppModule } from '../src/app.module';
import { WorkerModule } from '../src/worker/worker.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { SMS_PROVIDER, type SmsMessage } from '../src/providers/sms/sms.provider';
import { PUSH_PROVIDER, type PushMessage } from '../src/providers/push/push.provider';
import { SupportAutoClose } from '../src/modules/chat/support-autoclose';
import { AccountEraser } from '../src/modules/privacy/account-eraser';
import { syncRbac } from '../src/modules/rbac/rbac.seed';
import { SUPPORT_CATEGORIES } from '../src/modules/chat/support.defaults';

const API = '/api/v1';
const PHOTO = readFileSync(join(__dirname, 'fixtures', 'photo-gps.jpg'));
jest.setTimeout(180_000);
type User = { token: string; id: string; phone: string };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Chat and support (e2e)', () => {
  let app: NestExpressApplication;
  let worker: TestingModule;
  let prisma: PrismaService;
  let redis: RedisService;
  let port: number;
  const inbox = new Map<string, string>();
  const pushes: PushMessage[] = [];
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
  async function privatePhoto(token: string, isPrivate = true) {
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
  /** Opens the live connection and collects what arrives. */
  async function live(token: string) {
    const t = await http().post(`${API}/chat/realtime-ticket`).set(bearer(token)).expect(200);
    const ws = new WebSocket(`ws://127.0.0.1:${port}${t.body.data.path}?ticket=${t.body.data.ticket}`);
    const events: Array<Record<string, unknown>> = [];
    ws.on('message', (d) => events.push(JSON.parse(d.toString())));
    await new Promise<void>((res, rej) => (ws.once('open', () => res()), ws.once('error', rej)));
    const waitFor = async (pred: (e: Record<string, unknown>) => boolean) => {
      for (let i = 0; i < 100; i++) {
        const hit = events.find(pred);
        if (hit) return hit;
        await sleep(50);
      }
      throw new Error(`no matching event; got ${JSON.stringify(events)}`);
    };
    return { ws, events, waitFor, ticket: t.body.data.ticket as string };
  }
  const openWith = (token: string, ticket: string) =>
    new Promise<number>((res) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/api/v1/chat/ws?ticket=${ticket}`);
      ws.on('unexpected-response', (_req, r) => res(r.statusCode ?? 0));
      ws.on('open', () => (ws.close(), res(101)));
      ws.on('error', () => undefined);
    });

  let ana: User; // customer
  let ben: User; // another customer
  let pia: User; // service partner owner
  let vik: User; // seller
  let admin: { token: string; id: string };
  let agent: { token: string; id: string };
  let moderator: { token: string; id: string };
  let partnerId: string;
  let productId: string;
  let otherProductId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_PROVIDER)
      .useValue({ name: 'capture', send: async (m: SmsMessage) => (inbox.set(m.to, m.body.match(/\d{6}/)![0]), {}) })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, rawBody: true });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as { port: number }).port;
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    await redis.client.flushdb();
    const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' AND tablename <> 'spatial_ref_sys'`;
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
    await syncRbac(prisma);
    for (const k of ['ENABLE_SERVICES', 'ENABLE_MARKETPLACE']) await flag(k, true);
    for (const c of SUPPORT_CATEGORIES) await prisma.supportCategory.create({ data: c });
    await new S3Client({ region: process.env.S3_REGION, endpoint: process.env.S3_ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! } })
      .send(new CreateBucketCommand({ Bucket: process.env.S3_BUCKET })).catch(() => undefined);

    ana = await login('+919800000101', 'Ana Rao');
    ben = await login('+919800000102', 'Ben Das');
    pia = await login('+919800000103', 'Pia Groomer');
    vik = await login('+919800000104', 'Vik Seller');
    admin = await staff('root@chat.test', 'SUPER_ADMIN', 'Root Admin');
    agent = await staff('agent@chat.test', 'SUPPORT_AGENT', 'Sana Iyer');
    moderator = await staff('mod@chat.test', 'MODERATOR', 'Mo Derator');

    partnerId = (await prisma.servicePartner.create({
      data: { userId: pia.id, slug: 'pia-grooming', businessName: 'Pia Grooming', phone: pia.phone, addressLine: '1 MG Road', city: 'Pune', state: 'Maharashtra', pincode: '411001', lat: 18.52, lng: 73.85, status: 'APPROVED' },
    })).id;
    const vendor = await prisma.vendor.create({ data: { userId: vik.id, slug: 'vik-pets', businessName: 'Vik Pet Supplies', phone: vik.phone, addressLine: '2 FC Road', city: 'Pune', state: 'Maharashtra', pincode: '411004', status: 'APPROVED' } });
    const cat = await prisma.productCategory.create({ data: { key: 'food', name: 'Food' } });
    productId = (await prisma.product.create({ data: { vendorId: vendor.id, categoryId: cat.id, title: 'Chicken kibble 3 kg', slug: 'chicken-kibble-3kg', description: 'Dry food', status: 'ACTIVE', variants: { create: [{ sku: 'K3', title: '3 kg', mrpPaise: 99900, pricePaise: 89900, stock: 5 }] } } })).id;
    const other = await prisma.vendor.create({ data: { userId: ben.id, slug: 'ben-shop', businessName: 'Ben Shop', phone: ben.phone, addressLine: '3 Lane', city: 'Pune', state: 'Maharashtra', pincode: '411002', status: 'APPROVED' } });
    otherProductId = (await prisma.product.create({ data: { vendorId: other.id, categoryId: cat.id, title: 'Rope toy', slug: 'rope-toy', description: 'Toy', status: 'ACTIVE' } })).id;

    worker = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(PUSH_PROVIDER)
      .useValue({ name: 'capture', send: async (m: PushMessage) => (pushes.push(m), 'sent') })
      .compile();
    await worker.init();
  });

  afterAll(async () => {
    await worker?.close();
    await app?.close();
  });

  beforeEach(unthrottle);

  describe('chat', () => {
    let conv: string;

    it('is off until ENABLE_CHAT is switched on', async () => {
      await http().post(`${API}/chat/conversations`).set(bearer(ana.token)).send({ partnerId }).expect(404);
      expect((await http().get(`${API}/chat/conversations?as=customer`).set(bearer(ana.token)).expect(200)).body.data.items).toEqual([]);
      await flag('ENABLE_CHAT', true);
    });

    it('starts one conversation per customer and partner, visible only to them', async () => {
      const a = await http().post(`${API}/chat/conversations`).set(bearer(ana.token)).send({ partnerId }).expect(200);
      const again = await http().post(`${API}/chat/conversations`).set(bearer(ana.token)).send({ partnerId }).expect(200);
      conv = a.body.data.conversation.id;
      expect(again.body.data.conversation.id).toBe(conv);
      expect(a.body.data.conversation).toMatchObject({ kind: 'SERVICE', side: 'CUSTOMER', canSend: true, counterpart: { type: 'PARTNER', name: 'Pia Grooming' } });
      // Nothing in the lists until someone writes.
      expect((await http().get(`${API}/chat/conversations?as=partner`).set(bearer(pia.token)).expect(200)).body.data.items).toHaveLength(0);
      // Nobody else can read or write it, and ids can't be probed.
      await http().get(`${API}/chat/conversations/${conv}`).set(bearer(ben.token)).expect(404);
      await http().get(`${API}/chat/conversations/${conv}/messages`).set(bearer(ben.token)).expect(404);
      await http().post(`${API}/chat/conversations/${conv}/messages`).set(bearer(ben.token)).send({ body: 'hi' }).expect(404);
      // Staff tokens can't use app endpoints.
      await http().get(`${API}/chat/conversations/${conv}`).set(bearer(admin.token)).expect(403);
      // Not with yourself, nor with businesses that aren't approved.
      await http().post(`${API}/chat/conversations`).set(bearer(pia.token)).send({ partnerId }).expect(400);
      await http().post(`${API}/chat/conversations`).set(bearer(ana.token)).send({}).expect(400);
    });

    it('sends, de-duplicates retries, counts unread and marks read', async () => {
      const s1 = await http().post(`${API}/chat/conversations/${conv}/messages`).set(bearer(ana.token)).send({ clientId: 'ana-msg-0001', body: '  Is Saturday 10am free?  ' }).expect(201);
      const retry = await http().post(`${API}/chat/conversations/${conv}/messages`).set(bearer(ana.token)).send({ clientId: 'ana-msg-0001', body: 'Is Saturday 10am free?' }).expect(201);
      expect(retry.body.data.id).toBe(s1.body.data.id);
      expect(s1.body.data).toMatchObject({ body: 'Is Saturday 10am free?', mine: true, side: 'CUSTOMER', removed: false });
      await http().post(`${API}/chat/conversations/${conv}/messages`).set(bearer(ana.token)).send({}).expect(400);

      const inboxP = (await http().get(`${API}/chat/conversations?as=partner`).set(bearer(pia.token)).expect(200)).body.data.items;
      expect(inboxP).toHaveLength(1);
      expect(inboxP[0]).toMatchObject({ id: conv, unread: 1, lastMessageText: 'Is Saturday 10am free?', counterpart: { type: 'CUSTOMER', name: 'Ana Rao' } });
      expect((await http().get(`${API}/chat/unread`).set(bearer(pia.token)).expect(200)).body.data).toMatchObject({ partner: 1, customer: 0 });

      await http().post(`${API}/chat/conversations/${conv}/messages`).set(bearer(pia.token)).send({ body: 'Yes! See you then.' }).expect(201);
      expect((await http().get(`${API}/chat/unread`).set(bearer(ana.token)).expect(200)).body.data.customer).toBe(1);
      await http().post(`${API}/chat/conversations/${conv}/read`).set(bearer(ana.token)).expect(200);
      expect((await http().get(`${API}/chat/unread`).set(bearer(ana.token)).expect(200)).body.data.customer).toBe(0);
      const header = (await http().get(`${API}/chat/conversations/${conv}`).set(bearer(pia.token)).expect(200)).body.data;
      expect(header.otherReadAt).not.toBeNull();

      const page = (await http().get(`${API}/chat/conversations/${conv}/messages?limit=1`).set(bearer(ana.token)).expect(200)).body.data;
      expect(page.items[0]).toMatchObject({ body: 'Yes! See you then.', mine: false, side: 'BUSINESS' });
      const older = (await http().get(`${API}/chat/conversations/${conv}/messages?before=${page.nextCursor}`).set(bearer(ana.token)).expect(200)).body.data;
      expect(older.items[0].body).toBe('Is Saturday 10am free?');
    });

    it('shares only cards that belong to the conversation', async () => {
      await http().post(`${API}/chat/conversations/${conv}/messages`).set(bearer(ana.token)).send({ refType: 'BOOKING', refId: '00000000-0000-4000-8000-000000000000' }).expect(404);
      await http().post(`${API}/chat/conversations/${conv}/messages`).set(bearer(ana.token)).send({ refType: 'PRODUCT', refId: productId }).expect(404);

      const shop = await http().post(`${API}/chat/conversations`).set(bearer(ana.token)).send({ productId }).expect(200);
      expect(shop.body.data.context).toEqual({ refType: 'PRODUCT', refId: productId });
      const id = shop.body.data.conversation.id;
      const m = await http().post(`${API}/chat/conversations/${id}/messages`).set(bearer(ana.token)).send({ body: 'Is this grain-free?', refType: 'PRODUCT', refId: productId }).expect(201);
      expect(m.body.data.ref).toMatchObject({ type: 'PRODUCT', title: 'Chicken kibble 3 kg', pricePaise: 89900, available: true });
      // Another seller's product can't be dropped into this conversation.
      await http().post(`${API}/chat/conversations/${id}/messages`).set(bearer(ana.token)).send({ refType: 'PRODUCT', refId: otherProductId }).expect(404);
      expect((await http().get(`${API}/chat/conversations?as=seller`).set(bearer(vik.token)).expect(200)).body.data.items[0]).toMatchObject({ kind: 'SHOP', unread: 1 });
    });

    it('sends private photos only, with short-lived signed links', async () => {
      const pub = await privatePhoto(ana.token, false).catch(() => null);
      if (pub) await http().post(`${API}/chat/conversations/${conv}/messages`).set(bearer(ana.token)).send({ mediaId: pub }).expect(400);
      const mine = await privatePhoto(ana.token);
      const m = await http().post(`${API}/chat/conversations/${conv}/messages`).set(bearer(ana.token)).send({ mediaId: mine }).expect(201);
      const url: string = m.body.data.media.images[0].url;
      expect(url).toContain('/private/');
      expect(url).toMatch(/X-Amz-Signature=/);
      // Someone else's photo can't be attached.
      await http().post(`${API}/chat/conversations/${conv}/messages`).set(bearer(pia.token)).send({ mediaId: mine }).expect(404);
      expect((await http().get(`${API}/chat/conversations?as=partner`).set(bearer(pia.token)).expect(200)).body.data.items[0].lastMessageText).toBe('Photo');
    });

    it('delivers live over the WebSocket, with typing, and only with a fresh ticket', async () => {
      const p = await live(pia.token);
      await p.waitFor((e) => e.type === 'hello');
      expect(await openWith(pia.token, p.ticket)).toBe(401); // tickets are single-use
      expect(await openWith(pia.token, 'not-a-real-ticket-at-all-000')).toBe(401);
      const b = await live(ben.token);

      const a = await live(ana.token);
      a.ws.send(JSON.stringify({ type: 'typing', conversationId: conv }));
      await p.waitFor((e) => e.type === 'typing' && e.conversationId === conv && e.side === 'CUSTOMER');
      await http().post(`${API}/chat/conversations/${conv}/messages`).set(bearer(ana.token)).send({ body: 'On my way' }).expect(201);
      const ev = await p.waitFor((e) => e.type === 'message');
      expect(ev).toMatchObject({ conversationId: conv, message: { body: 'On my way', side: 'CUSTOMER' } });
      // Typing in someone else's conversation is ignored, and outsiders hear nothing.
      b.ws.send(JSON.stringify({ type: 'typing', conversationId: conv }));
      await sleep(300);
      expect(b.events.filter((e) => e.type !== 'hello')).toEqual([]);
      expect(a.events.filter((e) => e.type === 'typing')).toEqual([]);
      a.ws.send(JSON.stringify({ type: 'ping' }));
      await a.waitFor((e) => e.type === 'pong');
      for (const s of [a, b, p]) s.ws.close();
    });

    it('pushes to people who are away, once per burst, and not to people in the app', async () => {
      await http().post(`${API}/devices`).set(bearer(pia.token)).send({ token: 'device-pia-00000000000000000000', platform: 'ANDROID' }).expect((r) => expect([200, 201]).toContain(r.status));
      await sleep(300); // the closed sockets above clear presence
      await redis.client.del(`chat:online:${pia.id}`);
      await sleep(1500); // let pushes for earlier messages finish
      pushes.length = 0;
      await http().post(`${API}/chat/conversations/${conv}/messages`).set(bearer(ana.token)).send({ body: 'Running 5 min late' }).expect(201);
      await http().post(`${API}/chat/conversations/${conv}/messages`).set(bearer(ana.token)).send({ body: 'Sorry!' }).expect(201);
      for (let i = 0; i < 60 && pushes.length < 1; i++) await sleep(100);
      await sleep(500);
      expect(pushes).toHaveLength(1);
      expect(pushes[0]).toMatchObject({ title: 'Ana Rao', body: 'Running 5 min late', data: { type: 'CHAT_MESSAGE', entityId: conv, app: 'partner' } });

      const p = await live(pia.token);
      await p.waitFor((e) => e.type === 'hello');
      await redis.client.del(`chat:pushed:${pia.id}:${conv}`);
      pushes.length = 0;
      await http().post(`${API}/chat/conversations/${conv}/messages`).set(bearer(ana.token)).send({ body: 'Here now' }).expect(201);
      await p.waitFor((e) => e.type === 'message');
      await sleep(800);
      expect(pushes).toHaveLength(0);
      p.ws.close();
    });

    it('limits bursts of messages', async () => {
      await setting('chat.maxMessagesPerMinute', 2);
      const id = (await http().post(`${API}/chat/conversations`).set(bearer(ben.token)).send({ partnerId }).expect(200)).body.data.conversation.id;
      await http().post(`${API}/chat/conversations/${id}/messages`).set(bearer(ben.token)).send({ body: 'one' }).expect(201);
      await http().post(`${API}/chat/conversations/${id}/messages`).set(bearer(ben.token)).send({ body: 'two' }).expect(201);
      await http().post(`${API}/chat/conversations/${id}/messages`).set(bearer(ben.token)).send({ body: 'three' }).expect(429);
      await setting('chat.maxMessagesPerMinute', 20);
    });

    it('blocks from the conversation, both ways', async () => {
      const h = (await http().post(`${API}/chat/conversations/${conv}/block`).set(bearer(ana.token)).expect(200)).body.data;
      expect(h).toMatchObject({ blockedByMe: true, canSend: false });
      await http().post(`${API}/chat/conversations/${conv}/messages`).set(bearer(ana.token)).send({ body: 'x' }).expect(403);
      const forPia = await http().post(`${API}/chat/conversations/${conv}/messages`).set(bearer(pia.token)).send({ body: 'hello?' }).expect(403);
      expect(forPia.body.message).toMatch(/can’t reply/);
      await http().post(`${API}/chat/conversations`).set(bearer(ana.token)).send({ partnerId }).expect(403);
      await http().post(`${API}/chat/conversations/${conv}/unblock`).set(bearer(ana.token)).expect(200);
      await http().post(`${API}/chat/conversations/${conv}/messages`).set(bearer(pia.token)).send({ body: 'All good?' }).expect(201);
    });

    it('lets people in the conversation report a message, and moderators act on it', async () => {
      const bad = await http().post(`${API}/chat/conversations/${conv}/messages`).set(bearer(pia.token)).send({ body: 'Pay me directly on this UPI to skip fees' }).expect(201);
      await http().post(`${API}/reports`).set(bearer(ben.token)).send({ targetType: 'CHAT_MESSAGE', targetId: bad.body.data.id, reason: 'SPAM' }).expect(404);
      await http().post(`${API}/reports`).set(bearer(pia.token)).send({ targetType: 'CHAT_MESSAGE', targetId: bad.body.data.id, reason: 'SPAM' }).expect(400);
      await http().post(`${API}/reports`).set(bearer(ana.token)).send({ targetType: 'CHAT_MESSAGE', targetId: bad.body.data.id, reason: 'SPAM', details: 'Asking to pay outside the app' }).expect(201);

      const cases = (await http().get(`${API}/admin/moderation/cases?targetType=CHAT_MESSAGE`).set(bearer(moderator.token)).expect(200)).body.data;
      const kase = cases.find((c: { targetId: string }) => c.targetId === bad.body.data.id);
      const detail = (await http().get(`${API}/admin/moderation/cases/${kase.id}`).set(bearer(moderator.token)).expect(200)).body.data;
      expect(detail.target).toMatchObject({ kind: 'CHAT_MESSAGE', body: 'Pay me directly on this UPI to skip fees', conversation: { kind: 'SERVICE', business: 'Pia Grooming' } });
      expect(detail.target.context.length).toBeGreaterThan(2);
      await http().post(`${API}/admin/moderation/cases/${kase.id}/resolve`).set(bearer(moderator.token)).send({ resolution: 'CONTENT_REMOVED', note: 'Off-platform payment' }).expect(200);

      const page = (await http().get(`${API}/chat/conversations/${conv}/messages?limit=5`).set(bearer(ana.token)).expect(200)).body.data.items;
      expect(page.find((m: { id: string }) => m.id === bad.body.data.id)).toMatchObject({ body: null, removed: true });
    });
  });

  describe('support', () => {
    let ticket: { id: string; code: string; conversationId: string };
    const cat = (key: string) => prisma.supportCategory.findUniqueOrThrow({ where: { key } }).then((c) => c.id);

    it('shows published FAQs and topics for each app, without signing in', async () => {
      const account = await cat('account');
      await prisma.supportFaq.createMany({
        data: [
          { question: 'How do I delete my account?', answer: 'Settings → Your data and privacy.', categoryId: account, published: true },
          { question: 'Draft question not yet live', answer: 'Hidden', published: false },
          { question: 'When are payouts sent?', answer: 'Weekly.', audience: 'PARTNER', published: true },
        ],
      });
      const c = (await http().get(`${API}/support/faqs?app=customer`).expect(200)).body.data;
      expect(c.faqs.map((f: { question: string }) => f.question)).toEqual(['How do I delete my account?']);
      expect(c.categories.map((x: { key: string }) => x.key)).toContain('orders');
      expect(c.categories.map((x: { key: string }) => x.key)).not.toContain('seller-shop');
      const p = (await http().get(`${API}/support/faqs?app=partner&q=payout`).expect(200)).body.data;
      expect(p.faqs.map((f: { question: string }) => f.question)).toEqual(['When are payouts sent?']);
      await http().get(`${API}/support/faqs?app=hacker`).expect(400);
      expect((await http().get(`${API}/support/faqs?app=customer&q=%25`).expect(200)).body.data.faqs).toEqual([]);
      const id = c.faqs[0].id;
      await http().post(`${API}/support/faqs/${id}/feedback`).send({ helpful: true }).expect(200);
      await http().post(`${API}/support/faqs/${id}/feedback`).send({ helpful: true }).expect(200);
      expect((await prisma.supportFaq.findUniqueOrThrow({ where: { id } })).helpful).toBe(1);
    });

    it('opens a ticket with attachments, from the right app only', async () => {
      const photo = await privatePhoto(ana.token);
      await http().post(`${API}/support/tickets`).set(bearer(ana.token)).send({ app: 'partner', categoryId: await cat('account'), subject: 'Help', body: 'x' }).expect(403);
      await http().post(`${API}/support/tickets`).set(bearer(ana.token)).send({ app: 'customer', categoryId: await cat('seller-shop'), subject: 'Help', body: 'x' }).expect(400);
      const r = await http().post(`${API}/support/tickets`).set(bearer(ana.token)).send({ app: 'customer', categoryId: await cat('payments'), subject: 'Refund not received', body: 'My refund for last week is missing.', mediaIds: [photo] }).expect(201);
      ticket = r.body.data;
      expect(r.body.message).toContain(ticket.code);
      expect(ticket).toMatchObject({ status: 'OPEN', canReply: true, category: 'Payments and refunds' });
      const msgs = (await http().get(`${API}/chat/conversations/${ticket.conversationId}/messages`).set(bearer(ana.token)).expect(200)).body.data.items;
      expect(msgs).toHaveLength(2);
      expect(msgs[0].media.images[0].url).toContain('/private/');
      // Support threads aren't in the chat inbox, and aren't someone else's to read.
      expect((await http().get(`${API}/chat/conversations?as=customer`).set(bearer(ana.token)).expect(200)).body.data.items.map((c: { id: string }) => c.id)).not.toContain(ticket.conversationId);
      await http().get(`${API}/support/tickets/${ticket.id}`).set(bearer(ben.token)).expect(404);
      await http().get(`${API}/chat/conversations/${ticket.conversationId}/messages`).set(bearer(ben.token)).expect(404);
    });

    it('needs support permissions in the dashboard', async () => {
      await http().get(`${API}/admin/support/tickets`).set(bearer(moderator.token)).expect(403);
      const list = (await http().get(`${API}/admin/support/tickets`).set(bearer(agent.token)).expect(200)).body;
      expect(list.data[0]).toMatchObject({ code: ticket.code, status: 'OPEN', unread: 2, user: { name: 'Ana Rao' } });
      expect((await http().get(`${API}/admin/support/tickets?q=${ticket.code.toLowerCase()}`).set(bearer(agent.token)).expect(200)).body.data).toHaveLength(1);
      expect((await http().get(`${API}/admin/support/summary`).set(bearer(agent.token)).expect(200)).body.data).toMatchObject({ open: 1, unassigned: 1, needsReply: 1 });
    });

    it('keeps staff notes from the person, and moves the ticket along as staff reply', async () => {
      const a = await live(ana.token);
      const d = (await http().get(`${API}/admin/support/tickets/${ticket.id}`).set(bearer(agent.token)).expect(200)).body.data;
      expect(d.unread).toBe(2);
      await a.waitFor((e) => e.type === 'read' && e.side === 'STAFF');

      await http().post(`${API}/admin/support/tickets/${ticket.id}/messages`).set(bearer(agent.token)).send({ body: 'Checked Razorpay: refund rfnd_123 processed.', internal: true }).expect(201);
      const after = (await http().post(`${API}/admin/support/tickets/${ticket.id}/messages`).set(bearer(agent.token)).send({ body: 'Your refund was sent on Monday; it should arrive within 5 working days.' }).expect(201)).body.data;
      expect(after).toMatchObject({ status: 'IN_PROGRESS', assignee: { id: agent.id } });
      expect(after.firstResponseAt).not.toBeNull();
      const ev = await a.waitFor((e) => e.type === 'message');
      expect(ev).toMatchObject({ message: { side: 'STAFF', senderName: 'Sana' } });

      const mine = (await http().get(`${API}/chat/conversations/${ticket.conversationId}/messages`).set(bearer(ana.token)).expect(200)).body.data.items;
      expect(mine.map((m: { body: string }) => m.body)).not.toContain('Checked Razorpay: refund rfnd_123 processed.');
      const staffView = (await http().get(`${API}/admin/support/tickets/${ticket.id}/messages`).set(bearer(agent.token)).expect(200)).body.data.items;
      expect(staffView.find((m: { internal?: boolean }) => m.internal)).toBeTruthy();
      // The person hears about the reply (the note is never mentioned).
      for (let i = 0; i < 50; i++) {
        if (await prisma.notification.count({ where: { userId: ana.id, type: 'SUPPORT_UPDATE' } })) break;
        await sleep(100);
      }
      const n = (await http().get(`${API}/notifications`).set(bearer(ana.token)).expect(200)).body.data.items.filter((x: { type: string }) => x.type === 'SUPPORT_UPDATE');
      expect(n).toHaveLength(1);
      expect(n[0].body).toContain('Your refund was sent on Monday');
      a.ws.close();
    });

    it('waits for the person, reopens when they answer, and closes resolved tickets after a while', async () => {
      await http().patch(`${API}/admin/support/tickets/${ticket.id}`).set(bearer(agent.token)).send({ status: 'WAITING' }).expect(200);
      await http().patch(`${API}/admin/support/tickets/${ticket.id}`).set(bearer(moderator.token)).send({ status: 'RESOLVED' }).expect(403);
      expect((await http().get(`${API}/support/tickets/${ticket.id}`).set(bearer(ana.token)).expect(200)).body.data).toMatchObject({ status: 'WAITING', statusLabel: 'Waiting for your reply' });
      await http().post(`${API}/chat/conversations/${ticket.conversationId}/messages`).set(bearer(ana.token)).send({ body: 'Got it, thanks. It arrived.' }).expect(201);
      expect((await http().get(`${API}/support/tickets/${ticket.id}`).set(bearer(ana.token)).expect(200)).body.data.status).toBe('IN_PROGRESS');

      await http().patch(`${API}/admin/support/tickets/${ticket.id}`).set(bearer(agent.token)).send({ status: 'OPEN' }).expect(400);
      await http().patch(`${API}/admin/support/tickets/${ticket.id}`).set(bearer(agent.token)).send({ status: 'RESOLVED', priority: 'LOW' }).expect(200);
      await prisma.supportTicket.update({ where: { id: ticket.id }, data: { resolvedAt: new Date(Date.now() - 8 * 86_400_000) } });
      expect(await worker.get(SupportAutoClose).sweep()).toBe(1);
      const t = (await http().get(`${API}/support/tickets/${ticket.id}`).set(bearer(ana.token)).expect(200)).body.data;
      expect(t).toMatchObject({ status: 'CLOSED', canReply: false });
      await http().post(`${API}/chat/conversations/${ticket.conversationId}/messages`).set(bearer(ana.token)).send({ body: 'one more thing' }).expect(403);
      await http().post(`${API}/admin/support/tickets/${ticket.id}/messages`).set(bearer(agent.token)).send({ body: 'x' }).expect(409);
      const last = (await http().get(`${API}/chat/conversations/${ticket.conversationId}/messages?limit=1`).set(bearer(ana.token)).expect(200)).body.data.items[0];
      expect(last).toMatchObject({ side: 'SYSTEM' });
      expect(last.body).toMatch(/closed after 7 days/);
    });

    it('lets staff start a conversation with someone, and works with chat switched off', async () => {
      await flag('ENABLE_CHAT', false);
      const d = (await http().post(`${API}/admin/support/tickets`).set(bearer(agent.token)).send({ userId: ben.id, categoryId: await cat('safety'), subject: 'About your recent report', body: 'Thanks for reporting. Can you tell us more?' }).expect(201)).body.data;
      expect(d).toMatchObject({ status: 'IN_PROGRESS', app: 'STAFF' });
      const mine = (await http().get(`${API}/support/tickets?app=customer`).set(bearer(ben.token)).expect(200)).body.data;
      expect(mine[0]).toMatchObject({ subject: 'About your recent report', unread: 1 });
      expect((await http().get(`${API}/chat/unread`).set(bearer(ben.token)).expect(200)).body.data).toMatchObject({ support: 1, customer: 0 });
      await http().post(`${API}/chat/conversations/${mine[0].conversationId}/messages`).set(bearer(ben.token)).send({ body: 'Sure, it was a fake seller.' }).expect(201);
      // Chat between people stays off.
      await http().post(`${API}/chat/conversations`).set(bearer(ben.token)).send({ partnerId }).expect(404);
      await http().post(`${API}/support/tickets/${mine[0].id}/close`).set(bearer(ben.token)).expect(200);
      await flag('ENABLE_CHAT', true);
    });

    it('limits open tickets per person', async () => {
      await setting('support.maxOpenTickets', 1);
      const body = { app: 'customer', categoryId: await cat('other'), subject: 'Question one', body: 'Hello' };
      await http().post(`${API}/support/tickets`).set(bearer(ben.token)).send(body).expect(201);
      await unthrottle();
      await http().post(`${API}/support/tickets`).set(bearer(ben.token)).send(body).expect(429);
      await setting('support.maxOpenTickets', 5);
    });
  });

  it('erases a person’s chats and tickets with their account, and blanks what they wrote elsewhere', async () => {
    const eraser = app.get(AccountEraser);
    await prisma.user.update({ where: { id: pia.id }, data: { status: 'PENDING_DELETION', deletedAt: new Date() } });
    expect((await eraser.erase(pia.id)).status).toBe('erased');
    const left = await prisma.chatMessage.findMany({ where: { senderId: pia.id } });
    expect(left.length).toBeGreaterThan(0);
    expect(left.every((m) => m.body === null && m.status === 'REMOVED')).toBe(true);
    await prisma.user.update({ where: { id: ana.id }, data: { status: 'PENDING_DELETION', deletedAt: new Date() } });
    expect((await eraser.erase(ana.id)).status).toBe('erased');
    expect(await prisma.conversation.count({ where: { customerId: ana.id } })).toBe(0);
    expect(await prisma.supportTicket.count({ where: { userId: ana.id } })).toBe(0);
  });
});
