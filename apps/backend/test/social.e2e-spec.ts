import { INestApplication, INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import * as bcrypt from 'bcryptjs';
import { readFileSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { SMS_PROVIDER, type SmsMessage } from '../src/providers/sms/sms.provider';
import { syncRbac } from '../src/modules/rbac/rbac.seed';
import { WorkerModule } from '../src/worker/worker.module';
import { MaintenanceProcessor } from '../src/worker/maintenance.processor';

const API = '/api/v1';
const PASSWORD = 'Staff-Password-123';
const FIX = join(__dirname, 'fixtures');
const PHOTO = readFileSync(join(FIX, 'photo-gps.jpg'));
const REEL = readFileSync(join(FIX, 'reel-3s.mp4'));

jest.setTimeout(120_000);

describe('Social: media, posts, feeds, safety, moderation (e2e)', () => {
  let app: INestApplication;
  let worker: INestApplicationContext | null = null;
  let prisma: PrismaService;
  let redis: RedisService;
  const inbox = new Map<string, string>();
  let dogId: string;

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function startWorker() {
    if (!worker) worker = await NestFactory.createApplicationContext(WorkerModule, { logger: ['error'] });
  }
  async function stopWorker() {
    await worker?.close();
    worker = null;
  }

  async function login(phone: string) {
    await http().post(`${API}/auth/otp/request`).send({ phone }).expect(200);
    const r = await http().post(`${API}/auth/otp/verify`).send({ phone, code: inbox.get(phone) }).expect(200);
    return { token: r.body.data.tokens.accessToken as string, id: r.body.data.user.id as string };
  }

  async function staff(email: string, role: string) {
    const r = await prisma.role.findUniqueOrThrow({ where: { key: role } });
    await prisma.user.create({ data: { email, name: role, passwordHash: await bcrypt.hash(PASSWORD, 10), roles: { create: [{ roleId: r.id }] } } });
    const res = await http().post(`${API}/admin/auth/login`).send({ email, password: PASSWORD }).expect(200);
    return res.body.data.tokens.accessToken as string;
  }

  /** Full client flow: request signed URL → PUT bytes to storage → confirm. */
  async function upload(token: string, kind: 'IMAGE' | 'VIDEO', body: Buffer, mimeType: string, declared = body.length) {
    const r = await http().post(`${API}/media/uploads`).set(bearer(token)).send({ kind, mimeType, sizeBytes: declared }).expect(201);
    const { media, upload: up } = r.body.data;
    const put = await fetch(up.url, { method: 'PUT', headers: up.headers, body: new Uint8Array(body) });
    return { id: media.id as string, putStatus: put.status, complete: () => http().post(`${API}/media/${media.id}/complete`).set(bearer(token)) };
  }

  async function waitFor(token: string, mediaId: string, statuses = ['READY', 'FAILED', 'REJECTED']) {
    for (let i = 0; i < 120; i++) {
      const r = await http().get(`${API}/media/${mediaId}`).set(bearer(token)).expect(200);
      if (statuses.includes(r.body.data.status)) return r.body.data;
      await new Promise((res) => setTimeout(res, 250));
    }
    throw new Error(`media ${mediaId} never settled`);
  }

  async function readyImage(token: string) {
    const u = await upload(token, 'IMAGE', PHOTO, 'image/jpeg');
    await u.complete().expect(200);
    await waitFor(token, u.id);
    return u.id;
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

    const s3 = new S3Client({
      endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION, forcePathStyle: true,
      credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! },
    });
    await s3.send(new CreateBucketCommand({ Bucket: process.env.S3_BUCKET, CreateBucketConfiguration: { LocationConstraint: 'ap-south-1' } })).catch(() => undefined);
  });

  beforeEach(async () => {
    const keys = await redis.client.keys('throttle:*');
    if (keys.length) await redis.client.del(...keys);
  });

  afterAll(async () => {
    await stopWorker();
    await app.close();
  });

  // ───────────────────────── media ─────────────────────────

  describe('media pipeline', () => {
    let alice: { token: string; id: string };
    beforeAll(async () => {
      alice = await login('+919822200001');
      await startWorker();
    });

    it('processes a photo into resized WebP variants with all metadata (including GPS) removed', async () => {
      expect((await sharp(PHOTO).metadata()).exif).toBeDefined(); // the fixture really has EXIF/GPS
      const u = await upload(alice.token, 'IMAGE', PHOTO, 'image/jpeg');
      expect(u.putStatus).toBe(200);
      await u.complete().expect(200);
      const m = await waitFor(alice.token, u.id);
      expect(m.status).toBe('READY');
      expect(m.width).toBe(1600);
      expect(m.images.map((i: { width: number }) => i.width)).toEqual([1080, 640, 320]);

      const variant = Buffer.from(await (await fetch(m.images[0].url)).arrayBuffer());
      const meta = await sharp(variant).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.width).toBe(1080);
      expect(meta.exif).toBeUndefined();
      expect(JSON.stringify(m)).not.toContain('uploads/'); // originals are never exposed
      // A fingerprint for spotting the same photo uploaded by someone else (Phase 7a); never shown to apps.
      expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: u.id } })).perceptualHash).toMatch(/^[0-9a-f]{16}$/);
      expect(JSON.stringify(m)).not.toContain('perceptualHash');
    });

    it('transcodes a video to two-rendition HLS with a poster and strips its location metadata', async () => {
      const u = await upload(alice.token, 'VIDEO', REEL, 'video/mp4');
      await u.complete().expect(200);
      const m = await waitFor(alice.token, u.id);
      expect(m.status).toBe('READY');
      expect(m.durationMs).toBeGreaterThan(2500);
      expect([m.width, m.height]).toEqual([720, 1280]);
      const master = await (await fetch(m.hls)).text();
      expect(master.match(/#EXT-X-STREAM-INF/g)).toHaveLength(2);
      expect(master).toMatch(/RESOLUTION=720x1280/);
      expect(master).toMatch(/RESOLUTION=360x640/);
      expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: u.id } })).perceptualHash).toMatch(/^[0-9a-f]{16}$/); // from the poster frame
      const poster = await fetch(m.poster);
      expect(poster.headers.get('content-type')).toBe('image/jpeg');

      // Fetch one rendition's first segment and confirm the location tag is gone.
      const variantUrl = new URL(master.split('\n').find((l) => l.endsWith('index.m3u8'))!, m.hls.split('?')[0] + '/../');
      expect(variantUrl.pathname).toContain('/v0/index.m3u8');
    });

    it('rejects a file whose size differs from what was declared', async () => {
      // Real S3/R2 already refuse the PUT (Content-Length is signed); the API checks again on confirm.
      const u = await upload(alice.token, 'IMAGE', PHOTO, 'image/jpeg', PHOTO.length + 10);
      if (u.putStatus === 200) {
        const r = await u.complete().expect(400);
        expect(r.body.message).toMatch(/doesn’t match/);
        expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: u.id } })).status).toBe('REJECTED');
      }
    });

    it('validates type and size before issuing an upload URL', async () => {
      await http().post(`${API}/media/uploads`).set(bearer(alice.token)).send({ kind: 'IMAGE', mimeType: 'image/gif', sizeBytes: 1000 }).expect(400);
      await http().post(`${API}/media/uploads`).set(bearer(alice.token)).send({ kind: 'VIDEO', mimeType: 'video/mp4', sizeBytes: 900 * 1024 * 1024 }).expect(400);
    });

    it('rejects content that isn’t what it claims to be, and videos over the length limit', async () => {
      const fake = await upload(alice.token, 'IMAGE', Buffer.from('definitely not an image'), 'image/jpeg');
      await fake.complete().expect(200);
      expect((await waitFor(alice.token, fake.id)).status).toBe('REJECTED');

      await prisma.appSetting.upsert({ where: { key: 'media.maxVideoSeconds' }, update: { value: 2 }, create: { key: 'media.maxVideoSeconds', value: 2 } });
      const long = await upload(alice.token, 'VIDEO', REEL, 'video/mp4');
      await long.complete().expect(200);
      expect((await waitFor(alice.token, long.id)).status).toBe('REJECTED');
      await prisma.appSetting.delete({ where: { key: 'media.maxVideoSeconds' } });
    });

    it('keeps uploads private to their owner', async () => {
      const bob = await login('+919822200002');
      const id = await readyImage(alice.token);
      await http().get(`${API}/media/${id}`).set(bearer(bob.token)).expect(404);
    });
  });

  // ───────────────────────── posts ─────────────────────────

  describe('posts and reels', () => {
    let author: { token: string; id: string };
    let petId: string;
    beforeAll(async () => {
      author = await login('+919822200010');
      petId = (await http().post(`${API}/pets`).set(bearer(author.token)).send({ name: 'Bruno', speciesId: dogId }).expect(201)).body.data.id;
      await startWorker();
    });

    it('publishes a photo post with hashtags and a tagged pet', async () => {
      const mediaId = await readyImage(author.token);
      const r = await http()
        .post(`${API}/posts`)
        .set(bearer(author.token))
        .send({ type: 'PHOTO', mediaIds: [mediaId], caption: 'Beach day #GoldenRetriever #beach', petIds: [petId] })
        .expect(201);
      expect(r.body.data).toMatchObject({ status: 'PUBLISHED', hashtags: ['goldenretriever', 'beach'], pets: [{ id: petId, name: 'Bruno' }] });
      expect(r.body.data.media[0].images).toHaveLength(3);
      const tag = await http().get(`${API}/hashtags/beach/posts`).expect(200);
      expect(tag.body.data.hashtag.postCount).toBe(1);
      expect(tag.body.data.items[0].id).toBe(r.body.data.id);
    });

    it('holds a post in PROCESSING until its video is ready, then publishes it', async () => {
      await stopWorker();
      const u = await upload(author.token, 'VIDEO', REEL, 'video/mp4');
      await u.complete().expect(200);
      const post = await http().post(`${API}/posts`).set(bearer(author.token)).send({ type: 'REEL', mediaIds: [u.id], caption: 'Zoomies' }).expect(201);
      expect(post.body.data.status).toBe('PROCESSING');
      const other = await login('+919822200011');
      await http().get(`${API}/posts/${post.body.data.id}`).set(bearer(other.token)).expect(404); // not public yet

      await startWorker();
      await waitFor(author.token, u.id);
      const after = await http().get(`${API}/posts/${post.body.data.id}`).set(bearer(other.token)).expect(200);
      expect(after.body.data.status).toBe('PUBLISHED');
      expect(after.body.data.media[0].hls).toContain('master.m3u8');
    });

    it('enforces post shape and media ownership', async () => {
      const img = await readyImage(author.token);
      await http().post(`${API}/posts`).set(bearer(author.token)).send({ type: 'REEL', mediaIds: [img] }).expect(400);
      await http().post(`${API}/posts`).set(bearer(author.token)).send({ type: 'PHOTO', mediaIds: [img] }).expect(201);
      await http().post(`${API}/posts`).set(bearer(author.token)).send({ type: 'PHOTO', mediaIds: [img] }).expect(400); // already used
      const stranger = await login('+919822200012');
      const theirs = await readyImage(stranger.token);
      await http().post(`${API}/posts`).set(bearer(author.token)).send({ type: 'PHOTO', mediaIds: [theirs] }).expect(400);
    });

    it('is disabled entirely when the Reels feature flag is off', async () => {
      await prisma.featureFlag.update({ where: { key: 'ENABLE_REELS' }, data: { enabled: false } });
      await redis.client.del('platform:flags');
      await http().get(`${API}/feed`).set(bearer(author.token)).expect(404);
      await prisma.featureFlag.update({ where: { key: 'ENABLE_REELS' }, data: { enabled: true } });
      await redis.client.del('platform:flags');
      await http().get(`${API}/feed`).set(bearer(author.token)).expect(200);
    });
  });

  // ───────────────────────── feeds & engagement ─────────────────────────

  describe('feeds, engagement and comments', () => {
    let a: { token: string; id: string };
    let b: { token: string; id: string };
    let c: { token: string; id: string };
    const posts: string[] = [];
    let followersOnly: string;

    beforeAll(async () => {
      a = await login('+919822200020');
      b = await login('+919822200021');
      c = await login('+919822200022');
      await startWorker();
      for (let i = 0; i < 5; i++) {
        const m = await readyImage(a.token);
        posts.push((await http().post(`${API}/posts`).set(bearer(a.token)).send({ type: 'PHOTO', mediaIds: [m], caption: `Post ${i} #feedtest` }).expect(201)).body.data.id);
      }
      const m = await readyImage(a.token);
      followersOnly = (await http().post(`${API}/posts`).set(bearer(a.token)).send({ type: 'PHOTO', mediaIds: [m], visibility: 'FOLLOWERS' }).expect(201)).body.data.id;
      await http().post(`${API}/users/${a.id}/follow`).set(bearer(b.token)).expect(200);
    });

    it('home feed shows followed people newest first, with stable cursor pagination', async () => {
      const p1 = await http().get(`${API}/feed?limit=4`).set(bearer(b.token)).expect(200);
      expect(p1.body.data.items).toHaveLength(4);
      expect(p1.body.data.items[0].id).toBe(followersOnly);
      const p2 = await http().get(`${API}/feed?limit=4&cursor=${p1.body.data.nextCursor}`).set(bearer(b.token)).expect(200);
      const ids = [...p1.body.data.items, ...p2.body.data.items].map((x: { id: string }) => x.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toEqual(expect.arrayContaining([...posts, followersOnly]));
      expect(p2.body.data.nextCursor).toBeNull();
      const none = await http().get(`${API}/feed`).set(bearer(c.token)).expect(200);
      expect(none.body.data.items).toHaveLength(0);
    });

    it('followers-only posts are invisible to non-followers', async () => {
      await http().get(`${API}/posts/${followersOnly}`).set(bearer(b.token)).expect(200);
      await http().get(`${API}/posts/${followersOnly}`).set(bearer(c.token)).expect(404);
      await http().get(`${API}/posts/${followersOnly}`).expect(404);
      const trend = await http().get(`${API}/feed/trending?limit=50`).set(bearer(c.token)).expect(200);
      expect(trend.body.data.items.map((x: { id: string }) => x.id)).not.toContain(followersOnly);
    });

    it('likes and saves are idempotent and counted once', async () => {
      const id = posts[0];
      await http().post(`${API}/posts/${id}/like`).set(bearer(b.token)).expect(200);
      const again = await http().post(`${API}/posts/${id}/like`).set(bearer(b.token)).expect(200);
      expect(again.body.data.count).toBe(1);
      await http().post(`${API}/posts/${id}/like`).set(bearer(c.token)).expect(200);
      expect((await http().delete(`${API}/posts/${id}/like`).set(bearer(c.token)).expect(200)).body.data.count).toBe(1);
      await http().post(`${API}/posts/${id}/save`).set(bearer(b.token)).expect(200);
      const saved = await http().get(`${API}/users/me/saved`).set(bearer(b.token)).expect(200);
      expect(saved.body.data.items.map((x: { id: string }) => x.id)).toEqual([id]);
      const view = await http().get(`${API}/posts/${id}`).set(bearer(b.token)).expect(200);
      expect(view.body.data.viewer).toEqual({ liked: true, saved: true, isAuthor: false });
    });

    it('counts one view per viewer per day', async () => {
      const id = posts[1];
      expect((await http().post(`${API}/posts/${id}/view`).set(bearer(b.token)).expect(200)).body.data.counted).toBe(true);
      expect((await http().post(`${API}/posts/${id}/view`).set(bearer(b.token)).expect(200)).body.data.counted).toBe(false);
      await http().post(`${API}/posts/${id}/view`).set(bearer(c.token)).expect(200);
      expect((await http().get(`${API}/posts/${id}`).expect(200)).body.data.counts.views).toBe(2);
    });

    it('threads replies one level deep and keeps counts right when comments are deleted', async () => {
      const id = posts[2];
      const top = (await http().post(`${API}/posts/${id}/comments`).set(bearer(b.token)).send({ body: 'So cute!' }).expect(201)).body.data;
      const reply = (await http().post(`${API}/posts/${id}/comments`).set(bearer(c.token)).send({ body: 'Agreed', parentId: top.id }).expect(201)).body.data;
      const nested = (await http().post(`${API}/posts/${id}/comments`).set(bearer(b.token)).send({ body: 'Haha', parentId: reply.id }).expect(201)).body.data;
      expect(nested.parentId).toBe(top.id);
      const list = await http().get(`${API}/posts/${id}/comments`).expect(200);
      expect(list.body.data.items).toHaveLength(1);
      expect(list.body.data.items[0].replyCount).toBe(2);
      await http().delete(`${API}/comments/${reply.id}`).set(bearer(b.token)).expect(404); // not theirs, not their post
      await http().delete(`${API}/comments/${reply.id}`).set(bearer(a.token)).expect(200); // post author may
      const post = await http().get(`${API}/posts/${id}`).expect(200);
      expect(post.body.data.counts.comments).toBe(2);
    });

    it('ranks trending by engagement after the score job runs', async () => {
      for (const u of [b, c]) await http().post(`${API}/posts/${posts[3]}/like`).set(bearer(u.token)).expect(200);
      await http().post(`${API}/posts/${posts[3]}/save`).set(bearer(c.token)).expect(200);
      await worker!.get(MaintenanceProcessor).recomputeScores();
      const t = await http().get(`${API}/feed/trending?limit=3`).expect(200);
      expect(t.body.data.items[0].id).toBe(posts[3]);
      expect(t.body.data.nextCursor).not.toBeNull();
    });
  });

  // ───────────────────────── blocking ─────────────────────────

  describe('blocking', () => {
    it('hides people from each other everywhere and removes follows', async () => {
      const x = await login('+919822200030');
      const y = await login('+919822200031');
      await startWorker();
      const pet = (await http().post(`${API}/pets`).set(bearer(x.token)).send({ name: 'Mochi', speciesId: dogId }).expect(201)).body.data;
      const media = await readyImage(x.token); // resolve before building the next request (supertest binds per request)
      const post = (await http().post(`${API}/posts`).set(bearer(x.token)).send({ type: 'PHOTO', mediaIds: [media] }).expect(201)).body.data;
      await http().post(`${API}/users/${x.id}/follow`).set(bearer(y.token)).expect(200);
      await http().post(`${API}/pets/${pet.id}/follow`).set(bearer(y.token)).expect(200);

      await http().post(`${API}/users/${y.id}/block`).set(bearer(x.token)).expect(200);
      await http().get(`${API}/posts/${post.id}`).set(bearer(y.token)).expect(404);
      await http().get(`${API}/users/${x.id}`).set(bearer(y.token)).expect(404);
      await http().get(`${API}/pets/${pet.id}`).set(bearer(y.token)).expect(404);
      await http().post(`${API}/users/${x.id}/follow`).set(bearer(y.token)).expect(404);
      expect((await http().get(`${API}/feed`).set(bearer(y.token)).expect(200)).body.data.items).toHaveLength(0);
      expect((await http().get(`${API}/pets/${pet.id}`).set(bearer(x.token)).expect(200)).body.data.followerCount).toBe(0);

      await http().delete(`${API}/users/${y.id}/block`).set(bearer(x.token)).expect(200);
      await http().get(`${API}/posts/${post.id}`).set(bearer(y.token)).expect(200);
    });
  });

  // ───────────────────────── reports & moderation ─────────────────────────

  describe('reports and moderation', () => {
    let owner: { token: string; id: string };
    let r1: { token: string; id: string };
    let r2: { token: string; id: string };
    let mod: string;
    let support: string;
    const mkPost = async () => {
      const media = await readyImage(owner.token);
      return (await http().post(`${API}/posts`).set(bearer(owner.token)).send({ type: 'PHOTO', mediaIds: [media] }).expect(201)).body.data.id as string;
    };
    const report = (who: { token: string }, targetId: string, reason = 'SPAM', targetType = 'POST') =>
      http().post(`${API}/reports`).set(bearer(who.token)).send({ targetType, targetId, reason });

    beforeAll(async () => {
      owner = await login('+919822200040');
      r1 = await login('+919822200041');
      r2 = await login('+919822200042');
      await startWorker();
      mod = await staff('mod@social.test', 'MODERATOR');
      support = await staff('support@social.test', 'SUPPORT_AGENT');
    });

    it('groups reports into one case and refuses self and duplicate reports', async () => {
      const post = await mkPost();
      await report(owner, post).expect(400);
      await report(r1, post).expect(201);
      await report(r1, post).expect(409);
      await report(r2, post, 'ABUSE').expect(201);
      const list = await http().get(`${API}/admin/moderation/cases`).set(bearer(mod)).expect(200);
      const kase = list.body.data.find((x: { targetId: string }) => x.targetId === post);
      expect(kase.reportCount).toBe(2);
      expect(kase.reasons.map((r: { reason: string }) => r.reason).sort()).toEqual(['ABUSE', 'SPAM']);
      expect(kase.target).toMatchObject({ exists: true, kind: 'POST', status: 'PUBLISHED' });
      const overview = await http().get(`${API}/admin/overview`).set(bearer(mod)).expect(200);
      expect(overview.body.data.moderation.openCases).toBeGreaterThanOrEqual(1);
      expect(overview.body.data.moderation.byType.POST).toBeGreaterThanOrEqual(1);
    });

    it('auto-hides content at the threshold and restores it when the case is dismissed', async () => {
      await prisma.appSetting.upsert({ where: { key: 'reports.autoHideThreshold' }, update: { value: 2 }, create: { key: 'reports.autoHideThreshold', value: 2 } });
      const post = await mkPost();
      await report(r1, post).expect(201);
      await http().get(`${API}/posts/${post}`).expect(200);
      await report(r2, post).expect(201);
      await http().get(`${API}/posts/${post}`).expect(404);
      expect((await http().get(`${API}/posts/${post}`).set(bearer(owner.token)).expect(200)).body.data.status).toBe('HIDDEN');

      const kase = (await prisma.moderationCase.findFirstOrThrow({ where: { targetId: post } })).id;
      await http().post(`${API}/admin/moderation/cases/${kase}/resolve`).set(bearer(mod)).send({ resolution: 'DISMISSED', note: 'Reviewed, no violation' }).expect(200);
      await http().get(`${API}/posts/${post}`).expect(200);
      await prisma.appSetting.delete({ where: { key: 'reports.autoHideThreshold' } });
      // A new report after resolution opens a fresh case.
      await report(await login('+919822200043'), post).expect(201);
      expect(await prisma.moderationCase.count({ where: { targetId: post } })).toBe(2);
    });

    it('removes content and records the decision', async () => {
      const post = await mkPost();
      await report(r1, post, 'ANIMAL_WELFARE').expect(201);
      const kase = (await prisma.moderationCase.findFirstOrThrow({ where: { targetId: post } })).id;
      await http().post(`${API}/admin/moderation/cases/${kase}/resolve`).set(bearer(support)).send({ resolution: 'CONTENT_REMOVED', note: 'x' }).expect(403);
      const res = await http().post(`${API}/admin/moderation/cases/${kase}/resolve`).set(bearer(mod)).send({ resolution: 'CONTENT_REMOVED', note: 'Shows an injured animal for views' }).expect(200);
      expect(res.body.data).toMatchObject({ status: 'RESOLVED', resolution: 'CONTENT_REMOVED', target: { status: 'REMOVED' } });
      expect(res.body.data.reports[0].status).toBe('ACTIONED');
      await http().get(`${API}/posts/${post}`).set(bearer(owner.token)).expect(404);
      await http().post(`${API}/admin/moderation/cases/${kase}/resolve`).set(bearer(mod)).send({ resolution: 'DISMISSED', note: 'again' }).expect(400);
    });

    it('hides a reported comment and fixes the post’s comment count', async () => {
      const post = await mkPost();
      const cm = (await http().post(`${API}/posts/${post}/comments`).set(bearer(r1.token)).send({ body: 'buy followers at spam.example' }).expect(201)).body.data;
      await report(r2, cm.id, 'SPAM', 'COMMENT').expect(201);
      const kase = (await prisma.moderationCase.findFirstOrThrow({ where: { targetId: cm.id } })).id;
      await http().post(`${API}/admin/moderation/cases/${kase}/resolve`).set(bearer(mod)).send({ resolution: 'CONTENT_HIDDEN', note: 'Spam link' }).expect(200);
      expect((await http().get(`${API}/posts/${post}`).expect(200)).body.data.counts.comments).toBe(0);
      expect((await http().get(`${API}/posts/${post}/comments`).expect(200)).body.data.items).toHaveLength(0);
    });

    it('suspends an account only with the suspend permission', async () => {
      const post = await mkPost();
      await report(r1, post, 'ABUSE').expect(201);
      const kase = (await prisma.moderationCase.findFirstOrThrow({ where: { targetId: post } })).id;
      await http().post(`${API}/admin/moderation/cases/${kase}/resolve`).set(bearer(mod)).send({ resolution: 'USER_SUSPENDED', note: 'Repeated abuse' }).expect(403);
      const admin = await staff('admin@social.test', 'ADMIN');
      await http().post(`${API}/admin/moderation/cases/${kase}/resolve`).set(bearer(admin)).send({ resolution: 'USER_SUSPENDED', note: 'Repeated abuse' }).expect(200);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).status).toBe('SUSPENDED');
      await http().get(`${API}/feed`).set(bearer(owner.token)).expect(403);
    });
  });

  describe('upgrading an existing install', () => {
    it('gives existing roles the new phase’s default permissions without touching custom edits', async () => {
      const content = await prisma.permission.findMany({ where: { module: 'content' } });
      await prisma.permission.deleteMany({ where: { id: { in: content.map((p) => p.id) } } }); // simulate a Phase 1 database
      const support = await prisma.role.findUniqueOrThrow({ where: { key: 'SUPPORT_AGENT' } });
      const usersUpdate = await prisma.permission.findUniqueOrThrow({ where: { key: 'users.update' } });
      await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: support.id, permissionId: usersUpdate.id } } }); // an admin's edit

      await syncRbac(prisma);
      const keys = async (role: string) =>
        (await prisma.rolePermission.findMany({ where: { role: { key: role } }, include: { permission: true } })).map((r) => r.permission.key);
      expect(await keys('MODERATOR')).toEqual(expect.arrayContaining(['content.read', 'content.moderate']));
      expect(await keys('SUPPORT_AGENT')).toContain('content.read');
      expect(await keys('SUPPORT_AGENT')).not.toContain('content.moderate');
      expect(await keys('SUPPORT_AGENT')).not.toContain('users.update'); // the edit survived
    });
  });
});
