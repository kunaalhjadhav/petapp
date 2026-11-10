import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
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
import { indiaDay } from '../src/modules/challenges/challenge.rules';

const API = '/api/v1';
const DAY = 86_400_000;
jest.setTimeout(120_000);
type User = { token: string; id: string };

describe('Challenges, badges and contest notifications (e2e)', () => {
  let app: INestApplication;
  let worker: TestingModule;
  let prisma: PrismaService;
  let redis: RedisService;
  const inbox = new Map<string, string>();
  let admin: string;
  let badgeId: string;
  let dogId: string;

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const hours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
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

  /** Pretends the participant's check-ins happened one day earlier (instead of mocking the clock). */
  async function shiftBackOneDay(challengeId: string, userId: string) {
    const p = await prisma.challengeParticipant.findUniqueOrThrow({ where: { challengeId_userId: { challengeId, userId } } });
    await prisma.$executeRaw`UPDATE "ChallengeCheckIn" SET day = day - 1 WHERE "participantId" = ${p.id}::uuid`;
    await prisma.challengeParticipant.update({ where: { id: p.id }, data: { lastCheckInDay: new Date(p.lastCheckInDay!.getTime() - DAY) } });
  }

  async function notifications(u: User, type: string) {
    for (let i = 0; i < 60; i++) {
      const items = (await http().get(`${API}/notifications?limit=50`).set(bearer(u.token)).expect(200)).body.data.items as Array<{ type: string; title: string; body: string }>;
      const hit = items.filter((n) => n.type === type);
      if (hit.length) return hit;
      await new Promise((r) => setTimeout(r, 150));
    }
    return [];
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
    for (const key of ['ENABLE_CONTESTS', 'ENABLE_PUBLIC_VOTING']) await prisma.featureFlag.create({ data: { key, enabled: true } });
    dogId = (await prisma.petSpecies.create({ data: { key: 'dog', name: 'Dog' } })).id;
    const role = await prisma.role.findUniqueOrThrow({ where: { key: 'SUPER_ADMIN' } });
    await prisma.user.create({ data: { email: 'root@ch.test', passwordHash: await bcrypt.hash('Root-Password-1', 10), roles: { create: [{ roleId: role.id }] } } });
    admin = (await http().post(`${API}/admin/auth/login`).send({ email: 'root@ch.test', password: 'Root-Password-1' }).expect(200)).body.data.tokens.accessToken;
    badgeId = (await http().post(`${API}/admin/badges`).set(bearer(admin)).send({ key: 'walker-3', name: '3-Day Walker', description: 'Walked three days in a row.' }).expect(201)).body.data.id;

    worker = await Test.createTestingModule({ imports: [WorkerModule] }).overrideProvider(PUSH_PROVIDER).useValue({ name: 'none', send: async () => 'sent' }).compile();
    await worker.init();
  });

  beforeEach(unthrottle);
  afterAll(async () => {
    await worker.close();
    await app.close();
  });

  const create = (body: Record<string, unknown>) =>
    http().post(`${API}/admin/challenges`).set(bearer(admin)).send({
      title: '3 Days Walking', description: 'Walk your dog every day and log it.', kind: 'FREE', startsAt: hours(-1), endsAt: hours(24 * 5),
      requiredCheckIns: 3, proof: 'TEXT', pointsPerCheckIn: 10, streakBonusEvery: 2, streakBonusPoints: 25, badgeId, ...body,
    });

  it('publishes only a consistent challenge', async () => {
    const bad = await create({ requiredCheckIns: 30 }).expect(201);
    const r = await http().post(`${API}/admin/challenges/${bad.body.data.id}/status`).set(bearer(admin)).send({ to: 'PUBLISHED' }).expect(400);
    expect(r.body.errors[0].message).toMatch(/30 check-ins can’t fit in 6 days/);
    const paid = await create({ kind: 'PAID' }).expect(201);
    expect(paid.body.data.readiness).toContain('A paid challenge needs an entry fee.');
  });

  it('streaks over days, awards bonus points, completes once and earns the badge', async () => {
    const id = (await create({}).expect(201)).body.data.id;
    await http().get(`${API}/challenges/${id}`).expect(404); // draft
    await http().post(`${API}/admin/challenges/${id}/status`).set(bearer(admin)).send({ to: 'PUBLISHED' }).expect(200);
    const u = await login('+919877700001', 'Walker One');
    await http().post(`${API}/challenges/${id}/check-in`).set(bearer(u.token)).send({ text: 'walked' }).expect(400); // not joined
    await http().post(`${API}/challenges/${id}/join`).set(bearer(u.token)).send({}).expect(201);
    await http().post(`${API}/challenges/${id}/join`).set(bearer(u.token)).send({}).expect(409);

    await http().post(`${API}/challenges/${id}/check-in`).set(bearer(u.token)).send({}).expect(400); // TEXT proof needed
    const d1 = await http().post(`${API}/challenges/${id}/check-in`).set(bearer(u.token)).send({ text: 'Day 1: park loop' }).expect(201);
    expect(d1.body.data).toMatchObject({ earned: 10, bonus: 0, streak: 1, points: 10, completed: false, day: indiaDay(new Date()).toISOString().slice(0, 10) });
    expect((await http().post(`${API}/challenges/${id}/check-in`).set(bearer(u.token)).send({ text: 'again' }).expect(409)).body.message).toMatch(/already checked in today/);

    await shiftBackOneDay(id, u.id);
    const d2 = await http().post(`${API}/challenges/${id}/check-in`).set(bearer(u.token)).send({ text: 'Day 2' }).expect(201);
    expect(d2.body.data).toMatchObject({ earned: 35, bonus: 25, streak: 2, points: 45 });

    await shiftBackOneDay(id, u.id);
    const d3 = await http().post(`${API}/challenges/${id}/check-in`).set(bearer(u.token)).send({ text: 'Day 3' }).expect(201);
    expect(d3.body.data).toMatchObject({ streak: 3, points: 55, checkIns: 3, completed: true, badge: { name: '3-Day Walker' } });

    const detail = (await http().get(`${API}/challenges/${id}`).set(bearer(u.token)).expect(200)).body.data;
    expect(detail.mine).toMatchObject({ status: 'COMPLETED', points: 55, checkIns: 3, streak: 3, checkedInToday: true });
    expect(detail.entry.days).toHaveLength(3);
    expect((await http().get(`${API}/users/me/badges`).set(bearer(u.token)).expect(200)).body.data).toEqual([expect.objectContaining({ key: 'walker-3', name: '3-Day Walker' })]);
    expect((await notifications(u, 'CHALLENGE_COMPLETED'))[0].body).toBe('You finished 3 Days Walking with 55 points.');
    expect((await notifications(u, 'BADGE_EARNED'))[0].body).toBe('You earned the “3-Day Walker” badge.');
  });

  it('a missed day resets the streak but not the points', async () => {
    const id = (await create({ requiredCheckIns: 5 }).expect(201)).body.data.id;
    await http().post(`${API}/admin/challenges/${id}/status`).set(bearer(admin)).send({ to: 'PUBLISHED' }).expect(200);
    const u = await login('+919877700002', 'Walker Two');
    await http().post(`${API}/challenges/${id}/join`).set(bearer(u.token)).send({}).expect(201);
    await http().post(`${API}/challenges/${id}/check-in`).set(bearer(u.token)).send({ text: 'd1' }).expect(201);
    await shiftBackOneDay(id, u.id);
    await shiftBackOneDay(id, u.id); // a gap day
    const r = await http().post(`${API}/challenges/${id}/check-in`).set(bearer(u.token)).send({ text: 'back' }).expect(201);
    expect(r.body.data).toMatchObject({ streak: 1, points: 20, checkIns: 2 });
  });

  it('ranks by points, then longest streak, and shows your own rank', async () => {
    const id = (await create({ requiredCheckIns: 4 }).expect(201)).body.data.id;
    await http().post(`${API}/admin/challenges/${id}/status`).set(bearer(admin)).send({ to: 'PUBLISHED' }).expect(200);
    const users = [await login('+919877700011', 'Rank A'), await login('+919877700012', 'Rank B'), await login('+919877700013', 'Rank C')];
    for (const u of users) await http().post(`${API}/challenges/${id}/join`).set(bearer(u.token)).send({}).expect(201);
    for (const [i, u] of users.entries()) {
      for (let d = 0; d < 3 - i; d++) {
        if (d) await shiftBackOneDay(id, u.id);
        await http().post(`${API}/challenges/${id}/check-in`).set(bearer(u.token)).send({ text: `day ${d}` }).expect(201);
      }
    }
    const b = (await http().get(`${API}/challenges/${id}/leaderboard`).set(bearer(users[2].token)).expect(200)).body.data;
    expect(b.rows.map((r: { user: { name: string }; points: number }) => [r.user.name, r.points])).toEqual([['Rank A', 55], ['Rank B', 45], ['Rank C', 10]]);
    expect(b.me).toEqual({ rank: 3, points: 10 });
  });

  it('paid and contest-linked challenges', async () => {
    const paid = (await create({ kind: 'PAID', feePaise: 49_00 }).expect(201)).body.data.id;
    await http().post(`${API}/admin/challenges/${paid}/status`).set(bearer(admin)).send({ to: 'PUBLISHED' }).expect(200);
    const u = await login('+919877700021', 'Payer');
    const j = await http().post(`${API}/challenges/${paid}/join`).set(bearer(u.token)).send({}).expect(201);
    expect(j.body.data).toMatchObject({ status: 'PENDING_PAYMENT', payment: { amountPaise: 49_00 } });
    await http().post(`${API}/challenges/${paid}/check-in`).set(bearer(u.token)).send({ text: 'x' }).expect(400);
    await http().post(`${API}/payments/${j.body.data.payment.paymentId}/simulate`).set(bearer(u.token)).expect(200);
    await http().post(`${API}/challenges/${paid}/check-in`).set(bearer(u.token)).send({ text: 'paid and walking' }).expect(201);
    await http().post(`${API}/admin/challenges/${paid}/status`).set(bearer(admin)).send({ to: 'CANCELLED' }).expect(200);
    expect(await prisma.payment.findFirstOrThrow({ where: { referenceId: paid } })).toMatchObject({ status: 'REFUND_PENDING' });

    const contest = await prisma.contest.create({
      data: { slug: 'linked-c', title: 'Linked contest', description: 'For the linked challenge.', status: 'LIVE', publicWeight: 100, createdById: u.id, registrationOpensAt: new Date(Date.now() - 3_600_000), registrationClosesAt: new Date(Date.now() + 3_600_000), submissionClosesAt: new Date(Date.now() + 7_200_000), votingClosesAt: new Date(Date.now() + 10_800_000) },
    });
    const linked = (await create({ kind: 'CONTEST_LINKED', contestId: contest.id }).expect(201)).body.data.id;
    await http().post(`${API}/admin/challenges/${linked}/status`).set(bearer(admin)).send({ to: 'PUBLISHED' }).expect(200);
    const other = await login('+919877700022', 'Outsider');
    expect((await http().post(`${API}/challenges/${linked}/join`).set(bearer(other.token)).send({}).expect(400)).body.message).toMatch(/Enter the contest first/);
    const pet = (await http().post(`${API}/pets`).set(bearer(other.token)).send({ name: 'Linky', speciesId: dogId }).expect(201)).body.data.id;
    await http().post(`${API}/contests/${contest.id}/register`).set(bearer(other.token)).send({ petId: pet }).expect(201);
    await http().post(`${API}/challenges/${linked}/join`).set(bearer(other.token)).send({}).expect(201);
  });

  it('contest entrants hear about their entry, voting and results', async () => {
    const owner = await login('+919877700031', 'Contest Owner');
    const c = await prisma.contest.create({
      data: {
        slug: 'notify-c', title: 'Trick Cup', description: 'Notification test contest.', status: 'LIVE', publicWeight: 100, createdById: owner.id,
        registrationOpensAt: new Date(Date.now() - 3_600_000), registrationClosesAt: new Date(Date.now() + 3_600_000), submissionClosesAt: new Date(Date.now() + 7_200_000), votingClosesAt: new Date(Date.now() + 10_800_000),
        prizes: { create: [{ rank: 1, title: 'Gold', kind: 'VOUCHER' }] },
      },
    });
    const a = await login('+919877700032', 'Entrant A');
    const pet = (await http().post(`${API}/pets`).set(bearer(a.token)).send({ name: 'Bolt', speciesId: dogId }).expect(201)).body.data.id;
    const entry = (await http().post(`${API}/contests/${c.id}/register`).set(bearer(a.token)).send({ petId: pet }).expect(201)).body.data.entryId;
    expect((await notifications(a, 'CONTEST_ENTRY_CONFIRMED'))[0].body).toBe('Bolt is entered in Trick Cup. Complete the tasks before submissions close.');

    await prisma.contestParticipant.update({ where: { id: entry }, data: { status: 'SUBMITTED' } });
    await http().post(`${API}/admin/contests/${c.id}/transition`).set(bearer(admin)).send({ to: 'VOTING' }).expect(200);
    expect((await notifications(a, 'CONTEST_VOTING_OPEN'))[0].title).toBe('Voting is open');

    await http().post(`${API}/admin/contests/${c.id}/transition`).set(bearer(admin)).send({ to: 'EVALUATION' }).expect(200);
    await http().post(`${API}/admin/contests/${c.id}/freeze`).set(bearer(admin)).expect(200);
    await http().post(`${API}/admin/contests/${c.id}/transition`).set(bearer(admin)).send({ to: 'WINNER_DECLARATION' }).expect(200);
    await http().post(`${API}/admin/contests/${c.id}/winners`).set(bearer(admin)).expect(200);
    const result = (await notifications(a, 'CONTEST_RESULT'))[0];
    expect(result).toMatchObject({ title: 'You won! 🏆', body: 'Bolt won “Gold” in Trick Cup.' });
  });
});
