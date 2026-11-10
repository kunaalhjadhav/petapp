import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { WorkerModule } from '../src/worker/worker.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { SMS_PROVIDER, type SmsMessage } from '../src/providers/sms/sms.provider';
import { PUSH_PROVIDER } from '../src/providers/push/push.provider';
import { AccountEraser } from '../src/modules/privacy/account-eraser';
import { DataExportService } from '../src/modules/privacy/data-export.service';
import { syncRbac } from '../src/modules/rbac/rbac.seed';

const API = '/api/v1';
jest.setTimeout(180_000);
type User = { token: string; id: string; phone: string };
const DAY = 86_400_000;

describe('Privacy and legal (e2e)', () => {
  let app: INestApplication;
  let worker: TestingModule;
  let prisma: PrismaService;
  let redis: RedisService;
  const inbox = new Map<string, string>();
  let admin: string;
  let moderator: string;
  let speciesId: string;
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const unthrottle = async () => {
    const k = await redis.client.keys('throttle:*');
    if (k.length) await redis.client.del(...k);
  };
  async function signIn(phone: string, expect = 200) {
    await unthrottle();
    await http().post(`${API}/auth/otp/request`).send({ phone }).expect(200);
    return http().post(`${API}/auth/otp/verify`).send({ phone, code: inbox.get(phone) }).expect(expect);
  }
  async function login(phone: string, name: string): Promise<User> {
    const r = await signIn(phone);
    const u = { token: r.body.data.tokens.accessToken, id: r.body.data.user.id, phone };
    await http().patch(`${API}/users/me`).set(bearer(u.token)).send({ name }).expect(200);
    return u;
  }
  async function staff(email: string, role: string) {
    const r = await prisma.role.findUniqueOrThrow({ where: { key: role } });
    await prisma.user.create({ data: { email, passwordHash: await bcrypt.hash('Staff-Password-1', 10), roles: { create: [{ roleId: r.id }] } } });
    return (await http().post(`${API}/admin/auth/login`).send({ email, password: 'Staff-Password-1' }).expect(200)).body.data.tokens.accessToken as string;
  }
  const docs = async () => (await http().get(`${API}/admin/legal`).set(bearer(admin)).expect(200)).body.data as Array<{ slug: string; current: { id: string; version: number; acceptances: number } | null; draft: { id: string; version: number; placeholders: number } | null }>;
  const fill = (body: string) => body.replace(/\{\{([^}]+)\}\}/g, (_m, p: string) => (/^\d/.test(p) ? p : `[${p.trim()}]`));
  /** Fills in a document's draft and publishes it. */
  async function publish(slug: string, changeSummary?: string) {
    const d = (await docs()).find((x) => x.slug === slug)!.draft!;
    const full = (await http().get(`${API}/admin/legal/${d.id}`).set(bearer(admin)).expect(200)).body.data;
    await http().patch(`${API}/admin/legal/${d.id}`).set(bearer(admin)).send({ body: fill(full.body), changeSummary }).expect(200);
    return (await http().post(`${API}/admin/legal/${d.id}/publish`).set(bearer(admin)).send({}).expect(200)).body.data;
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
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' AND tablename <> 'spatial_ref_sys'`;
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
    await syncRbac(prisma);
    await prisma.featureFlag.createMany({ data: [{ key: 'ENABLE_CONTESTS', enabled: true }, { key: 'ENABLE_MARKETPLACE', enabled: true }, { key: 'ENABLE_REELS', enabled: true }] });
    speciesId = (await prisma.petSpecies.create({ data: { key: 'dog', name: 'Dog' } })).id;
    const s3 = new S3Client({ region: process.env.S3_REGION, endpoint: process.env.S3_ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! } });
    await s3.send(new CreateBucketCommand({ Bucket: process.env.S3_BUCKET })).catch(() => undefined);
    admin = await staff('root@privacy.test', 'SUPER_ADMIN');
    moderator = await staff('mod@privacy.test', 'MODERATOR');
    worker = await Test.createTestingModule({ imports: [WorkerModule] }).overrideProvider(PUSH_PROVIDER).useValue({ name: 'none', send: async () => 'sent' }).compile();
    await worker.init();
  });

  afterAll(async () => {
    await worker?.close();
    await app?.close();
  });

  describe('legal documents', () => {
    it('starts with eight drafts from the templates; nothing is public until published', async () => {
      expect((await http().get(`${API}/legal`).expect(200)).body.data).toEqual([]);
      await http().get(`${API}/legal/privacy-policy`).expect(404);
      const list = await docs();
      expect(list.map((d) => d.slug)).toEqual(['terms-of-service', 'privacy-policy', 'contest-terms', 'refund-policy', 'cancellation-policy', 'partner-terms', 'vendor-terms', 'community-guidelines']);
      expect(list.every((d) => d.current === null && d.draft?.version === 1 && d.draft.placeholders > 0)).toBe(true);
    });

    it('refuses to publish while placeholders remain, and only staff with the permission can edit', async () => {
      const d = (await docs()).find((x) => x.slug === 'privacy-policy')!.draft!;
      const r = await http().post(`${API}/admin/legal/${d.id}/publish`).set(bearer(admin)).send({}).expect(400);
      expect(r.body.errors.some((e: { message: string }) => e.message.includes('{{Company legal name}}'))).toBe(true);
      await http().get(`${API}/admin/legal`).set(bearer(moderator)).expect(403);
      await http().patch(`${API}/admin/legal/${d.id}`).set(bearer(moderator)).send({ title: 'Hacked' }).expect(403);
      await http().get(`${API}/admin/legal`).expect(401);
    });

    it('publishes, shows it publicly, and versions changes with a summary', async () => {
      const v1 = await publish('privacy-policy');
      expect(v1).toMatchObject({ status: 'PUBLISHED', version: 1, placeholders: [] });
      await publish('terms-of-service');
      const pub = (await http().get(`${API}/legal`).expect(200)).body.data;
      expect(pub.map((d: { slug: string }) => d.slug)).toEqual(['terms-of-service', 'privacy-policy']);
      const doc = (await http().get(`${API}/legal/privacy-policy`).expect(200)).body.data;
      expect(doc.body).toContain('# Privacy Policy');
      expect(doc.body).not.toMatch(/\{\{/);
      // Published text can't be edited in place.
      await http().patch(`${API}/admin/legal/${v1.id}`).set(bearer(admin)).send({ title: 'Changed' }).expect(400);
      const v2 = (await http().post(`${API}/admin/legal`).set(bearer(admin)).send({ slug: 'privacy-policy' }).expect(201)).body.data;
      expect(v2).toMatchObject({ version: 2, status: 'DRAFT' });
      await http().post(`${API}/admin/legal`).set(bearer(admin)).send({ slug: 'privacy-policy' }).expect(409);
      // A new version must say what changed.
      await http().post(`${API}/admin/legal/${v2.id}/publish`).set(bearer(admin)).send({}).expect(400);
      expect(await prisma.auditLog.count({ where: { action: 'legal.publish' } })).toBe(2);
    });
  });

  describe('consents', () => {
    let alice: User;
    beforeAll(async () => {
      alice = await login('+919800000001', 'Alice');
    });

    it('asks for the current terms and privacy policy, and records acceptance once', async () => {
      const s = (await http().get(`${API}/me/consents`).set(bearer(alice.token)).expect(200)).body.data;
      expect(s.pending).toEqual(['terms-of-service', 'privacy-policy']);
      expect(s.marketing.granted).toBe(false);
      await http().post(`${API}/me/consents`).set(bearer(alice.token)).send({ slug: 'privacy-policy', version: 7 }).expect(400);
      await http().post(`${API}/me/consents`).set(bearer(alice.token)).send({ slug: 'privacy-policy', version: 1 }).expect(200);
      await http().post(`${API}/me/consents`).set(bearer(alice.token)).send({ slug: 'privacy-policy', version: 1 }).expect(200);
      const after = (await http().post(`${API}/me/consents`).set(bearer(alice.token)).send({ slug: 'terms-of-service', version: 1 }).expect(200)).body.data;
      expect(after.pending).toEqual([]);
      expect(await prisma.consentRecord.count({ where: { userId: alice.id, subject: 'privacy-policy' } })).toBe(1);
      const rec = await prisma.consentRecord.findFirstOrThrow({ where: { userId: alice.id, subject: 'privacy-policy' } });
      expect(rec.ipAddress).toBeTruthy();
    });

    it('asks again, as "updated", after a new version is published', async () => {
      const d = (await docs()).find((x) => x.slug === 'privacy-policy')!;
      expect(d.current!.acceptances).toBe(1);
      await http().patch(`${API}/admin/legal/${d.draft!.id}`).set(bearer(admin)).send({ changeSummary: 'Added the assistant section' }).expect(200);
      const v2 = (await http().post(`${API}/admin/legal/${d.draft!.id}/publish`).set(bearer(admin)).send({}).expect(200)).body.data;
      expect(v2.history.map((h: { version: number; status: string }) => `${h.version}:${h.status}`)).toEqual(['2:PUBLISHED', '1:RETIRED']);
      const s = (await http().get(`${API}/me/consents`).set(bearer(alice.token)).expect(200)).body.data;
      expect(s.pending).toEqual(['privacy-policy']);
      expect(s.documents.find((x: { slug: string }) => x.slug === 'privacy-policy')).toMatchObject({ updated: true, acceptedVersion: 1, version: 2, changeSummary: 'Added the assistant section' });
    });

    it('records marketing changes and never lets consent history be edited', async () => {
      await http().put(`${API}/me/marketing`).set(bearer(alice.token)).send({ granted: true }).expect(200);
      await http().put(`${API}/me/marketing`).set(bearer(alice.token)).send({ granted: true }).expect(200);
      const s = (await http().put(`${API}/me/marketing`).set(bearer(alice.token)).send({ granted: false }).expect(200)).body.data;
      expect(s.marketing.granted).toBe(false);
      const rows = await prisma.consentRecord.findMany({ where: { userId: alice.id, kind: 'MARKETING' }, orderBy: { createdAt: 'asc' } });
      expect(rows.map((r) => r.granted)).toEqual([true, false]);
      // Only through PUT /me/marketing, so every change is recorded.
      await http().patch(`${API}/users/me`).set(bearer(alice.token)).send({ marketingConsent: true }).expect(400);
      await expect(prisma.consentRecord.update({ where: { id: rows[0].id }, data: { granted: false } })).rejects.toThrow(/cannot be changed/);
    });

    it('requires the contest terms before entering a contest, once they are published', async () => {
      const contestId = '00000000-0000-4000-8000-000000000001';
      const petId = '00000000-0000-4000-8000-000000000002';
      // Not published yet: the request goes on (and finds no such pet).
      await http().post(`${API}/contests/${contestId}/register`).set(bearer(alice.token)).send({ petId }).expect(404);
      await publish('contest-terms');
      const r = await http().post(`${API}/contests/${contestId}/register`).set(bearer(alice.token)).send({ petId }).expect(403);
      expect(r.body.errors[0]).toMatchObject({ code: 'TERMS_NOT_ACCEPTED', field: 'contest-terms' });
      // Contest terms are asked for at entry, not on app start.
      expect((await http().get(`${API}/me/consents`).set(bearer(alice.token)).expect(200)).body.data.pending).toEqual(['privacy-policy']);
      await http().post(`${API}/me/consents`).set(bearer(alice.token)).send({ slug: 'contest-terms', version: 1 }).expect(200);
      await http().post(`${API}/contests/${contestId}/register`).set(bearer(alice.token)).send({ petId }).expect(404);
    });

    it('requires the seller terms before a store is submitted for review', async () => {
      await publish('vendor-terms');
      const v = await login('+919800000009', 'Seller');
      await http().post(`${API}/vendor/profile`).set(bearer(v.token)).send({ businessName: 'Paws Store', phone: '9800000009', addressLine: '1 Market Road', city: 'Pune', state: 'Maharashtra', pincode: '411001' }).expect(201);
      const doc = await prisma.mediaAsset.create({ data: { ownerId: v.id, kind: 'DOCUMENT', mimeType: 'application/pdf', sizeBytes: 1000, storageKey: `uploads/${v.id}/doc1`, status: 'READY', variants: {} } });
      await http().post(`${API}/vendor/documents`).set(bearer(v.token)).send({ kind: 'ID_PROOF', mediaId: doc.id }).expect(201);
      const s = (await http().get(`${API}/me/consents`).set(bearer(v.token)).expect(200)).body.data;
      expect(s.pending).toContain('vendor-terms');
      const r = await http().post(`${API}/vendor/submit`).set(bearer(v.token)).expect(403);
      expect(r.body.errors[0]).toMatchObject({ code: 'TERMS_NOT_ACCEPTED', field: 'vendor-terms' });
      await http().post(`${API}/me/consents`).set(bearer(v.token)).send({ slug: 'vendor-terms', version: 1 }).expect(200);
      await http().post(`${API}/vendor/submit`).set(bearer(v.token)).expect(200);
    });
  });

  describe('data export', () => {
    let bob: User;
    let carol: User;
    beforeAll(async () => {
      bob = await login('+919800000002', 'Bob');
      carol = await login('+919800000003', 'Carol');
      const pet = (await http().post(`${API}/pets`).set(bearer(bob.token)).send({ name: 'Bruno', speciesId }).expect(201)).body.data;
      await prisma.pet.update({ where: { id: pet.id }, data: { microchipId: '985112003456789', medicalNotes: 'Allergic to chicken' } });
      await http().post(`${API}/users/me/addresses`).set(bearer(bob.token)).send({ label: 'Home', line1: '4 Lake View', city: 'Pune', state: 'Maharashtra', pincode: '411001' }).expect(201);
    });

    it('builds a copy of everything, once a day, downloadable only by its owner', async () => {
      expect((await http().get(`${API}/me/data-exports`).set(bearer(bob.token)).expect(200)).body.data.canRequest).toBe(true);
      const r = await http().post(`${API}/me/data-exports`).set(bearer(bob.token)).expect(201);
      expect(r.body.data.items[0].status).toBe('PENDING');
      await http().post(`${API}/me/data-exports`).set(bearer(bob.token)).expect(409);
      let item: { id: string; status: string } | undefined;
      for (let i = 0; i < 100 && item?.status !== 'READY'; i++) {
        await new Promise((res) => setTimeout(res, 200));
        item = (await http().get(`${API}/me/data-exports`).set(bearer(bob.token)).expect(200)).body.data.items[0];
      }
      expect(item!.status).toBe('READY');
      // One a day.
      const again = await http().post(`${API}/me/data-exports`).set(bearer(bob.token)).expect(409);
      expect(again.body.message).toMatch(/once a day/);
      expect((await http().get(`${API}/me/data-exports`).set(bearer(bob.token)).expect(200)).body.data.canRequest).toBe(false);
      // Someone else's export doesn't exist for them.
      await http().get(`${API}/me/data-exports/${item!.id}/link`).set(bearer(carol.token)).expect(404);

      const link = (await http().get(`${API}/me/data-exports/${item!.id}/link`).set(bearer(bob.token)).expect(200)).body.data;
      expect(link.fileName).toMatch(/^petapp-data-\d{4}-\d{2}-\d{2}\.json$/);
      const res = await fetch(link.url);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-disposition')).toContain('attachment');
      const text = await res.text();
      const data = JSON.parse(text);
      expect(data.profile).toMatchObject({ id: bob.id, phone: bob.phone, name: 'Bob', roles: ['CUSTOMER'] });
      expect(data.pets[0]).toMatchObject({ name: 'Bruno', microchipId: '985112003456789', medicalNotes: 'Allergic to chicken' });
      expect(data.addresses[0].line1).toBe('4 Lake View');
      expect(data.signIns.methods[0].provider).toBe('PHONE');
      expect(data.signIns.sessions.length).toBeGreaterThan(0);
      // Never secrets.
      expect(text).not.toMatch(/tokenHash|passwordHash|accountNumberEnc|storageKey/);
      // Ready notification.
      expect(await prisma.notification.count({ where: { userId: bob.id, type: 'DATA_EXPORT_READY' } })).toBe(1);
    });

    it('expires downloads and deletes the file', async () => {
      const e = await prisma.dataExport.findFirstOrThrow({ where: { userId: bob.id } });
      await prisma.dataExport.update({ where: { id: e.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await http().get(`${API}/me/data-exports/${e.id}/link`).set(bearer(bob.token)).expect(404);
      expect(await worker.get(DataExportService).purgeExpired()).toBe(1);
      expect(await prisma.dataExport.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({ status: 'EXPIRED', storageKey: null });
    });
  });

  describe('account deletion', () => {
    let dan: User;
    let erin: User;
    let erinPost: string;
    let erinPet: string;
    let danPet: string;

    beforeAll(async () => {
      dan = await login('+919800000004', 'Dan');
      erin = await login('+919800000005', 'Erin');
      erinPet = (await http().post(`${API}/pets`).set(bearer(erin.token)).send({ name: 'Kiwi', speciesId }).expect(201)).body.data.id;
      danPet = (await http().post(`${API}/pets`).set(bearer(dan.token)).send({ name: 'Rex', speciesId }).expect(201)).body.data.id;
      await prisma.pet.update({ where: { id: danPet }, data: { microchipId: '985112000000001', medicalNotes: 'Hip dysplasia', about: 'Loves the beach' } });
      const media = await prisma.mediaAsset.create({ data: { ownerId: erin.id, kind: 'IMAGE', mimeType: 'image/jpeg', sizeBytes: 1000, storageKey: `uploads/${erin.id}/p1`, status: 'READY', variants: {} } });
      erinPost = (await prisma.post.create({ data: { authorId: erin.id, type: 'PHOTO', caption: 'Kiwi at the park', status: 'PUBLISHED', publishedAt: new Date(), media: { create: [{ mediaId: media.id, position: 0 }] } } })).id;
      // Dan's own post, likes, comment and follows.
      const danMedia = await prisma.mediaAsset.create({ data: { ownerId: dan.id, kind: 'IMAGE', mimeType: 'image/jpeg', sizeBytes: 1000, storageKey: `uploads/${dan.id}/p2`, status: 'READY', variants: {} } });
      await prisma.post.create({ data: { authorId: dan.id, type: 'PHOTO', caption: 'Rex on the beach #rex', status: 'PUBLISHED', publishedAt: new Date(), media: { create: [{ mediaId: danMedia.id, position: 0 }] } } });
      const lk = await http().post(`${API}/posts/${erinPost}/like`).set(bearer(dan.token));
      expect([lk.status, lk.body.message]).toEqual([200, expect.anything()]);
      await http().post(`${API}/posts/${erinPost}/comments`).set(bearer(dan.token)).send({ body: 'So cute!' }).expect(201);
      await http().post(`${API}/pets/${erinPet}/follow`).set(bearer(dan.token)).expect((r) => expect(r.status).toBeLessThan(300));
      await http().post(`${API}/users/${erin.id}/follow`).set(bearer(dan.token)).expect(200);
    });

    it('schedules deletion with a grace period and signs out everywhere', async () => {
      const r = await http().delete(`${API}/users/me`).set(bearer(dan.token)).expect(200);
      expect(r.body.data.graceDays).toBe(14);
      expect(r.body.message).toMatch(/14 days/);
      await http().get(`${API}/users/me`).set(bearer(dan.token)).expect(403); // the account is no longer active (and its sessions are revoked)
      const list = (await http().get(`${API}/admin/privacy/deletions`).set(bearer(admin)).expect(200)).body;
      expect(list.data.map((u: { id: string }) => u.id)).toContain(dan.id);
      expect(list.meta.counts.scheduled).toBe(1);
    });

    it('signing in during the grace period cancels the deletion', async () => {
      const r = await signIn(dan.phone);
      expect(r.body.data.accountRestored).toBe(true);
      expect(r.body.data.isNewUser).toBe(false);
      dan.token = r.body.data.tokens.accessToken;
      expect((await http().get(`${API}/users/me`).set(bearer(dan.token)).expect(200)).body.data.status).toBe('ACTIVE');
      expect(await prisma.auditLog.count({ where: { action: 'user.delete_cancelled', entityId: dan.id } })).toBe(1);
    });

    it('does nothing before the grace period ends', async () => {
      await http().delete(`${API}/users/me`).set(bearer(dan.token)).expect(200);
      expect(await worker.get(AccountEraser).sweep()).toEqual({ erased: 0, deferred: 0 });
    });

    it('is held back while a refund is still owed, then erased with business records kept', async () => {
      await prisma.user.update({ where: { id: dan.id }, data: { deletedAt: new Date(Date.now() - 15 * DAY) } });
      const payment = await prisma.payment.create({ data: { userId: dan.id, purpose: 'CONTEST_REGISTRATION', referenceId: danPet, amountPaise: 9900, provider: 'fake', providerOrderId: `order_${Date.now()}`, status: 'REFUND_PENDING', capturedAt: new Date() } });
      const refund = await prisma.refund.create({ data: { paymentId: payment.id, amountPaise: 9900, reason: 'Contest cancelled', reference: `rf-${Date.now()}`, status: 'PENDING' } });
      expect(await worker.get(AccountEraser).sweep()).toEqual({ erased: 0, deferred: 1 });
      const held = (await http().get(`${API}/admin/privacy/deletions?state=deferred`).set(bearer(admin)).expect(200)).body.data;
      expect(held[0]).toMatchObject({ id: dan.id, waitingFor: ['1 refund not yet paid'] });
      // A second run doesn't log the same reason again.
      await worker.get(AccountEraser).sweep();
      expect(await prisma.auditLog.count({ where: { action: 'user.delete_deferred', entityId: dan.id } })).toBe(1);

      await prisma.refund.update({ where: { id: refund.id }, data: { status: 'PROCESSED', processedAt: new Date() } });
      await http().post(`${API}/admin/privacy/deletions/${dan.id}/erase`).set(bearer(moderator)).expect(403);
      const r = (await http().post(`${API}/admin/privacy/deletions/${dan.id}/erase`).set(bearer(admin)).expect(200)).body.data;
      expect(r).toEqual({ status: 'erased' });

      const u = await prisma.user.findUniqueOrThrow({ where: { id: dan.id } });
      expect(u).toMatchObject({ status: 'DELETED', name: null, phone: null, email: null, passwordHash: null, statusReason: 'Erased', marketingConsent: false });
      const pet = await prisma.pet.findUniqueOrThrow({ where: { id: danPet } });
      expect(pet).toMatchObject({ status: 'REMOVED', microchipId: null, medicalNotes: null, about: null });
      expect(pet.deletedAt).not.toBeNull();
      // Everyone else's counters are right.
      const post = await prisma.post.findUniqueOrThrow({ where: { id: erinPost } });
      expect(post).toMatchObject({ likeCount: 0, commentCount: 0 });
      expect((await prisma.pet.findUniqueOrThrow({ where: { id: erinPet } })).followerCount).toBe(0);
      expect((await prisma.hashtag.findUnique({ where: { tag: 'rex' } }))?.postCount ?? 0).toBe(0);
      expect(await prisma.comment.count({ where: { authorId: dan.id, status: 'VISIBLE' } })).toBe(0);
      expect(await prisma.post.count({ where: { authorId: dan.id, deletedAt: null } })).toBe(0);
      for (const t of ['session', 'authIdentity', 'userFollower', 'petFollower', 'postLike', 'mediaAsset'] as const) {
        const where = t === 'userFollower' ? { followerId: dan.id } : t === 'mediaAsset' ? { ownerId: dan.id } : { userId: dan.id };
        expect(await (prisma[t] as unknown as { count: (a: unknown) => Promise<number> }).count({ where })).toBe(0);
      }
      // Kept for tax and accounting law, without the profile.
      expect(await prisma.payment.count({ where: { userId: dan.id } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { action: 'user.erased', entityId: dan.id } })).toBe(1);
    });

    it('the same phone number starts a brand-new account afterwards', async () => {
      const r = await signIn(dan.phone);
      expect(r.body.data.isNewUser).toBe(true);
      expect(r.body.data.user.id).not.toBe(dan.id);
    });

    it('staff can cancel a deletion when the person asks, but not erase an account nobody asked to delete', async () => {
      await http().post(`${API}/admin/privacy/deletions/${erin.id}/erase`).set(bearer(admin)).expect(400);
      await http().delete(`${API}/users/me`).set(bearer(erin.token)).expect(200);
      await http().post(`${API}/admin/privacy/deletions/${erin.id}/cancel`).set(bearer(admin)).expect(200);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: erin.id } })).status).toBe('ACTIVE');
      await http().post(`${API}/admin/privacy/deletions/${erin.id}/cancel`).set(bearer(admin)).expect(400);
    });

    it('a staff account waiting for deletion cannot sign in to the dashboard', async () => {
      const r = await prisma.role.findUniqueOrThrow({ where: { key: 'MODERATOR' } });
      await prisma.user.create({ data: { email: 'gone@privacy.test', status: 'PENDING_DELETION', deletedAt: new Date(), passwordHash: await bcrypt.hash('Staff-Password-1', 10), roles: { create: [{ roleId: r.id }] } } });
      await http().post(`${API}/admin/auth/login`).send({ email: 'gone@privacy.test', password: 'Staff-Password-1' }).expect(403);
      expect((await prisma.user.findUniqueOrThrow({ where: { email: 'gone@privacy.test' } })).status).toBe('PENDING_DELETION');
    });
  });
});
