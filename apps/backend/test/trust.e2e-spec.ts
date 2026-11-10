import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { SMS_PROVIDER, type SmsMessage } from '../src/providers/sms/sms.provider';
import { AI_PROVIDER, AiError, RulesAiProvider, type AiProvider, type ModerationInput } from '../src/providers/ai/ai.provider';
import { syncRbac } from '../src/modules/rbac/rbac.seed';
import { AiModerationService } from '../src/modules/trust/ai-moderation.service';
import { RiskService } from '../src/modules/trust/risk.service';
import { QueueService } from '../src/queue/queue.service';

const API = '/api/v1';
jest.setTimeout(120_000);

type User = { token: string; id: string };

/**
 * A scripted AI provider: "[spam90]" in the text scores SPAM 0.9, "[abuse75]" ABUSE 0.75, "[fail]" is an outage;
 * anything else goes to the built-in rules. It also records what it was sent.
 */
class ScriptedAi implements AiProvider {
  readonly name = 'scripted';
  readonly usesModel = true;
  readonly seen: ModerationInput[] = [];
  private readonly rules = new RulesAiProvider();
  async moderate(input: ModerationInput) {
    this.seen.push(input);
    if (input.text.includes('[fail]')) throw new AiError('provider overloaded', true);
    if (input.text.includes('[spam90]')) return { labels: [{ label: 'SPAM' as const, score: 0.9 }], reason: 'Selling followers to strangers.', model: 'scripted-1', version: 'test' };
    if (input.text.includes('[abuse75]')) return { labels: [{ label: 'ABUSE' as const, score: 0.75 }], reason: 'Insults another user.', model: 'scripted-1', version: 'test' };
    return this.rules.moderate(input);
  }
}

describe('Trust & safety (e2e): AI moderation assist and account risk', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let ai: AiModerationService;
  let risk: RiskService;
  const scripted = new ScriptedAi();
  const inbox = new Map<string, string>();
  let admin: string;
  let alice: User; // posts and comments
  let bob: User; // another member
  let postId: string;
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
    const u = { token: r.body.data.tokens.accessToken, id: r.body.data.user.id };
    await http().patch(`${API}/users/me`).set(bearer(u.token)).send({ name }).expect(200);
    return u;
  }
  const setting = (key: string, value: unknown, expect = 200) => http().put(`${API}/admin/settings/${key}`).set(bearer(admin)).send({ value }).expect(expect);
  const comment = async (u: User, body: string) => (await http().post(`${API}/posts/${postId}/comments`).set(bearer(u.token)).send({ body }).expect(201)).body.data.id as string;
  const photo = (ownerId: string, hash: string, createdAt = new Date()) =>
    prisma.mediaAsset.create({ data: { ownerId, kind: 'IMAGE', mimeType: 'image/jpeg', sizeBytes: 1000, storageKey: `uploads/${ownerId}/${randomUUID()}`, status: 'READY', variants: {}, perceptualHash: hash, createdAt } });
  const photoPost = async (authorId: string, mediaId: string, caption: string) =>
    prisma.post.create({ data: { authorId, type: 'PHOTO', caption, status: 'PUBLISHED', publishedAt: new Date(), media: { create: [{ mediaId, position: 0 }] } } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_PROVIDER)
      .useValue({ name: 'capture', send: async (m: SmsMessage) => (inbox.set(m.to, m.body.match(/\d{6}/)![0]), {}) })
      .overrideProvider(AI_PROVIDER)
      .useValue(scripted)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    ai = app.get(AiModerationService);
    risk = app.get(RiskService);
    await redis.client.flushdb();
    const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'spatial_ref_sys')`;
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
    await syncRbac(prisma);
    await prisma.featureFlag.createMany({ data: [{ key: 'ENABLE_REELS', enabled: true }, { key: 'ENABLE_CONTESTS', enabled: true }, { key: 'ENABLE_PUBLIC_VOTING', enabled: true }] });
    const superRole = await prisma.role.findUniqueOrThrow({ where: { key: 'SUPER_ADMIN' } });
    await prisma.user.create({ data: { email: 'root@trust.test', passwordHash: await bcrypt.hash('Root-Password-1', 10), roles: { create: [{ roleId: superRole.id }] } } });
    admin = (await http().post(`${API}/admin/auth/login`).send({ email: 'root@trust.test', password: 'Root-Password-1' }).expect(200)).body.data.tokens.accessToken;
    alice = await login('+919720000001', 'Alice Rao');
    bob = await login('+919720000002', 'Bob Nair');
    dog = (await prisma.petSpecies.create({ data: { key: 'dog', name: 'Dog' } })).id;
    const media = await photo(alice.id, 'a5a5a5a5a5a5a5a5');
    postId = (await photoPost(alice.id, media.id, 'Bruno at the beach')).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('an ordinary post is checked and cleared; nothing is opened and the same content isn’t checked twice', async () => {
    expect(await ai.assess('POST', postId)).toBe('clear');
    const [a] = await ai.history('POST', postId);
    expect(a).toMatchObject({ verdict: 'CLEAR', ownerId: alice.id, provider: 'scripted', model: 'petapp-rules', topLabel: null, confidence: 0 });
    expect(scripted.seen.at(-1)).toMatchObject({ kind: 'POST', context: 'photo post', text: 'Bruno at the beach' });
    expect(await ai.assess('POST', postId)).toBe('unchanged');
    expect(await prisma.moderationCase.count()).toBe(0);
  });

  it('posting a comment queues its check (and votes queue a risk rescore) through the job queue', async () => {
    const q = app.get(QueueService);
    const before = await q.trust.getJobCounts('delayed', 'waiting');
    const id = await comment(alice, 'What a good boy');
    const jobs = await q.trust.getJobs(['delayed', 'waiting']);
    expect(jobs.some((j) => j.data.kind === 'assess' && j.data.targetType === 'COMMENT' && j.data.targetId === id)).toBe(true);
    expect((await q.trust.getJobCounts('delayed', 'waiting')).delayed).toBeGreaterThan(before.delayed ?? 0);
    q.scoreRisk(bob.id);
    await new Promise((r) => setTimeout(r, 200));
    expect((await q.trust.getJobs(['delayed', 'waiting'])).some((j) => j.data.kind === 'risk' && j.data.userId === bob.id)).toBe(true);
  });

  it('a confident flag opens a case for a moderator with the result, confidence, reason, model and version; nothing is hidden', async () => {
    const id = await comment(bob, 'Get 10k followers cheap [spam90]');
    // Posting a comment queues a check; here it runs directly.
    expect(await ai.assess('COMMENT', id)).toBe('flagged');
    expect((await prisma.comment.findUniqueOrThrow({ where: { id } })).status).toBe('VISIBLE');
    const list = (await http().get(`${API}/admin/moderation/cases?source=ai`).set(bearer(admin)).expect(200)).body.data;
    const c = list.find((x: { targetId: string }) => x.targetId === id);
    expect(c).toMatchObject({ targetType: 'COMMENT', reportCount: 0, status: 'OPEN', ai: { verdict: 'FLAGGED', topLabel: 'SPAM', confidence: 0.9, reason: 'Selling followers to strangers.', provider: 'scripted', model: 'scripted-1', version: 'test' } });
    expect(c.aiFlaggedAt).toBeTruthy();
    const detail = (await http().get(`${API}/admin/moderation/cases/${c.id}`).set(bearer(admin)).expect(200)).body.data;
    expect(detail.aiHistory).toHaveLength(1);
    expect(detail.target).toMatchObject({ kind: 'COMMENT', body: 'Get 10k followers cheap [spam90]' });
    // People's reports join the same case.
    await http().post(`${API}/reports`).set(bearer(alice.token)).send({ targetType: 'COMMENT', targetId: id, reason: 'SPAM' }).expect(201);
    expect((await prisma.moderationCase.findUniqueOrThrow({ where: { id: c.id } })).reportCount).toBe(1);
    // A moderator decides.
    await http().post(`${API}/admin/moderation/cases/${c.id}/resolve`).set(bearer(admin)).send({ resolution: 'CONTENT_REMOVED', note: 'Follower selling' }).expect(200);
    expect((await prisma.comment.findUniqueOrThrow({ where: { id } })).status).toBe('REMOVED');
  });

  it('below the threshold the result is kept but no case opens; the threshold is a setting', async () => {
    const id = await comment(bob, 'You clearly know nothing [abuse75]');
    await setting('ai.flagPct', 80);
    expect(await ai.assess('COMMENT', id)).toBe('clear');
    expect((await ai.history('COMMENT', id))[0]).toMatchObject({ verdict: 'CLEAR', topLabel: 'ABUSE', confidence: 0.75 });
    expect(await prisma.moderationCase.count({ where: { targetId: id } })).toBe(0);
    await setting('ai.flagPct', 70);
    await setting('ai.flagPct', 101, 400);
    await setting('risk.reviewScore', 101, 400);
  });

  it('optional auto-hide while waiting for review is undone when the moderator dismisses the case', async () => {
    await setting('ai.autoHidePct', 85);
    const id = await comment(bob, 'DM for cheap followers [spam90]');
    expect(await ai.assess('COMMENT', id)).toBe('flagged');
    expect((await prisma.comment.findUniqueOrThrow({ where: { id } })).status).toBe('HIDDEN');
    const kase = await prisma.moderationCase.findFirstOrThrow({ where: { targetId: id, status: 'OPEN' } });
    await http().post(`${API}/admin/moderation/cases/${kase.id}/resolve`).set(bearer(admin)).send({ resolution: 'DISMISSED', note: 'A joke between friends' }).expect(200);
    expect((await prisma.comment.findUniqueOrThrow({ where: { id } })).status).toBe('VISIBLE');
    await setting('ai.autoHidePct', 0);
  });

  it('an outage is retried; after the last attempt the failure is recorded and the content stays up', async () => {
    const id = await comment(alice, 'Lovely photo [fail]');
    await expect(ai.assess('COMMENT', id)).rejects.toBeInstanceOf(AiError); // the queue will retry
    expect(await ai.history('COMMENT', id)).toHaveLength(0);
    expect(await ai.assess('COMMENT', id, { lastAttempt: true })).toBe('error');
    expect((await ai.history('COMMENT', id))[0]).toMatchObject({ verdict: 'ERROR', error: expect.stringContaining('overloaded'), model: 'unavailable' });
    expect((await prisma.comment.findUniqueOrThrow({ where: { id } })).status).toBe('VISIBLE');
  });

  it('switched off in settings, nothing is checked', async () => {
    await setting('ai.moderationEnabled', false);
    const id = await comment(alice, 'Followers for sale [spam90]');
    expect(await ai.assess('COMMENT', id)).toBe('disabled');
    await setting('ai.moderationEnabled', true);
  });

  it('a contest entry using someone else’s photo is flagged as suspicious; disqualifying happens on the contest page', async () => {
    // Bob uploads (a near copy of) Alice's photo later, and enters it in a contest.
    const copy = await photo(bob.id, 'a5a5a5a5a5a5a5a4');
    const post = await photoPost(bob.id, copy.id, 'My dog');
    const pet = await prisma.pet.create({ data: { ownerId: bob.id, speciesId: dog, name: 'Tiger', handle: `tiger${Date.now()}` } });
    const contest = await prisma.contest.create({ data: { slug: `c-${Date.now()}`, title: 'Best Smile', description: 'x', status: 'LIVE', registrationOpensAt: new Date(Date.now() - 86_400_000), registrationClosesAt: new Date(Date.now() + 86_400_000), submissionClosesAt: new Date(Date.now() + 2 * 86_400_000), votingClosesAt: new Date(Date.now() + 3 * 86_400_000), createdById: alice.id } });
    const task = await prisma.contestTask.create({ data: { contestId: contest.id, type: 'POST', title: 'Your best smile', position: 0 } });
    const entry = await prisma.contestParticipant.create({ data: { contestId: contest.id, userId: bob.id, petId: pet.id, status: 'SUBMITTED' } });
    await prisma.contestSubmission.create({ data: { participantId: entry.id, taskId: task.id, postId: post.id } });
    // The post itself only notes the copy (people repost); the contest entry is flagged.
    expect(await ai.assess('POST', post.id)).toBe('clear');
    expect((await ai.history('POST', post.id))[0]).toMatchObject({ topLabel: 'DUPLICATE', confidence: 0.6 });
    expect(await ai.assess('CONTEST_ENTRY', entry.id)).toBe('flagged');
    const [a] = await ai.history('CONTEST_ENTRY', entry.id);
    expect(a.labels).toEqual([{ label: 'DUPLICATE', score: 0.9 }, { label: 'SUSPICIOUS_ENTRY', score: 0.85 }]);
    expect(a.reason).toMatch(/uploaded earlier by someone else/);
    const kase = await prisma.moderationCase.findFirstOrThrow({ where: { targetType: 'CONTEST_ENTRY', targetId: entry.id } });
    const detail = (await http().get(`${API}/admin/moderation/cases/${kase.id}`).set(bearer(admin)).expect(200)).body.data;
    expect(detail.target).toMatchObject({ kind: 'CONTEST_ENTRY', name: 'Tiger', contest: { title: 'Best Smile' } });
    await http().post(`${API}/admin/moderation/cases/${kase.id}/resolve`).set(bearer(admin)).send({ resolution: 'CONTENT_REMOVED', note: 'Stolen photo' }).expect(400);
    await http().post(`${API}/admin/moderation/cases/${kase.id}/resolve`).set(bearer(admin)).send({ resolution: 'DISMISSED', note: 'Will disqualify from the contest page' }).expect(200);
    // Alice's original isn't a copy of anything.
    const original = await prisma.contestParticipant.create({ data: { contestId: contest.id, userId: alice.id, petId: (await prisma.pet.create({ data: { ownerId: alice.id, speciesId: dog, name: 'Bruno', handle: `bruno${Date.now()}` } })).id, status: 'SUBMITTED' } });
    await prisma.contestSubmission.create({ data: { participantId: original.id, taskId: task.id, postId } });
    expect(await ai.assess('CONTEST_ENTRY', original.id)).toBe('clear');
  });

  it('a flagged product listing is blocked with the moderator’s note when hidden; a report joins the AI case', async () => {
    const seller = await login('+919720000003', 'Sara Seller');
    const vendor = await prisma.vendor.create({ data: { userId: seller.id, businessName: 'Paws Mart', slug: `paws-${Date.now()}`, phone: '+919800000000', addressLine: '1 Road', city: 'Pune', state: 'Maharashtra', pincode: '411001', status: 'APPROVED' } });
    const cat = await prisma.productCategory.create({ data: { key: `toys-${Date.now()}`, name: 'Toys', commissionBps: 1000 } });
    const product = await prisma.product.create({ data: { vendorId: vendor.id, categoryId: cat.id, title: 'Rope toy', slug: `rope-${Date.now()}`, description: 'Buy followers here [spam90]', status: 'ACTIVE' } });
    expect(await ai.assess('PRODUCT', product.id)).toBe('flagged');
    expect(scripted.seen.at(-1)).toMatchObject({ kind: 'PRODUCT', context: 'product listing in the shop' });
    // Since Phase 9b people can report listings too; the report joins the open case.
    await http().post(`${API}/reports`).set(bearer(bob.token)).send({ targetType: 'PRODUCT', targetId: product.id, reason: 'SPAM' }).expect(201);
    const kase = await prisma.moderationCase.findFirstOrThrow({ where: { targetType: 'PRODUCT', targetId: product.id } });
    expect(kase.reportCount).toBe(1);
    const detail = (await http().get(`${API}/admin/moderation/cases/${kase.id}`).set(bearer(admin)).expect(200)).body.data;
    expect(detail.target).toMatchObject({ kind: 'PRODUCT', name: 'Rope toy', author: { name: 'Paws Mart' } });
    await http().post(`${API}/admin/moderation/cases/${kase.id}/resolve`).set(bearer(admin)).send({ resolution: 'CONTENT_HIDDEN', note: 'Listing advertises follower sales' }).expect(200);
    expect(await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ status: 'BLOCKED', blockReason: 'Listing advertises follower sales' });
  });

  it('staff can see the provider and re-check an item on demand; members can’t', async () => {
    const status = (await http().get(`${API}/admin/ai/status`).set(bearer(admin)).expect(200)).body.data;
    expect(status).toMatchObject({ provider: 'scripted', usesModel: true, enabled: true, flagPct: 70, autoHidePct: 0 });
    expect(status.last24h.FLAGGED).toBeGreaterThanOrEqual(3);
    const r = (await http().post(`${API}/admin/ai/assess`).set(bearer(admin)).send({ targetType: 'POST', targetId: postId }).expect(200)).body.data;
    expect(r).toMatchObject({ outcome: 'clear', assessment: { targetId: postId, verdict: 'CLEAR' } });
    const all = (await http().get(`${API}/admin/ai/assessments?verdict=FLAGGED`).set(bearer(admin)).expect(200)).body;
    expect(all.data.every((a: { verdict: string }) => a.verdict === 'FLAGGED')).toBe(true);
    await http().get(`${API}/admin/ai/status`).set(bearer(alice.token)).expect(403);
  });

  it('account risk: a vote ring on fresh accounts is listed for review; their votes are held until staff look; nobody is banned', async () => {
    const ring = await login('+919720000009', 'Ring Voter');
    // Signed in from the same public network as twelve other accounts this week.
    const others = await Promise.all(Array.from({ length: 12 }, (_, i) => prisma.user.create({ data: { phone: `+9197300000${String(i).padStart(2, '0')}`, phoneVerifiedAt: new Date() } })));
    const session = (userId: string) => ({ userId, familyId: randomUUID(), tokenHash: randomUUID(), audience: 'APP' as const, ipAddress: '49.36.10.4', expiresAt: new Date(Date.now() + 86_400_000) });
    await prisma.session.createMany({ data: [session(ring.id), ...others.map((o) => session(o.id))] });
    // Earlier held votes, and three copied photos.
    const contest = await prisma.contest.create({ data: { slug: `v-${Date.now()}`, title: 'Cutest Paws', description: 'x', status: 'VOTING', publicWeight: 100, votesPerUserPerDay: 5, registrationOpensAt: new Date(Date.now() - 5 * 86_400_000), registrationClosesAt: new Date(Date.now() - 3 * 86_400_000), submissionClosesAt: new Date(Date.now() - 2 * 86_400_000), votingClosesAt: new Date(Date.now() + 86_400_000), createdById: alice.id } });
    const entries = await Promise.all([alice, bob].map(async (u, i) => prisma.contestParticipant.create({ data: { contestId: contest.id, userId: u.id, petId: (await prisma.pet.create({ data: { ownerId: u.id, speciesId: dog, name: `P${i}`, handle: `p${i}${Date.now()}` } })).id, status: 'SUBMITTED' } })));
    for (let d = 1; d <= 4; d++) await prisma.contestVote.create({ data: { contestId: contest.id, participantId: entries[0].id, voterId: ring.id, voteDate: new Date(Date.now() - d * 86_400_000), flagged: true, riskScore: 60 } });
    for (const h of ['a5a5a5a5a5a5a5a5', 'a5a5a5a5a5a5a5a5', 'a5a5a5a5a5a5a5a5']) await photo(ring.id, h);

    const scored = await risk.score(ring.id);
    expect(scored).toMatchObject({ level: 'HIGH' });
    expect(scored!.score).toBe(15 + 35 + 15 + 30); // new account, shared network, held votes, copied photos
    const queue = (await http().get(`${API}/admin/risk`).set(bearer(admin)).expect(200)).body.data;
    expect(queue.map((r: { userId: string }) => r.userId)).toContain(ring.id);
    const detail = (await http().get(`${API}/admin/risk/${ring.id}`).set(bearer(admin)).expect(200)).body.data;
    expect(detail).toMatchObject({ needsReview: true, user: { name: 'Ring Voter', status: 'ACTIVE' } });
    expect(detail.signals[0]).toMatchObject({ signal: 'shared_network', points: 35, detail: expect.stringContaining('12 other accounts') });

    // Their vote is accepted but held (they aren't told).
    const v = await http().post(`${API}/contest-entries/${entries[1].id}/vote`).set(bearer(ring.token)).expect(200);
    expect(v.body.data.voted).toBe(true);
    const held = await prisma.contestVote.findFirstOrThrow({ where: { voterId: ring.id, participantId: entries[1].id } });
    expect(held).toMatchObject({ flagged: true });
    expect(held.riskReasons).toContain('account_under_review');

    // Staff look and record why it's fine; the account was never touched.
    await http().post(`${API}/admin/risk/${ring.id}/review`).set(bearer(alice.token)).send({ note: 'x'.repeat(5) }).expect(403);
    const reviewed = (await http().post(`${API}/admin/risk/${ring.id}/review`).set(bearer(admin)).send({ note: 'College hostel Wi-Fi; votes look genuine' }).expect(200)).body.data;
    expect(reviewed).toMatchObject({ needsReview: false, reviewedScore: scored!.score, reviewNote: 'College hostel Wi-Fi; votes look genuine', reviewedBy: { id: expect.any(String) } });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ring.id } })).status).toBe('ACTIVE');
    expect((await http().get(`${API}/admin/risk`).set(bearer(admin)).expect(200)).body.data.map((r: { userId: string }) => r.userId)).not.toContain(ring.id);
    expect((await http().get(`${API}/admin/risk?state=reviewed`).set(bearer(admin)).expect(200)).body.data.map((r: { userId: string }) => r.userId)).toContain(ring.id);
    // Reviewed: their next vote isn't held for this reason.
    await prisma.contestVote.deleteMany({ where: { voterId: ring.id, participantId: entries[1].id } });
    await http().post(`${API}/contest-entries/${entries[1].id}/vote`).set(bearer(ring.token)).expect(200);
    expect((await prisma.contestVote.findFirstOrThrow({ where: { voterId: ring.id, participantId: entries[1].id } })).riskReasons).not.toContain('account_under_review');
  });

  it('an ordinary member scores low, and private or local networks never count as shared', async () => {
    await prisma.session.createMany({ data: [alice.id, bob.id].map((userId) => ({ userId, familyId: randomUUID(), tokenHash: randomUUID(), audience: 'APP' as const, ipAddress: '127.0.0.1', expiresAt: new Date(Date.now() + 86_400_000) })) });
    await prisma.user.update({ where: { id: alice.id }, data: { createdAt: new Date(Date.now() - 400 * 86_400_000) } });
    const s = await risk.signals(alice.id);
    expect(s).toMatchObject({ sharedNetworkAccounts: 0, phoneVerified: true });
    expect((await risk.score(alice.id))!.level).toBe('LOW');
  });
});
