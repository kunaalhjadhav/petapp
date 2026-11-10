import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import * as bcrypt from 'bcryptjs';
import { readFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { SMS_PROVIDER, type SmsMessage } from '../src/providers/sms/sms.provider';
import { PUSH_PROVIDER, type PushMessage } from '../src/providers/push/push.provider';
import { syncRbac } from '../src/modules/rbac/rbac.seed';
import { WorkerModule } from '../src/worker/worker.module';

const API = '/api/v1';
const PHOTO = readFileSync(join(__dirname, 'fixtures', 'photo-gps.jpg'));
const REEL = readFileSync(join(__dirname, 'fixtures', 'reel-3s.mp4'));

jest.setTimeout(120_000);

type User = { token: string; id: string };

describe('Notifications (e2e)', () => {
  let app: INestApplication;
  let worker: TestingModule;
  let prisma: PrismaService;
  let redis: RedisService;
  const inbox = new Map<string, string>();
  const pushes: PushMessage[] = [];
  let dogId: string;

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function login(phone: string, name?: string): Promise<User> {
    // This suite creates many accounts quickly; the OTP rate limit has its own tests elsewhere.
    const keys = await redis.client.keys('throttle:*');
    if (keys.length) await redis.client.del(...keys);
    await http().post(`${API}/auth/otp/request`).send({ phone }).expect(200);
    const r = await http().post(`${API}/auth/otp/verify`).send({ phone, code: inbox.get(phone) }).expect(200);
    const u = { token: r.body.data.tokens.accessToken as string, id: r.body.data.user.id as string };
    if (name) await http().patch(`${API}/users/me`).set(bearer(u.token)).send({ name }).expect(200);
    return u;
  }

  async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, what: string): Promise<T> {
    for (let i = 0; i < 80; i++) {
      const v = await fn();
      if (ok(v)) return v;
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(`timed out waiting for ${what}`);
  }

  /** Waits for the notification queue to drain, so "nothing arrived" assertions are meaningful. */
  async function settled() {
    const pending = async () => {
      const lists = await Promise.all(['wait', 'active'].map((k) => redis.client.llen(`bull:notifications:${k}`)));
      const sets = await Promise.all(['delayed', 'prioritized'].map((k) => redis.client.zcard(`bull:notifications:${k}`)));
      return [...lists, ...sets].reduce((a, b) => a + b, 0);
    };
    await until(pending, (n) => n === 0, 'notification queue to drain');
    await new Promise((r) => setTimeout(r, 200));
  }

  const notifications = async (u: User) => (await http().get(`${API}/notifications?limit=50`).set(bearer(u.token)).expect(200)).body.data;

  async function photoPost(u: User, extra: Record<string, unknown> = {}) {
    const r = await http().post(`${API}/media/uploads`).set(bearer(u.token)).send({ kind: 'IMAGE', mimeType: 'image/jpeg', sizeBytes: PHOTO.length }).expect(201);
    await fetch(r.body.data.upload.url, { method: 'PUT', headers: r.body.data.upload.headers, body: new Uint8Array(PHOTO) });
    const id = r.body.data.media.id;
    await http().post(`${API}/media/${id}/complete`).set(bearer(u.token)).expect(200);
    await until(async () => (await http().get(`${API}/media/${id}`).set(bearer(u.token))).body.data.status, (s) => s === 'READY', 'image');
    return (await http().post(`${API}/posts`).set(bearer(u.token)).send({ type: 'PHOTO', mediaIds: [id], ...extra }).expect(201)).body.data.id as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_PROVIDER)
      .useValue({ name: 'capture', send: async (m: SmsMessage) => (inbox.set(m.to, m.body.match(/\d{6}/)![0]), {}) })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);

    await redis.client.flushdb();
    const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'spatial_ref_sys')`;
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
    await syncRbac(prisma);
    await prisma.featureFlag.create({ data: { key: 'ENABLE_REELS', enabled: true } });
    dogId = (await prisma.petSpecies.create({ data: { key: 'dog', name: 'Dog' } })).id;
    await new S3Client({
      endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION, forcePathStyle: true,
      credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! },
    }).send(new CreateBucketCommand({ Bucket: process.env.S3_BUCKET, CreateBucketConfiguration: { LocationConstraint: 'ap-south-1' } })).catch(() => undefined);

    worker = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(PUSH_PROVIDER)
      .useValue({
        name: 'capture',
        send: async (m: PushMessage) => {
          pushes.push(m);
          return m.token.startsWith('dead') ? 'invalid-token' : 'sent';
        },
      })
      .compile();
    await worker.init();
  });

  beforeEach(async () => {
    const keys = await redis.client.keys('throttle:*');
    if (keys.length) await redis.client.del(...keys);
    pushes.length = 0;
  });

  afterAll(async () => {
    await worker.close();
    await app.close();
  });

  it('groups likes into one notification, counts each person once, and never notifies yourself', async () => {
    const author = await login('+919833300001', 'Aanya');
    await http().post(`${API}/devices`).set(bearer(author.token)).send({ token: 'device-aanya-0000000000000', platform: 'ANDROID' }).expect(200);
    const post = await photoPost(author, { caption: 'Beach day' });
    const fans = [await login('+919833300002', 'Riya'), await login('+919833300003', 'Kabir'), await login('+919833300004', 'Neha')];
    for (const f of fans) await http().post(`${API}/posts/${post}/like`).set(bearer(f.token)).expect(200);
    await http().delete(`${API}/posts/${post}/like`).set(bearer(fans[0].token)).expect(200);
    await http().post(`${API}/posts/${post}/like`).set(bearer(fans[0].token)).expect(200); // re-like: still one person
    await http().post(`${API}/posts/${post}/like`).set(bearer(author.token)).expect(200); // own like
    await settled();

    const n = await notifications(author);
    const likes = n.items.filter((x: { type: string }) => x.type === 'POST_LIKE');
    expect(likes).toHaveLength(1);
    expect(likes[0]).toMatchObject({ count: 3, entityType: 'Post', entityId: post, read: false });
    expect(likes[0].body).toMatch(/^(Riya|Kabir|Neha) and 2 others liked your post: “Beach day”$/);
    expect(n.unread).toBe(1);
    expect(pushes.filter((p) => p.token === 'device-aanya-0000000000000')).toHaveLength(3);
    expect(pushes.at(-1)!.body).toMatch(/and 2 others liked your post/);
    expect(pushes.at(-1)!.data).toMatchObject({ type: 'POST_LIKE', entityType: 'Post', entityId: post });
  });

  it('notifies about comments, replies and @mentions of pets in comments', async () => {
    const author = await login('+919833300010', 'Owner');
    const commenter = await login('+919833300011', 'Commenter');
    const replier = await login('+919833300012', 'Replier');
    const petOwner = await login('+919833300013', 'PetOwner');
    const pet = (await http().post(`${API}/pets`).set(bearer(petOwner.token)).send({ name: 'Mochi', speciesId: dogId }).expect(201)).body.data;
    const post = await photoPost(author);

    const top = (await http().post(`${API}/posts/${post}/comments`).set(bearer(commenter.token)).send({ body: 'Adorable!' }).expect(201)).body.data;
    await http().post(`${API}/posts/${post}/comments`).set(bearer(replier.token)).send({ body: `Agreed, looks like @${pet.handle}`, parentId: top.id }).expect(201);
    await settled();

    const toAuthor = (await notifications(author)).items.map((x: { type: string; body: string }) => `${x.type}: ${x.body}`);
    expect(toAuthor).toEqual(
      expect.arrayContaining([`POST_COMMENT: Commenter commented: “Adorable!”`, `POST_COMMENT: Replier commented: “Agreed, looks like @${pet.handle}”`]),
    );
    const toCommenter = (await notifications(commenter)).items;
    expect(toCommenter).toHaveLength(1);
    expect(toCommenter[0]).toMatchObject({ type: 'COMMENT_REPLY', body: `Replier replied to your comment: “Agreed, looks like @${pet.handle}”` });
    const toPetOwner = (await notifications(petOwner)).items;
    expect(toPetOwner).toHaveLength(1);
    expect(toPetOwner[0]).toMatchObject({ type: 'MENTION', title: 'Mochi was mentioned', entityId: post });
  });

  it('tells authors when a deferred post goes live, and mentions only reach owners who can see the post', async () => {
    const author = await login('+919833300020', 'Author');
    const fan = await login('+919833300021', 'Fan');
    const stranger = await login('+919833300022', 'Stranger');
    const fanPet = (await http().post(`${API}/pets`).set(bearer(fan.token)).send({ name: 'Biscuit', speciesId: dogId }).expect(201)).body.data;
    const strangerPet = (await http().post(`${API}/pets`).set(bearer(stranger.token)).send({ name: 'Pixel', speciesId: dogId }).expect(201)).body.data;
    await http().post(`${API}/users/${author.id}/follow`).set(bearer(fan.token)).expect(200);

    // Immediate publish: no "your post is live", but the mention arrives.
    await photoPost(author, { caption: `Park with @${fanPet.handle} and @${strangerPet.handle}`, visibility: 'FOLLOWERS' });
    // Deferred publish: video processed by the worker.
    const r = await http().post(`${API}/media/uploads`).set(bearer(author.token)).send({ kind: 'VIDEO', mimeType: 'video/mp4', sizeBytes: REEL.length }).expect(201);
    await fetch(r.body.data.upload.url, { method: 'PUT', headers: r.body.data.upload.headers, body: new Uint8Array(REEL) });
    await http().post(`${API}/media/${r.body.data.media.id}/complete`).set(bearer(author.token)).expect(200);
    await http().post(`${API}/posts`).set(bearer(author.token)).send({ type: 'REEL', mediaIds: [r.body.data.media.id] }).expect(201);

    const published = await until(() => notifications(author), (n) => n.items.some((x: { type: string }) => x.type === 'POST_PUBLISHED'), 'post published notice');
    expect(published.items.filter((x: { type: string }) => x.type === 'POST_PUBLISHED')).toHaveLength(1);
    expect(published.items.find((x: { type: string }) => x.type === 'POST_PUBLISHED').body).toBe('Your reel finished processing and is now live.');
    await settled();
    expect((await notifications(fan)).items.map((x: { type: string }) => x.type)).toEqual(['MENTION']); // follows the author
    expect((await notifications(stranger)).items).toHaveLength(0); // followers-only post they can't see
  });

  it('respects preferences, blocks and follow grouping', async () => {
    const me = await login('+919833300030', 'Me');
    await http().post(`${API}/devices`).set(bearer(me.token)).send({ token: 'device-me-00000000000000000', platform: 'IOS' }).expect(200);
    const a = await login('+919833300031', 'Asha');
    const b = await login('+919833300032', 'Bilal');
    const post = await photoPost(me);

    expect((await http().get(`${API}/notifications/preferences`).set(bearer(me.token)).expect(200)).body.data).toEqual({ push: true, likes: true, comments: true, mentions: true, follows: true, posts: true, chat: true, reminders: true, votes: true, promotions: false });
    await http().put(`${API}/notifications/preferences`).set(bearer(me.token)).send({ likes: false, push: false }).expect(200);
    await http().post(`${API}/posts/${post}/like`).set(bearer(a.token)).expect(200);
    await http().post(`${API}/posts/${post}/comments`).set(bearer(a.token)).send({ body: 'nice' }).expect(201);
    await http().post(`${API}/users/${b.id}/block`).set(bearer(me.token)).expect(200);
    await http().post(`${API}/users/${me.id}/follow`).set(bearer(a.token)).expect(200);
    const c = await login('+919833300033', 'Chitra');
    await http().post(`${API}/users/${me.id}/follow`).set(bearer(c.token)).expect(200);
    await settled();

    const types = (await notifications(me)).items.map((x: { type: string; count: number; body: string }) => `${x.type}:${x.count}`);
    expect(types.sort()).toEqual(['NEW_FOLLOWER:2', 'POST_COMMENT:1']); // no likes; follows grouped for the day
    expect(pushes.filter((p) => p.token === 'device-me-00000000000000000')).toHaveLength(0); // push off

    // A blocked person's comment never notifies (they can't even see the post).
    await http().post(`${API}/posts/${post}/comments`).set(bearer(b.token)).send({ body: 'hi' }).expect(404);
  });

  it('notifies pet owners of new followers and content owners of moderation decisions', async () => {
    const owner = await login('+919833300040', 'Owner');
    const fan = await login('+919833300041', 'Fan');
    const reporter = await login('+919833300042', 'Reporter');
    const pet = (await http().post(`${API}/pets`).set(bearer(owner.token)).send({ name: 'Simba', speciesId: dogId }).expect(201)).body.data;
    await http().post(`${API}/pets/${pet.id}/follow`).set(bearer(fan.token)).expect(200);
    const post = await photoPost(owner);
    await http().post(`${API}/reports`).set(bearer(reporter.token)).send({ targetType: 'POST', targetId: post, reason: 'SPAM' }).expect(201);
    const role = await prisma.role.findUniqueOrThrow({ where: { key: 'MODERATOR' } });
    await prisma.user.create({ data: { email: 'mod@notif.test', passwordHash: await bcrypt.hash('Moderator-Pass-1', 10), roles: { create: [{ roleId: role.id }] } } });
    const mod = (await http().post(`${API}/admin/auth/login`).send({ email: 'mod@notif.test', password: 'Moderator-Pass-1' }).expect(200)).body.data.tokens.accessToken;
    const kase = (await prisma.moderationCase.findFirstOrThrow({ where: { targetId: post } })).id;
    await http().post(`${API}/admin/moderation/cases/${kase}/resolve`).set(bearer(mod)).send({ resolution: 'CONTENT_REMOVED', note: 'Spam' }).expect(200);
    await settled();

    const items = (await notifications(owner)).items;
    expect(items.find((x: { type: string }) => x.type === 'PET_FOLLOWER')).toMatchObject({ body: 'Fan started following Simba.', entityId: pet.id });
    expect(items.find((x: { type: string }) => x.type === 'CONTENT_REMOVED')).toMatchObject({ title: 'Your post was removed', entityId: post });
  });

  it('inbox: newest first, cursor pages, mark some or all read', async () => {
    const me = await login('+919833300050', 'Inbox');
    for (let i = 0; i < 5; i++) {
      const f = await login(`+91983330006${i}`, `Follower${i}`);
      const pet = (await http().post(`${API}/pets`).set(bearer(me.token)).send({ name: `Pet${i}`, speciesId: dogId }).expect(201)).body.data;
      await http().post(`${API}/pets/${pet.id}/follow`).set(bearer(f.token)).expect(200);
    }
    await settled();
    const p1 = (await http().get(`${API}/notifications?limit=3`).set(bearer(me.token)).expect(200)).body.data;
    expect(p1.items).toHaveLength(3);
    expect(p1.unread).toBe(5);
    expect(p1.items[0].body).toBe('Follower4 started following Pet4.');
    const p2 = (await http().get(`${API}/notifications?limit=3&cursor=${p1.nextCursor}`).set(bearer(me.token)).expect(200)).body.data;
    expect(p2.items).toHaveLength(2);
    expect(p2.nextCursor).toBeNull();

    const one = await http().post(`${API}/notifications/read`).set(bearer(me.token)).send({ ids: [p1.items[0].id] }).expect(200);
    expect(one.body.data).toEqual({ marked: 1, unread: 4 });
    const other = await login('+919833300070');
    await http().post(`${API}/notifications/read`).set(bearer(other.token)).send({ ids: [p1.items[1].id] }).expect(200); // not theirs: no effect
    expect((await http().get(`${API}/notifications/unread-count`).set(bearer(me.token)).expect(200)).body.data.unread).toBe(4);
    expect((await http().post(`${API}/notifications/read`).set(bearer(me.token)).send({}).expect(200)).body.data).toEqual({ marked: 4, unread: 0 });
  });

  it('devices: a token moves between accounts, dead tokens are pruned, suspension removes devices', async () => {
    const a = await login('+919833300080', 'DevA');
    const b = await login('+919833300081', 'DevB');
    const fan = await login('+919833300082', 'Fan');
    await http().post(`${API}/devices`).set(bearer(a.token)).send({ token: 'shared-phone-000000000000000', platform: 'ANDROID' }).expect(200);
    await http().post(`${API}/devices`).set(bearer(b.token)).send({ token: 'shared-phone-000000000000000', platform: 'ANDROID' }).expect(200);
    expect(await prisma.deviceToken.findUniqueOrThrow({ where: { token: 'shared-phone-000000000000000' } })).toMatchObject({ userId: b.id });

    await http().post(`${API}/devices`).set(bearer(b.token)).send({ token: 'dead-token-0000000000000000', platform: 'IOS' }).expect(200);
    await http().post(`${API}/users/${b.id}/follow`).set(bearer(fan.token)).expect(200);
    await settled();
    expect(pushes.map((p) => p.token).sort()).toEqual(['dead-token-0000000000000000', 'shared-phone-000000000000000']);
    expect(await prisma.deviceToken.count({ where: { token: 'dead-token-0000000000000000' } })).toBe(0);

    const role = await prisma.role.findUniqueOrThrow({ where: { key: 'ADMIN' } });
    await prisma.user.create({ data: { email: 'admin@notif.test', passwordHash: await bcrypt.hash('Admin-Password-1', 10), roles: { create: [{ roleId: role.id }] } } });
    const admin = (await http().post(`${API}/admin/auth/login`).send({ email: 'admin@notif.test', password: 'Admin-Password-1' }).expect(200)).body.data.tokens.accessToken;
    await http().patch(`${API}/admin/users/${b.id}/status`).set(bearer(admin)).send({ status: 'SUSPENDED', reason: 'Test suspension' }).expect(200);
    expect(await prisma.deviceToken.count({ where: { userId: b.id } })).toBe(0);
    await settled();
    expect(await prisma.notification.count({ where: { userId: b.id, type: 'ACCOUNT_STATUS' } })).toBe(1);

    await http().delete(`${API}/devices/whatever-token-000000000000`).set(bearer(a.token)).expect(200);
  });
});
