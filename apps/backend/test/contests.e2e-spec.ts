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
import { FakePaymentProvider } from '../src/providers/payments/payment.provider';
import { syncRbac } from '../src/modules/rbac/rbac.seed';

const API = '/api/v1';
jest.setTimeout(120_000);

type User = { token: string; id: string };

describe('Contests (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  const inbox = new Map<string, string>();
  let dogId: string;
  let catId: string;
  let superAdmin: string;
  let admin: string;
  let judge: User;
  let outsiderJudge: User;
  let categoryId: string;

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const hours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

  async function resetThrottle() {
    const keys = await redis.client.keys('throttle:*');
    if (keys.length) await redis.client.del(...keys);
  }

  async function login(phone: string, opts: { ageDays?: number; role?: string } = {}): Promise<User> {
    await resetThrottle();
    await http().post(`${API}/auth/otp/request`).send({ phone }).expect(200);
    const r = await http().post(`${API}/auth/otp/verify`).send({ phone, code: inbox.get(phone) }).expect(200);
    const id = r.body.data.user.id as string;
    if (opts.ageDays) await prisma.user.update({ where: { id }, data: { createdAt: new Date(Date.now() - opts.ageDays * 86_400_000) } });
    if (opts.role) {
      const role = await prisma.role.findUniqueOrThrow({ where: { key: opts.role } });
      await prisma.userRole.create({ data: { userId: id, roleId: role.id } });
    }
    return { token: r.body.data.tokens.accessToken, id };
  }

  async function staff(email: string, role: string) {
    const r = await prisma.role.findUniqueOrThrow({ where: { key: role } });
    await prisma.user.create({ data: { email, passwordHash: await bcrypt.hash('Staff-Password-1', 10), roles: { create: [{ roleId: r.id }] } } });
    await resetThrottle();
    return (await http().post(`${API}/admin/auth/login`).send({ email, password: 'Staff-Password-1' }).expect(200)).body.data.tokens.accessToken as string;
  }

  const pet = async (u: User, name: string, speciesId = dogId) =>
    (await http().post(`${API}/pets`).set(bearer(u.token)).send({ name, speciesId }).expect(201)).body.data.id as string;

  const finance = { prizePoolPct: 60, platformFeePct: 20, gatewayPct: 2, gstOnPlatformFeePct: 18, promotionPct: 4.4, refundReservePct: 5, judgeFeesPaise: 50_000 };

  function webhook(body: object, eventId: string, signature?: string) {
    const raw = JSON.stringify(body);
    return http()
      .post(`${API}/webhooks/payments`)
      .set('Content-Type', 'application/json')
      .set('x-razorpay-event-id', eventId)
      .set('x-razorpay-signature', signature ?? FakePaymentProvider.signWebhook(raw))
      .send(raw);
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
    for (const key of ['ENABLE_CONTESTS', 'ENABLE_REELS']) await prisma.featureFlag.create({ data: { key, enabled: true } });
    dogId = (await prisma.petSpecies.create({ data: { key: 'dog', name: 'Dog' } })).id;
    catId = (await prisma.petSpecies.create({ data: { key: 'cat', name: 'Cat' } })).id;
    superAdmin = await staff('root@contests.test', 'SUPER_ADMIN');
    admin = await staff('admin@contests.test', 'ADMIN');
    judge = await login('+919866600001', { role: 'JUDGE' });
    outsiderJudge = await login('+919866600002', { role: 'JUDGE' });
    categoryId = (await http().post(`${API}/admin/contest-categories`).set(bearer(admin)).send({ key: 'best-groomed', name: 'Best Groomed Pet', group: 'BEAUTY' }).expect(201)).body.data.id;
  });

  beforeEach(resetThrottle);
  afterAll(() => app.close());

  describe('a paid contest from draft to completed', () => {
    let contestId: string;
    let tasks: Array<{ id: string; type: string }>;
    let criteria: Array<{ id: string; name: string }>;
    const owners: User[] = [];
    const entries: string[] = [];

    it('builds a draft and refuses review until it is complete', async () => {
      const r = await http()
        .post(`${API}/admin/contests`)
        .set(bearer(admin))
        .send({
          title: 'Monsoon Glam Pet 2026', description: 'Show us your best-groomed pet this monsoon.', categoryId, feePaise: 199_00,
          minParticipants: 2, maxParticipants: 3, publicWeight: 40, votesPerUserPerDay: 1, eligibleSpeciesIds: [dogId],
          registrationOpensAt: hours(-1), registrationClosesAt: hours(1), submissionClosesAt: hours(2), votingClosesAt: hours(3), finance,
          tasks: [{ type: 'POST', title: 'Post a grooming photo' }, { type: 'TEXT', title: 'Your grooming routine in one line' }],
        })
        .expect(201);
      contestId = r.body.data.id;
      expect(r.body.data.status).toBe('DRAFT');
      expect(r.body.data.readiness).toEqual(expect.arrayContaining(['Add at least one prize.', 'Judges decide part of the score: assign at least one judge.', 'Add judging criteria.']));
      const refused = await http().post(`${API}/admin/contests/${contestId}/transition`).set(bearer(admin)).send({ to: 'REVIEW' }).expect(400);
      expect(refused.body.errors.length).toBeGreaterThanOrEqual(3);

      await http().patch(`${API}/admin/contests/${contestId}`).set(bearer(admin)).send({ judgeIds: [judge.id, judge.id] }).expect(200);
      const notJudge = await login('+919866600099'); // resolve before building the next request
      await http().patch(`${API}/admin/contests/${contestId}`).set(bearer(admin)).send({ judgeIds: [notJudge.id] }).expect(400); // not a judge
      const done = await http()
        .patch(`${API}/admin/contests/${contestId}`)
        .set(bearer(admin))
        .send({
          criteria: [{ name: 'Grooming', weight: 60 }, { name: 'Presentation', weight: 40 }],
          prizes: [{ rank: 1, title: '1st prize', kind: 'CASH', amountPaise: 3000_00 }, { rank: 2, title: '2nd prize', kind: 'VOUCHER' }, { title: 'Best Coat', kind: 'PRODUCT' }],
        })
        .expect(200);
      expect(done.body.data.readiness).toEqual([]);
      tasks = done.body.data.tasks;
      criteria = done.body.data.criteria;
      expect(done.body.data.money.atMaximum).toMatchObject({ grossPaise: 597_00 });
    });

    it('shows the money split at any size — the spec’s 100 × ₹100 example', async () => {
      const other = await http()
        .post(`${API}/admin/contests`)
        .set(bearer(admin))
        .send({ title: 'Finance preview', description: 'Preview of the money split.', feePaise: 100_00, publicWeight: 100, registrationOpensAt: hours(1), registrationClosesAt: hours(2), submissionClosesAt: hours(3), votingClosesAt: hours(4), finance })
        .expect(201);
      const f = await http().get(`${API}/admin/contests/${other.body.data.id}/finance/100`).set(bearer(admin)).expect(200);
      expect(f.body.data).toMatchObject({ grossPaise: 10_000_00, prizePoolPaise: 6000_00, platformFeePaise: 2000_00, gstPaise: 360_00, unallocatedPaise: 0, balanced: true });
    });

    it('needs a legal review — by a super admin — before a paid contest can go live', async () => {
      await http().post(`${API}/admin/contests/${contestId}/transition`).set(bearer(admin)).send({ to: 'REVIEW' }).expect(200);
      await http().post(`${API}/admin/contests/${contestId}/transition`).set(bearer(admin)).send({ to: 'SCHEDULED' }).expect(200);
      const blocked = await http().post(`${API}/admin/contests/${contestId}/transition`).set(bearer(admin)).send({ to: 'LIVE' }).expect(400);
      expect(blocked.body.message).toMatch(/legal review/);
      await http().post(`${API}/admin/contests/${contestId}/legal-approval`).set(bearer(admin)).send({ note: 'Counsel opinion ref LGL-2026-014' }).expect(403);
      await http().post(`${API}/admin/contests/${contestId}/legal-approval`).set(bearer(superAdmin)).send({ note: 'Counsel opinion ref LGL-2026-014' }).expect(200);
      await http().post(`${API}/admin/contests/${contestId}/transition`).set(bearer(admin)).send({ to: 'LIVE' }).expect(200);
      await http().post(`${API}/admin/contests/${contestId}/transition`).set(bearer(admin)).send({ to: 'COMPLETED' }).expect(400); // not a valid jump
    });

    it('registers through a verified payment only — signatures, webhooks, amounts and duplicates all checked', async () => {
      const u = await login('+919866600010', { ageDays: 60 });
      owners.push(u);
      const pid = await pet(u, 'Bruno');
      const r = await http().post(`${API}/contests/${contestId}/register`).set(bearer(u.token)).send({ petId: pid }).expect(201);
      expect(r.body.data).toMatchObject({ status: 'PENDING_PAYMENT', payment: { amountPaise: 199_00, provider: 'fake', status: 'CREATED' } });
      const pay = r.body.data.payment;
      entries.push(r.body.data.entryId);
      // Asking again returns the same order (no double charge).
      expect((await http().post(`${API}/contests/${contestId}/register`).set(bearer(u.token)).send({ petId: pid }).expect(201)).body.data.payment.orderId).toBe(pay.orderId);

      // The app claiming success with a made-up signature is refused.
      await http().post(`${API}/payments/${pay.paymentId}/verify`).set(bearer(u.token)).send({ providerPaymentId: 'pay_fake123', signature: 'ab'.repeat(32) }).expect(400);
      // Webhooks: bad signature, then a valid one with the wrong amount.
      const captured = (amount: number) => ({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_live_1', order_id: pay.orderId, amount } } } });
      await webhook(captured(199_00), 'evt_bad', 'ab'.repeat(32)).expect(400);
      expect((await webhook(captured(1_00), 'evt_wrong_amount').expect(200)).body.data.status).toBe('amount_mismatch');
      expect((await prisma.contestParticipant.findUniqueOrThrow({ where: { id: entries[0] } })).status).toBe('PENDING_PAYMENT');

      // A genuine checkout signature completes it; webhook redelivery changes nothing.
      const { paymentId, signature } = FakePaymentProvider.checkout(pay.orderId);
      expect((await http().post(`${API}/payments/${pay.paymentId}/verify`).set(bearer(u.token)).send({ providerPaymentId: paymentId, signature }).expect(200)).body.data.status).toBe('CAPTURED');
      expect((await webhook(captured(199_00), 'evt_ok').expect(200)).body.data.status).toBe('captured');
      expect((await webhook(captured(199_00), 'evt_ok').expect(200)).body.data.status).toBe('duplicate');
      expect((await prisma.contestParticipant.findUniqueOrThrow({ where: { id: entries[0] } })).status).toBe('REGISTERED');
      expect(await prisma.payment.count({ where: { referenceId: contestId, status: 'CAPTURED' } })).toBe(1);

      const again = await http().get(`${API}/contests/${contestId}`).set(bearer(u.token)).expect(200);
      expect(again.body.data.viewer.entries[0]).toMatchObject({ status: 'REGISTERED', payment: null });
    });

    it('enforces eligibility, ownership and capacity (the last place can’t be sold twice)', async () => {
      const u = owners[0];
      const petArg1 = await pet(u, 'Mishti', catId);
      await http().post(`${API}/contests/${contestId}/register`).set(bearer(u.token)).send({ petId: petArg1 }).expect(400); // cats not eligible
      const other = await login('+919866600011', { ageDays: 60 });
      const petArg2 = await pet(u, 'NotYours');
      await http().post(`${API}/contests/${contestId}/register`).set(bearer(other.token)).send({ petId: petArg2 }).expect(404);

      for (const [phone, name] of [['+919866600012', 'Luna'], ['+919866600013', 'Simba']] as const) {
        const o = await login(phone, { ageDays: 60 });
        owners.push(o);
        const petArg3 = await pet(o, name);
        const r = await http().post(`${API}/contests/${contestId}/register`).set(bearer(o.token)).send({ petId: petArg3 }).expect(201);
        entries.push(r.body.data.entryId);
        await http().post(`${API}/payments/${r.body.data.payment.paymentId}/simulate`).set(bearer(o.token)).expect(200);
      }
      const late = await login('+919866600014', { ageDays: 60 });
      const petArg4 = await pet(late, 'Oreo');
      expect((await http().post(`${API}/contests/${contestId}/register`).set(bearer(late.token)).send({ petId: petArg4 }).expect(400)).body.message).toBe('This contest is full.');
    });

    it('takes submissions: your own published post for POST tasks, text for TEXT tasks', async () => {
      const postTask = tasks.find((t) => t.type === 'POST')!;
      const textTask = tasks.find((t) => t.type === 'TEXT')!;
      const posts: string[] = [];
      for (const [i, o] of owners.entries()) {
        const media = await prisma.mediaAsset.create({ data: { ownerId: o.id, kind: 'IMAGE', mimeType: 'image/jpeg', sizeBytes: 1, storageKey: `uploads/${o.id}/${i}`, status: 'READY', variants: {} } });
        posts.push((await prisma.post.create({ data: { authorId: o.id, type: 'PHOTO', status: 'PUBLISHED', publishedAt: new Date(), media: { create: { mediaId: media.id, position: 0 } } } })).id);
      }
      await http().post(`${API}/contest-entries/${entries[0]}/submissions`).set(bearer(owners[1].token)).send({ taskId: postTask.id, postId: posts[1] }).expect(404); // not their entry
      await http().post(`${API}/contest-entries/${entries[0]}/submissions`).set(bearer(owners[0].token)).send({ taskId: postTask.id, postId: posts[1] }).expect(400); // someone else's post
      await http().post(`${API}/contest-entries/${entries[0]}/submissions`).set(bearer(owners[0].token)).send({ taskId: textTask.id }).expect(400); // TEXT task needs text
      // A reel still transcoding: said in words people can act on (spec §85), and accepted once it's live.
      const v = await prisma.mediaAsset.create({ data: { ownerId: owners[0].id, kind: 'VIDEO', mimeType: 'video/mp4', sizeBytes: 1, storageKey: `uploads/${owners[0].id}/v`, status: 'PROCESSING', variants: {} } });
      const reel = await prisma.post.create({ data: { authorId: owners[0].id, type: 'REEL', status: 'PROCESSING', media: { create: { mediaId: v.id, position: 0 } } } });
      expect((await http().post(`${API}/contest-entries/${entries[0]}/submissions`).set(bearer(owners[0].token)).send({ taskId: postTask.id, postId: reel.id }).expect(400)).body.message).toMatch(/^Your video is still being processed/);
      await prisma.post.delete({ where: { id: reel.id } });
      for (const [i, o] of owners.entries()) {
        const r1 = await http().post(`${API}/contest-entries/${entries[i]}/submissions`).set(bearer(o.token)).send({ taskId: postTask.id, postId: posts[i] }).expect(201);
        expect(r1.body.data.status).toBe('REGISTERED');
        const r2 = await http().post(`${API}/contest-entries/${entries[i]}/submissions`).set(bearer(o.token)).send({ taskId: textTask.id, text: 'Weekly bath, daily brushing.' }).expect(201);
        expect(r2.body.data).toMatchObject({ status: 'SUBMITTED', completedTasks: 2, requiredTasks: 2 });
      }
      await http().post(`${API}/admin/contests/${contestId}/transition`).set(bearer(admin)).send({ to: 'VOTING' }).expect(200);
    });

    it('counts public votes with daily limits and holds back risky ones until reviewed', async () => {
      const voteFor = (u: User, i: number) => http().post(`${API}/contest-entries/${entries[i]}/vote`).set(bearer(u.token));
      const fan = await login('+919866600020', { ageDays: 90 });
      await voteFor(fan, 0).expect(404); // public voting switched off
      await prisma.featureFlag.create({ data: { key: 'ENABLE_PUBLIC_VOTING', enabled: true } });
      await redis.client.del('platform:flags');

      await voteFor(owners[0], 0).expect(400); // own entry
      expect((await voteFor(fan, 0).expect(200)).body.data).toEqual({ voted: true, votesLeftToday: 0 });
      expect((await voteFor(fan, 1).expect(400)).body.message).toMatch(/today’s vote/);
      for (const phone of ['+919866600021', '+919866600022']) await voteFor(await login(phone, { ageDays: 90 }), 0).expect(200);
      await voteFor(await login('+919866600023', { ageDays: 90 }), 1).expect(200);

      // A brand-new account's vote is accepted silently but doesn't count yet.
      const fresh = await login('+919866600024');
      expect((await voteFor(fresh, 1).expect(200)).body.data.voted).toBe(true);
      const flagged = await http().get(`${API}/admin/contests/${contestId}/flagged-votes`).set(bearer(admin)).expect(200);
      expect(flagged.body.data).toHaveLength(1);
      expect(flagged.body.data[0].riskReasons).toEqual(['account_under_24h', 'joined_after_contest_opened']);
      let board = (await http().get(`${API}/contests/${contestId}/leaderboard`).expect(200)).body.data.rows;
      expect(board.find((r: { entryId: string }) => r.entryId === entries[1]).votes).toBe(1);
      await http().post(`${API}/admin/contest-votes/${flagged.body.data[0].id}/review`).set(bearer(admin)).send({ valid: true }).expect(200);
      board = (await http().get(`${API}/contests/${contestId}/leaderboard`).expect(200)).body.data.rows;
      expect(board.find((r: { entryId: string }) => r.entryId === entries[1]).votes).toBe(2);
    });

    it('lets assigned judges score with weighted criteria, and only them', async () => {
      await http().get(`${API}/judge/contests/${contestId}/entries`).set(bearer(outsiderJudge.token)).expect(403);
      const mine = await http().get(`${API}/judge/contests`).set(bearer(judge.token)).expect(200);
      expect(mine.body.data[0]).toMatchObject({ id: contestId, entries: 3 });
      const [grooming, presentation] = [criteria.find((c) => c.name === 'Grooming')!, criteria.find((c) => c.name === 'Presentation')!];
      const score = (i: number, g: number, p: number) =>
        http().put(`${API}/judge/contest-entries/${entries[i]}/scores`).set(bearer(judge.token)).send({ scores: [{ criterionId: grooming.id, score: g }, { criterionId: presentation.id, score: p }] });
      await score(0, 11, 5).expect(400);
      expect((await score(0, 5, 5).expect(200)).body.data.myScore).toBe(5);
      expect((await score(1, 10, 10).expect(200)).body.data.myScore).toBe(10);
      expect((await score(2, 9, 4).expect(200)).body.data.myScore).toBe(7); // 9×0.6 + 4×0.4

      // votes: entry0=3, entry1=2, entry2=0 → combined = 0.4·voteScore + 0.6·judge×10
      const rows = (await http().get(`${API}/contests/${contestId}/leaderboard`).expect(200)).body.data.rows;
      expect(rows.map((r: { entryId: string; combined: number }) => [entries.indexOf(r.entryId), r.combined])).toEqual([[1, 86.67], [0, 70], [2, 42]]);
    });

    it('freezes the ranking, declares winners from it, and completes', async () => {
      await http().post(`${API}/admin/contests/${contestId}/freeze`).set(bearer(admin)).expect(400); // still voting
      await http().post(`${API}/admin/contests/${contestId}/transition`).set(bearer(admin)).send({ to: 'EVALUATION' }).expect(200);
      await http().post(`${API}/admin/contests/${contestId}/transition`).set(bearer(admin)).send({ to: 'WINNER_DECLARATION' }).expect(400); // not frozen
      await http().post(`${API}/admin/contests/${contestId}/freeze`).set(bearer(admin)).expect(200);
      await http().put(`${API}/judge/contest-entries/${entries[2]}/scores`).set(bearer(judge.token)).send({ scores: [{ criterionId: criteria[0].id, score: 10 }] }).expect(400); // closed

      await http().post(`${API}/admin/contests/${contestId}/transition`).set(bearer(admin)).send({ to: 'WINNER_DECLARATION' }).expect(200);
      const w = await http().post(`${API}/admin/contests/${contestId}/winners`).set(bearer(admin)).expect(200);
      expect(w.body.data.awarded).toEqual([{ prize: '1st prize', participantId: entries[1] }, { prize: '2nd prize', participantId: entries[0] }]);
      const special = await prisma.contestPrize.findFirstOrThrow({ where: { contestId, rank: null } });
      await http().post(`${API}/admin/contest-prizes/${special.id}/award`).set(bearer(admin)).send({ participantId: entries[2] }).expect(200);
      await http().post(`${API}/admin/contests/${contestId}/transition`).set(bearer(admin)).send({ to: 'COMPLETED' }).expect(200);

      const board = (await http().get(`${API}/contests/${contestId}/leaderboard`).expect(200)).body.data;
      expect(board.frozen).toBe(true);
      expect(board.rows[0]).toMatchObject({ rank: 1, entryId: entries[1], status: 'WINNER' });
      expect(await prisma.contestPrize.count({ where: { contestId, payoutStatus: 'PENDING' } })).toBe(3);
      const audit = await prisma.auditLog.findMany({ where: { entityId: contestId }, select: { action: true } });
      expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['contest.create', 'contest.legal_approval', 'contest.transition', 'contest.freeze', 'contest.winners']));
    });
  });

  it('cancelling a paid contest queues refunds and withdraws every entry', async () => {
    const c = await http()
      .post(`${API}/admin/contests`)
      .set(bearer(admin))
      .send({
        title: 'Cancelled contest', description: 'This one gets cancelled.', feePaise: 99_00, publicWeight: 100, finance,
        registrationOpensAt: hours(-1), registrationClosesAt: hours(1), submissionClosesAt: hours(2), votingClosesAt: hours(3),
        tasks: [{ type: 'TEXT', title: 'Say hi' }], prizes: [{ rank: 1, title: 'Winner', kind: 'VOUCHER' }],
      })
      .expect(201);
    const id = c.body.data.id;
    for (const to of ['REVIEW', 'SCHEDULED']) await http().post(`${API}/admin/contests/${id}/transition`).set(bearer(admin)).send({ to }).expect(200);
    await http().post(`${API}/admin/contests/${id}/legal-approval`).set(bearer(superAdmin)).send({ note: 'Counsel opinion ref LGL-2026-015' }).expect(200);
    await http().post(`${API}/admin/contests/${id}/transition`).set(bearer(admin)).send({ to: 'LIVE' }).expect(200);
    const u = await login('+919866600030', { ageDays: 30 });
    const petArg5 = await pet(u, 'Pixel');
    const r = await http().post(`${API}/contests/${id}/register`).set(bearer(u.token)).send({ petId: petArg5 }).expect(201);
    await http().post(`${API}/payments/${r.body.data.payment.paymentId}/simulate`).set(bearer(u.token)).expect(200);

    await http().post(`${API}/admin/contests/${id}/transition`).set(bearer(admin)).send({ to: 'CANCELLED' }).expect(400); // reason required
    await http().post(`${API}/admin/contests/${id}/transition`).set(bearer(admin)).send({ to: 'CANCELLED', reason: 'Sponsor withdrew' }).expect(200);
    expect(await prisma.payment.findFirstOrThrow({ where: { referenceId: id } })).toMatchObject({ status: 'REFUND_PENDING' });
    expect(await prisma.contestParticipant.findFirstOrThrow({ where: { contestId: id } })).toMatchObject({ status: 'WITHDRAWN', statusReason: 'Contest cancelled: Sponsor withdrew' });
    const pub = await http().get(`${API}/contests/${id}`).expect(200);
    expect(pub.body.data).toMatchObject({ status: 'CANCELLED', cancelReason: 'Sponsor withdrew' });
  });

  it('free contests register instantly; drafts stay private; the flag hides everything', async () => {
    const c = await http()
      .post(`${API}/admin/contests`)
      .set(bearer(admin))
      .send({ title: 'Free fun', description: 'A free contest for fun.', feePaise: 0, publicWeight: 100, registrationOpensAt: hours(-1), registrationClosesAt: hours(1), submissionClosesAt: hours(2), votingClosesAt: hours(3), tasks: [{ type: 'TEXT', title: 'Say hello' }], prizes: [{ rank: 1, title: 'Badge', kind: 'SPONSORED' }] })
      .expect(201);
    const id = c.body.data.id;
    await http().get(`${API}/contests/${id}`).expect(404); // draft
    for (const to of ['REVIEW', 'SCHEDULED', 'LIVE']) await http().post(`${API}/admin/contests/${id}/transition`).set(bearer(admin)).send({ to }).expect(200);
    const u = await login('+919866600040');
    const petArg6 = await pet(u, 'Kiwi');
    expect((await http().post(`${API}/contests/${id}/register`).set(bearer(u.token)).send({ petId: petArg6 }).expect(201)).body.data).toMatchObject({ status: 'REGISTERED', payment: null });
    const live = await http().get(`${API}/contests?when=live`).expect(200);
    expect(live.body.data.map((x: { id: string }) => x.id)).toContain(id);

    await prisma.featureFlag.update({ where: { key: 'ENABLE_CONTESTS' }, data: { enabled: false } });
    await redis.client.del('platform:flags');
    await http().get(`${API}/contests`).expect(404);
    await prisma.featureFlag.update({ where: { key: 'ENABLE_CONTESTS' }, data: { enabled: true } });
    await redis.client.del('platform:flags');
  });
});
