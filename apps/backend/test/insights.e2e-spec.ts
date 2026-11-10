import { Test, type TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { QueueService } from '../src/queue/queue.service';
import { SMS_PROVIDER, type SmsMessage } from '../src/providers/sms/sms.provider';
import { PUSH_PROVIDER } from '../src/providers/push/push.provider';
import { syncRbac } from '../src/modules/rbac/rbac.seed';
import { seedMembershipPlans } from '../src/modules/memberships/memberships.seed';
import { WorkerModule } from '../src/worker/worker.module';
import { NotificationProcessor } from '../src/worker/notification.processor';
import { ReminderSweeper } from '../src/modules/reminders/reminder-sweeper';
import { PromotionSender } from '../src/modules/reminders/promotion.sender';
import { addDays, istDay } from '../src/modules/analytics/analytics.rules';

const API = '/api/v1';
jest.setTimeout(240_000);
type User = { token: string; id: string; phone: string };
const HOUR = 3_600_000;
const hours = (n: number) => new Date(Date.now() + n * HOUR);

/** Phase 9d: admin analytics, membership plans and their benefits, reminders, vote updates and promotions. */
describe('Analytics, memberships, reminders and promotions (e2e)', () => {
  let app: NestExpressApplication;
  let worker: TestingModule;
  let prisma: PrismaService;
  let redis: RedisService;
  const inbox = new Map<string, string>();
  const pushed: Array<{ title: string; body: string; data?: Record<string, string> }> = [];
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const unthrottle = async () => {
    const k = await redis.client.keys('throttle:*');
    if (k.length) await redis.client.del(...k);
  };
  const flag = (key: string, enabled: boolean) => prisma.featureFlag.upsert({ where: { key }, update: { enabled }, create: { key, enabled } }).then(() => redis.client.del('platform:flags'));
  const setting = async (key: string, value: unknown) => {
    await prisma.appSetting.upsert({ where: { key }, update: { value: value as never }, create: { key, value: value as never } });
    await redis.client.del('platform:settings');
  };
  const fresh = async () => {
    const k = await redis.client.keys('analytics:*');
    if (k.length) await redis.client.del(...k);
  };

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
  async function notifications(u: User, type: string, wait = true) {
    for (let i = 0; i < (wait ? 60 : 1); i++) {
      const items = (await http().get(`${API}/notifications?limit=50`).set(bearer(u.token)).expect(200)).body.data.items as Array<{ type: string; title: string; body: string; link: string | null; entityId: string }>;
      const hit = items.filter((n) => n.type === type);
      if (hit.length || !wait) return hit;
      await new Promise((r) => setTimeout(r, 150));
    }
    return [];
  }
  /** Waits for a notification with this title. */
  async function waitFor(u: User, type: string, title: string) {
    for (let i = 0; i < 60; i++) {
      const hit = (await notifications(u, type, false)).find((n) => n.title === title);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(`no “${title}” notification`);
  }
  /** Lets queued notifications reach the worker before asserting that nothing arrived. */
  const settle = () => new Promise((r) => setTimeout(r, 1500));
  const kpi = (report: { kpis: Array<{ key: string; value: number | null; previous?: number | null }> }, key: string) => report.kpis.find((k) => k.key === key);
  const report = async (tab: string, token: string, query = '') => {
    await fresh();
    return (await http().get(`${API}/admin/analytics/${tab}${query}`).set(bearer(token)).expect(200)).body.data;
  };
  const pay = (u: User, paymentId: string) => http().post(`${API}/payments/${paymentId}/simulate`).set(bearer(u.token)).expect(200);

  let ana: User;
  let ben: User;
  let cy: User;
  let dee: User;
  let admin: { token: string; id: string };
  let finance: { token: string };
  let agent: { token: string };
  let moderator: { token: string };
  let dog: string;
  let plans: Record<string, string>;
  let partnerId: string;
  let serviceId: string;

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
    expect(await seedMembershipPlans(prisma)).toBe(3);
    expect(await seedMembershipPlans(prisma)).toBe(0);
    plans = Object.fromEntries((await prisma.membershipPlan.findMany()).map((p) => [p.key, p.id]));
    for (const k of ['ENABLE_SERVICES', 'ENABLE_MARKETPLACE', 'ENABLE_REELS', 'ENABLE_CONTESTS', 'ENABLE_PUBLIC_VOTING']) await flag(k, true);

    ana = await login('+919800000401', 'Ana Rao');
    ben = await login('+919800000402', 'Ben Das');
    cy = await login('+919800000403', 'Cy Rao');
    dee = await login('+919800000404', 'Dee Shah');
    admin = await staff('root@ins.test', 'SUPER_ADMIN', 'Root Admin');
    finance = await staff('fin@ins.test', 'FINANCE', 'Fin Ance');
    agent = await staff('agent@ins.test', 'SUPPORT_AGENT', 'Sana Iyer');
    moderator = await staff('mod@ins.test', 'MODERATOR', 'Mo Derator');
    dog = (await prisma.petSpecies.create({ data: { key: 'dog', name: 'Dog' } })).id;

    const sc = await prisma.serviceCategory.create({ data: { key: 'grooming', name: 'Grooming' } });
    const groomer = await login('+919800000405', 'Pia Groomer');
    const partner = await prisma.servicePartner.create({
      data: {
        userId: groomer.id, slug: 'pia-grooming', businessName: 'Pia Grooming Studio', phone: groomer.phone, addressLine: '1 Lane', city: 'Pune', state: 'Maharashtra', pincode: '411001', lat: 18.5362, lng: 73.8939, status: 'APPROVED',
        services: { create: [{ categoryId: sc.id, name: 'Full groom', durationMin: 60, pricePaise: 120000, modes: ['AT_CENTER'] }] },
        hours: { create: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensMin: 9 * 60, closesMin: 18 * 60 })) },
      },
      include: { services: true },
    });
    partnerId = partner.id;
    serviceId = partner.services[0].id;

    worker = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(PUSH_PROVIDER)
      .useValue({ name: 'capture', send: async (m: { title: string; body: string; data?: Record<string, string> }) => (pushed.push(m), 'sent') })
      .compile();
    await worker.init();
  });

  afterAll(async () => {
    await worker?.close();
    await app?.close();
  });

  beforeEach(unthrottle);

  describe('daily activity and user analytics', () => {
    it('records each person once a day, app sessions only', async () => {
      await http().get(`${API}/users/me`).set(bearer(ana.token)).expect(200);
      await http().get(`${API}/users/me`).set(bearer(ana.token)).expect(200);
      await http().get(`${API}/admin/analytics/users`).set(bearer(admin.token)).expect(200);
      for (let i = 0; i < 40 && (await prisma.userActivity.count()) < 4; i++) await new Promise((r) => setTimeout(r, 100));
      const rows = await prisma.userActivity.findMany();
      // The four customers (and the groomer) used the app today; staff on the dashboard don't count.
      expect(rows.map((r) => r.userId)).toEqual(expect.arrayContaining([ana.id, ben.id, cy.id, dee.id]));
      expect(rows.some((r) => r.userId === admin.id)).toBe(false);
      expect(new Set(rows.map((r) => r.day.toISOString().slice(0, 10)))).toEqual(new Set([istDay()]));
    });

    it('reports active users, sign-ups and retention', async () => {
      const today = istDay();
      // Ana and Ben joined 8 days ago; Ana came back the next day and a week later.
      const joined = new Date(Date.parse(`${addDays(today, -8)}T06:00:00Z`));
      await prisma.user.updateMany({ where: { id: { in: [ana.id, ben.id] } }, data: { createdAt: joined } });
      await prisma.userActivity.createMany({
        data: [
          { userId: ana.id, day: new Date(`${addDays(today, -8)}T00:00:00Z`) }, { userId: ben.id, day: new Date(`${addDays(today, -8)}T00:00:00Z`) },
          { userId: ana.id, day: new Date(`${addDays(today, -7)}T00:00:00Z`) }, { userId: ana.id, day: new Date(`${addDays(today, -1)}T00:00:00Z`) },
        ],
        skipDuplicates: true,
      });
      const r = await report('users', admin.token, `?from=${addDays(today, -9)}&to=${today}`);
      expect(r).toMatchObject({ tab: 'users', from: addDays(today, -9), to: today, days: 10 });
      expect(kpi(r, 'registrations')!.value).toBe(5); // four customers and the groomer; staff left out
      expect(kpi(r, 'lastDay')!.value).toBe(5);
      expect(kpi(r, 'activePeople')!.value).toBe(5);
      expect(kpi(r, 'mau')!.value).toBe(5);
      expect(kpi(r, 'd1')!.value).toBe(50); // of Ana and Ben (old enough), Ana came back on day 1
      expect(kpi(r, 'd7')!.value).toBe(50);
      expect(kpi(r, 'd30')!.value).toBeNull();
      const active = r.series.find((s: { key: string }) => s.key === 'active').points;
      expect(active).toHaveLength(10);
      expect(active.find((p: { day: string }) => p.day === addDays(today, -8)).value).toBe(2);
      expect(r.tables[0].rows[0]).toMatchObject({ signups: 2, d1: 50, d7: 50 });
    });

    it('needs analytics access, valid dates and a known tab, and caches', async () => {
      await http().get(`${API}/admin/analytics/users`).set(bearer(moderator.token)).expect(403);
      await http().get(`${API}/admin/analytics/users`).set(bearer(agent.token)).expect(403);
      await http().get(`${API}/admin/analytics/users`).set(bearer(finance.token)).expect(200);
      await http().get(`${API}/admin/analytics/users`).set(bearer(ana.token)).expect(403);
      expect((await http().get(`${API}/admin/analytics/users?from=2026-10-05&to=2026-10-01`).set(bearer(admin.token)).expect(400)).body.message).toBe('The start date is after the end date.');
      await http().get(`${API}/admin/analytics/users?from=2024-01-01&to=2026-01-31`).set(bearer(admin.token)).expect(400);
      await http().get(`${API}/admin/analytics/everything`).set(bearer(admin.token)).expect(404);
      await fresh();
      const a = (await http().get(`${API}/admin/analytics/users`).set(bearer(admin.token)).expect(200)).body.data;
      const b = (await http().get(`${API}/admin/analytics/users`).set(bearer(admin.token)).expect(200)).body.data;
      expect(b.generatedAt).toBe(a.generatedAt);
      expect(a.days).toBe(30);
    });
  });

  describe('reels analytics', () => {
    it('counts daily views, watched-to-the-end and engagement', async () => {
      const reel = await prisma.post.create({ data: { authorId: cy.id, type: 'REEL', caption: 'Zoomies at the beach #zoomies', status: 'PUBLISHED', visibility: 'PUBLIC', publishedAt: new Date() } });
      await prisma.post.create({ data: { authorId: cy.id, type: 'PHOTO', caption: 'Not a reel', status: 'PUBLISHED', visibility: 'PUBLIC', publishedAt: new Date() } });
      expect((await http().post(`${API}/posts/${reel.id}/view`).set(bearer(ana.token)).send({}).expect(200)).body.data).toEqual({ counted: true, completed: false });
      expect((await http().post(`${API}/posts/${reel.id}/view`).set(bearer(ana.token)).send({ completed: true }).expect(200)).body.data).toEqual({ counted: false, completed: true });
      expect((await http().post(`${API}/posts/${reel.id}/view`).set(bearer(ana.token)).send({ completed: true }).expect(200)).body.data).toEqual({ counted: false, completed: false });
      await http().post(`${API}/posts/${reel.id}/view`).set(bearer(ben.token)).expect(200); // old apps send no body
      await http().post(`${API}/posts/${reel.id}/view`).set(bearer(ben.token)).send({ completed: 'yes' }).expect(400);
      await http().post(`${API}/posts/${reel.id}/like`).set(bearer(ana.token)).expect(200);
      await http().post(`${API}/posts/${reel.id}/share`).set(bearer(ben.token)).send({ channel: 'whatsapp' }).expect(200);
      expect(await prisma.postDailyStat.findFirstOrThrow({ where: { postId: reel.id } })).toMatchObject({ views: 2, completions: 1 });

      const r = await report('reels', admin.token);
      expect(kpi(r, 'views')!.value).toBe(2);
      expect(kpi(r, 'completionRate')!.value).toBe(50);
      expect(kpi(r, 'likes')!.value).toBe(1);
      expect(kpi(r, 'shares')!.value).toBe(1);
      expect(kpi(r, 'engagementRate')!.value).toBe(100);
      expect(kpi(r, 'published')!.value).toBe(1);
      expect(kpi(r, 'creators')!.value).toBe(1);
      expect(r.tables[0].rows[0]).toMatchObject({ id: reel.id, caption: 'Zoomies at the beach #zoomies', author: 'Cy Rao', views: 2, completion: 50, likes: 1, shares: 1 });
      expect(r.series.find((s: { key: string }) => s.key === 'views').points.at(-1)).toEqual({ day: istDay(), value: 2 });
    });
  });

  describe('shop, services and contest analytics', () => {
    it('reports orders, GMV and average order value from paid orders', async () => {
      for (const [i, total] of [[1, 59900], [2, 40100]] as const) {
        const o = await prisma.order.create({ data: { code: `PA-T${i}`, userId: ana.id, status: 'PAID', itemsPaise: total, discountPaise: 0, shippingPaise: 0, totalPaise: total, shipTo: {} } });
        const p = await prisma.payment.create({ data: { userId: ana.id, purpose: 'PRODUCT_ORDER', referenceId: o.id, amountPaise: total, provider: 'dev', providerOrderId: `order_t${i}`, status: 'CAPTURED', capturedAt: new Date() } });
        await prisma.order.update({ where: { id: o.id }, data: { paymentId: p.id } });
      }
      await prisma.order.create({ data: { code: 'PA-T3', userId: ben.id, itemsPaise: 1000, discountPaise: 0, shippingPaise: 0, totalPaise: 1000, shipTo: {} } }); // never paid
      const r = await report('marketplace', admin.token);
      expect(kpi(r, 'orders')!.value).toBe(2);
      expect(kpi(r, 'gmv')!.value).toBe(100000);
      expect(kpi(r, 'aov')!.value).toBe(50000);
      expect(kpi(r, 'buyers')!.value).toBe(1);
      expect(kpi(r, 'returnRate')!.value).toBeNull();
      expect(r.series.find((s: { key: string }) => s.key === 'gmv').points.at(-1).value).toBe(100000);
    });

    it('reports bookings, cancellations and partner performance', async () => {
      const pet = await prisma.pet.create({ data: { ownerId: ana.id, speciesId: dog, name: 'Biscuit', handle: 'biscuit.ins' } });
      const base = { customerId: ana.id, partnerId, serviceId, petId: pet.id, mode: 'AT_CENTER' as const, pricePaise: 120000, commissionBps: 1000, platformFeePaise: 12000, partnerEarningPaise: 108000 };
      await prisma.booking.create({ data: { ...base, code: 'BK-A1', slotIndex: 0, startsAt: hours(-30), endsAt: hours(-29), status: 'COMPLETED', completedAt: hours(-28) } });
      await prisma.booking.create({ data: { ...base, code: 'BK-A2', slotIndex: 0, startsAt: hours(50), endsAt: hours(51), status: 'CANCELLED', cancelledBy: 'PARTNER' } });
      await prisma.booking.create({ data: { ...base, code: 'BK-A3', slotIndex: 0, startsAt: hours(60), endsAt: hours(61), status: 'PENDING_PAYMENT' } });
      const r = await report('services', admin.token);
      expect(kpi(r, 'bookings')!.value).toBe(2);
      expect(kpi(r, 'value')!.value).toBe(240000);
      expect(kpi(r, 'completed')!.value).toBe(1);
      expect(kpi(r, 'revenue')!.value).toBe(12000);
      expect(kpi(r, 'cancelRate')!.value).toBe(50);
      expect(kpi(r, 'partnerCancelRate')!.value).toBe(50);
      expect(r.tables[0].rows[0]).toMatchObject({ partner: 'Pia Grooming Studio', bookings: 2, completed: 1, partnerCancelled: 1, cancelRate: 50 });
    });
  });

  describe('contest votes, contest reminders and contest analytics', () => {
    let contestId: string;
    let anaEntry: string;
    let benEntry: string;

    it('reminds entrants who haven’t submitted, once, unless they turned reminders off', async () => {
      const c = await prisma.contest.create({
        data: {
          slug: 'smiles', title: 'Summer Smiles', description: 'Best smile wins.', status: 'LIVE', publicWeight: 100, votesPerUserPerDay: 3, createdById: admin.id,
          registrationOpensAt: hours(-48), registrationClosesAt: hours(10), submissionClosesAt: hours(12), votingClosesAt: hours(22),
          tasks: { create: [{ position: 1, type: 'POST', title: 'Your best smile' }] },
        },
      });
      contestId = c.id;
      const register = async (u: User, name: string) => {
        const petId = (await http().post(`${API}/pets`).set(bearer(u.token)).send({ name, speciesId: dog }).expect(201)).body.data.id;
        return (await http().post(`${API}/contests/${c.id}/register`).set(bearer(u.token)).send({ petId }).expect(201)).body.data.entryId as string;
      };
      anaEntry = await register(ana, 'Luna');
      benEntry = await register(ben, 'Rex');
      await http().put(`${API}/notifications/preferences`).set(bearer(ben.token)).send({ reminders: false }).expect(200);

      const sweeper = worker.get(ReminderSweeper);
      expect((await sweeper.sweep()).contests).toBe(2);
      const got = await notifications(ana, 'CONTEST_REMINDER');
      expect(got[0]).toMatchObject({ title: 'Submit your entry', entityId: c.id });
      expect(got[0].body).toMatch(/^Entries for Summer Smiles close .+\. Add Luna’s entry so it can be judged\.$/);
      expect((await sweeper.sweep()).contests).toBe(0);
      await settle();
      expect(await notifications(ben, 'CONTEST_REMINDER', false)).toHaveLength(0);
      expect(await notifications(ana, 'CONTEST_REMINDER', false)).toHaveLength(1);
    });

    it('tells entrants about new votes once an hour, counted at the end of the hour', async () => {
      // Established accounts: votes from brand-new accounts are held for review and don't count.
      await prisma.user.updateMany({ where: { id: { in: [cy.id, dee.id] } }, data: { createdAt: new Date(Date.now() - 90 * 24 * HOUR) } });
      await prisma.contestParticipant.updateMany({ where: { contestId }, data: { status: 'SUBMITTED' } });
      await prisma.contest.update({ where: { id: contestId }, data: { status: 'VOTING' } });
      await http().post(`${API}/contest-entries/${anaEntry}/vote`).set(bearer(cy.token)).expect(200);
      await http().post(`${API}/contest-entries/${anaEntry}/vote`).set(bearer(dee.token)).expect(200);
      const hour = Math.floor(Date.now() / HOUR);
      let job = await app.get(QueueService).notifications.getJob(`votes-${anaEntry}-${hour}`);
      for (let i = 0; i < 20 && !job; i++) job = await new Promise((r) => setTimeout(r, 100)).then(() => app.get(QueueService).notifications.getJob(`votes-${anaEntry}-${hour}`));
      expect(job?.data).toEqual({ type: 'CONTEST_VOTES', participantId: anaEntry, since: new Date(hour * HOUR).toISOString() });
      expect(job!.opts.delay).toBeGreaterThan(0);
      // The hour is up: the worker counts the votes in it.
      await job!.remove();
      await worker.get(NotificationProcessor).handle(job!.data, 'test-votes');
      expect((await notifications(ana, 'CONTEST_VOTES'))[0]).toMatchObject({ title: '2 new votes', body: 'Luna got 2 new votes in Summer Smiles.' });
      // Turned off: nothing.
      await http().put(`${API}/notifications/preferences`).set(bearer(ben.token)).send({ votes: false }).expect(200);
      await http().post(`${API}/contest-entries/${benEntry}/vote`).set(bearer(cy.token)).expect(200);
      expect(await worker.get(NotificationProcessor).handle({ type: 'CONTEST_VOTES', participantId: benEntry, since: new Date(hour * HOUR).toISOString() }, 'test-votes-2')).toBe(0);
    });

    it('reminds entrants before voting closes', async () => {
      const sweeper = worker.get(ReminderSweeper);
      expect((await sweeper.sweep()).contests).toBe(2);
      await waitFor(ana, 'CONTEST_REMINDER', 'Voting closes soon');
    });

    it('reports registrations, votes and entry fees', async () => {
      const r = await report('contests', admin.token);
      expect(kpi(r, 'registrations')!.value).toBe(2);
      expect(kpi(r, 'participants')!.value).toBe(2);
      expect(kpi(r, 'votes')!.value).toBe(3);
      expect(kpi(r, 'voters')!.value).toBe(2);
      expect(kpi(r, 'live')!.value).toBe(1);
      expect(r.tables[0].rows[0]).toMatchObject({ title: 'Summer Smiles', status: 'VOTING', registrations: 2, votes: 3, fees: 0 });
    });
  });

  describe('booking reminders', () => {
    it('reminds of a visit once, but not of one booked at the last minute', async () => {
      const pet = await prisma.pet.create({ data: { ownerId: cy.id, speciesId: dog, name: 'Pepper', handle: 'pepper.ins' } });
      const base = { customerId: cy.id, partnerId, serviceId, petId: pet.id, mode: 'AT_CENTER' as const, pricePaise: 90000, commissionBps: 1000, platformFeePaise: 9000, partnerEarningPaise: 81000, status: 'CONFIRMED' as const, slotIndex: 1 };
      const soon = await prisma.booking.create({ data: { ...base, code: 'BK-R1', startsAt: hours(20), endsAt: hours(21), createdAt: hours(-48) } });
      const lastMinute = await prisma.booking.create({ data: { ...base, code: 'BK-R2', startsAt: hours(2), endsAt: hours(3) } });
      const later = await prisma.booking.create({ data: { ...base, code: 'BK-R3', startsAt: hours(80), endsAt: hours(81), createdAt: hours(-48) } });
      const sweeper = worker.get(ReminderSweeper);
      expect((await sweeper.sweep()).bookings).toBe(1);
      const n = await notifications(cy, 'BOOKING_REMINDER');
      expect(n).toHaveLength(1);
      expect(n[0]).toMatchObject({ title: 'Coming up: Full groom', entityId: soon.id });
      expect(n[0].body).toMatch(/^Pepper’s visit with Pia Grooming Studio is .+\. Booking BK-R1\.$/);
      expect((await sweeper.sweep()).bookings).toBe(0);
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: lastMinute.id } })).remindedAt).not.toBeNull();
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: later.id } })).remindedAt).toBeNull();
      await setting('reminders.bookingHoursBefore', 0);
      await prisma.booking.update({ where: { id: later.id }, data: { startsAt: hours(5), endsAt: hours(6) } });
      expect((await sweeper.sweep()).bookings).toBe(0);
      await setting('reminders.bookingHoursBefore', 24);
    });
  });

  describe('memberships', () => {
    it('stays hidden until switched on', async () => {
      await http().get(`${API}/memberships/plans`).expect(404);
      await http().post(`${API}/memberships/purchase`).set(bearer(ana.token)).send({ planId: plans.PLUS }).expect(404);
      expect((await http().get(`${API}/memberships/me`).set(bearer(ana.token)).expect(200)).body.data).toMatchObject({ enabled: false, current: null });
      // A members-only contest is open to everyone while memberships are off.
      const c = await prisma.contest.create({
        data: { slug: 'vip', title: 'Members Cup', description: 'For members.', status: 'LIVE', membersOnly: true, publicWeight: 100, createdById: admin.id, registrationOpensAt: hours(-1), registrationClosesAt: hours(48), submissionClosesAt: hours(72), votingClosesAt: hours(96) },
      });
      const petId = (await http().post(`${API}/pets`).set(bearer(dee.token)).send({ name: 'Kiwi', speciesId: dog }).expect(201)).body.data.id;
      await http().post(`${API}/contests/${c.id}/register`).set(bearer(dee.token)).send({ petId }).expect(201);
      expect((await http().get(`${API}/contests/vip`).expect(200)).body.data.membersOnly).toBe(true);
    });

    it('lists plans and sells one through the payment gateway', async () => {
      await flag('ENABLE_MEMBERSHIPS', true);
      const list = (await http().get(`${API}/memberships/plans`).expect(200)).body.data;
      expect(list.map((p: { key: string }) => p.key)).toEqual(['FREE', 'PLUS', 'PREMIUM']);
      expect(list[2].lines).toContain('Book services up to 30 days earlier than everyone else');
      await http().post(`${API}/memberships/purchase`).set(bearer(ana.token)).send({ planId: plans.FREE }).expect(400);

      const buy = (await http().post(`${API}/memberships/purchase`).set(bearer(ana.token)).send({ planId: plans.PLUS }).expect(201)).body.data;
      expect(buy.payment).toMatchObject({ amountPaise: 14900, status: 'CREATED' });
      // Tapping again reuses the open checkout.
      expect((await http().post(`${API}/memberships/purchase`).set(bearer(ana.token)).send({ planId: plans.PLUS }).expect(201)).body.data.membershipId).toBe(buy.membershipId);
      expect((await http().get(`${API}/memberships/me`).set(bearer(ana.token)).expect(200)).body.data.current).toBeNull();
      await pay(ana, buy.payment.paymentId);

      const me = (await http().get(`${API}/memberships/me`).set(bearer(ana.token)).expect(200)).body.data;
      expect(me).toMatchObject({ enabled: true, current: { plan: { key: 'PLUS' }, status: 'ACTIVE', pricePaise: 14900 }, upcoming: [], benefits: { memberDiscounts: true, exclusiveContests: true, priorityDays: 0, planKey: 'PLUS' } });
      expect(new Date(me.current.endsAt).getTime() - new Date(me.current.startsAt).getTime()).toBe(30 * 24 * HOUR);
      const posting = await prisma.ledgerTransaction.findFirstOrThrow({ where: { kind: 'MEMBERSHIP_EARNED' }, include: { entries: { include: { account: true } } } });
      expect(posting.entries.map((e) => [e.account.code, e.debitPaise, e.creditPaise]).sort()).toEqual([['CUSTOMER_FUNDS', 14900, 0], ['GST_PAYABLE', 0, 2273], ['MEMBERSHIP_REVENUE', 0, 12627]]);
      await waitFor(ana, 'MEMBERSHIP_UPDATE', 'Welcome to Plus');
      expect((await http().get(`${API}/users/${ana.id}`).set(bearer(ben.token)).expect(200)).body.data.member).toEqual({ plan: 'Plus', key: 'PLUS' });
      expect((await http().get(`${API}/users/me`).set(bearer(ana.token)).expect(200)).body.data.member).toEqual({ plan: 'Plus', key: 'PLUS' });
      expect((await http().get(`${API}/users/${ben.id}`).set(bearer(ana.token)).expect(200)).body.data.member).toBeNull();
    });

    it('renews ahead within the limit, and waits to switch plans', async () => {
      await setting('memberships.maxPeriodsAhead', 1);
      const renew = (await http().post(`${API}/memberships/purchase`).set(bearer(ana.token)).send({ planId: plans.PLUS }).expect(201)).body.data;
      await pay(ana, renew.payment.paymentId);
      await waitFor(ana, 'MEMBERSHIP_UPDATE', 'Membership renewed');
      const me = (await http().get(`${API}/memberships/me`).set(bearer(ana.token)).expect(200)).body.data;
      expect(me.upcoming).toHaveLength(1);
      expect(me.upcoming[0].startsAt).toBe(me.current.endsAt);
      expect((await http().post(`${API}/memberships/purchase`).set(bearer(ana.token)).send({ planId: plans.PLUS }).expect(400)).body.message).toBe('You’ve already paid one period ahead.');
      expect((await http().post(`${API}/memberships/purchase`).set(bearer(ana.token)).send({ planId: plans.PREMIUM }).expect(400)).body.message).toMatch(/^Your Plus membership runs until \d{4}-\d{2}-\d{2}\. You can switch plans when it ends\.$/);
      await setting('memberships.maxPeriodsAhead', 2);
    });

    it('refunds a payment it can no longer honour', async () => {
      const buy = (await http().post(`${API}/memberships/purchase`).set(bearer(ben.token)).send({ planId: plans.PLUS }).expect(201)).body.data;
      // Before Ben pays, staff give him Premium: the Plus payment can't start now.
      await http().post(`${API}/admin/memberships/grant`).set(bearer(admin.token)).send({ userId: ben.id, planId: plans.PREMIUM, days: 30, reason: 'Contest prize' }).expect(201);
      await pay(ben, buy.payment.paymentId);
      expect(await prisma.membership.findUniqueOrThrow({ where: { id: buy.membershipId } })).toMatchObject({ status: 'EXPIRED' });
      expect(await prisma.refund.findFirstOrThrow({ where: { paymentId: buy.payment.paymentId } })).toMatchObject({ amountPaise: 14900, reason: 'PAYMENT_UNHONOURED' });
      expect(await prisma.ledgerTransaction.count({ where: { kind: 'MEMBERSHIP_EARNED' } })).toBe(2); // Ana's two, not Ben's
    });

    it('enforces members-only contests, premium challenges and member coupons', async () => {
      const c = await prisma.contest.findUniqueOrThrow({ where: { slug: 'vip' } });
      const cyPet = (await http().post(`${API}/pets`).set(bearer(cy.token)).send({ name: 'Mochi', speciesId: dog }).expect(201)).body.data.id;
      expect((await http().post(`${API}/contests/${c.id}/register`).set(bearer(cy.token)).send({ petId: cyPet }).expect(403)).body.message).toBe('This contest is for members. See Membership in your profile to join.');
      const anaPet = (await prisma.pet.findFirstOrThrow({ where: { ownerId: ana.id, name: 'Luna' } })).id;
      await http().post(`${API}/contests/${c.id}/register`).set(bearer(ana.token)).send({ petId: anaPet }).expect(201);

      const ch = await prisma.challenge.create({ data: { slug: 'premium-walk', title: 'Premium walks', description: 'Walk every day with friends.', status: 'PUBLISHED', membersOnly: true, startsAt: hours(-1), endsAt: hours(100), requiredCheckIns: 3, createdById: admin.id } });
      expect((await http().post(`${API}/challenges/${ch.id}/join`).set(bearer(cy.token)).send({}).expect(403)).body.message).toMatch(/premium challenge for members/);
      await http().post(`${API}/challenges/${ch.id}/join`).set(bearer(ana.token)).send({}).expect(201);
      expect((await http().get(`${API}/challenges/${ch.id}`).expect(200)).body.data.membersOnly).toBe(true);

      await http().post(`${API}/admin/coupons`).set(bearer(admin.token)).send({ code: 'MEMBER20', kind: 'PERCENT', value: 2000, startsAt: hours(-1).toISOString(), endsAt: hours(100).toISOString(), membersOnly: true }).expect(201);
      expect((await http().post(`${API}/checkout/preview`).set(bearer(cy.token)).send({ couponCode: 'MEMBER20' }).expect(200)).body.data.couponProblem).toBe('This coupon is for members only.');
      expect((await http().post(`${API}/checkout/preview`).set(bearer(ana.token)).send({ couponCode: 'MEMBER20' }).expect(200)).body.data.couponProblem).not.toBe('This coupon is for members only.');
    });

    it('lets Premium members book further ahead', async () => {
      await setting('services.maxDaysAhead', 3);
      const date = addDays(istDay(), 10);
      expect((await http().get(`${API}/partner-services/${serviceId}/slots?date=${date}`).expect(200)).body.data.slots).toEqual([]);
      expect((await http().get(`${API}/partner-services/${serviceId}/slots?date=${date}`).set(bearer(cy.token)).expect(200)).body.data.slots).toEqual([]);
      expect((await http().get(`${API}/partner-services/${serviceId}/slots?date=${date}`).set(bearer(ben.token)).expect(200)).body.data.slots.length).toBeGreaterThan(0);
      await setting('services.maxDaysAhead', 60);
    });

    it('lets staff manage plans and members, with an audit trail', async () => {
      await http().get(`${API}/admin/memberships/plans`).set(bearer(moderator.token)).expect(403);
      const listed = (await http().get(`${API}/admin/memberships/plans`).set(bearer(agent.token)).expect(200)).body.data;
      expect(listed.find((p: { key: string }) => p.key === 'PLUS').members).toBe(1);
      expect(listed.find((p: { key: string }) => p.key === 'PREMIUM').members).toBe(1);
      await http().post(`${API}/admin/memberships/grant`).set(bearer(agent.token)).send({ userId: cy.id, planId: plans.PLUS, days: 7, reason: 'Goodwill' }).expect(403);

      await http().patch(`${API}/admin/memberships/plans/${plans.FREE}`).set(bearer(admin.token)).send({ pricePaise: 100 }).expect(400);
      await http().patch(`${API}/admin/memberships/plans/${plans.PLUS}`).set(bearer(admin.token)).send({ pricePaise: 19900 }).expect(200);
      await http().post(`${API}/admin/memberships/plans`).set(bearer(admin.token)).send({ key: 'plus', name: 'Lower', pricePaise: 100, periodDays: 30 }).expect(400);
      await http().post(`${API}/admin/memberships/plans`).set(bearer(admin.token)).send({ key: 'PLUS', name: 'Again', pricePaise: 100, periodDays: 30 }).expect(409);
      const yearly = (await http().post(`${API}/admin/memberships/plans`).set(bearer(admin.token)).send({ key: 'PLUS_YEAR', name: 'Plus yearly', pricePaise: 149900, periodDays: 365, rank: 15, memberDiscounts: true, badge: true }).expect(201)).body.data;
      expect(yearly.lines).toEqual(['Member discounts in the shop', 'Member badge on your profile']);

      const current = (await http().get(`${API}/admin/memberships/members?state=current`).set(bearer(agent.token)).expect(200)).body;
      expect(current.meta.total).toBe(2);
      const bens = (await http().get(`${API}/admin/memberships/members?q=Ben`).set(bearer(admin.token)).expect(200)).body.data;
      expect(bens.map((m: { status: string; source: string }) => `${m.source}:${m.status}`).sort()).toEqual(['GRANT:ACTIVE', 'PURCHASE:EXPIRED']);
      const grant = bens.find((m: { source: string }) => m.source === 'GRANT');
      expect(grant).toMatchObject({ grantedBy: 'Root Admin', note: 'Contest prize', running: true });

      await http().post(`${API}/admin/memberships/${grant.id}/revoke`).set(bearer(admin.token)).send({ reason: 'Granted by mistake' }).expect(200);
      expect((await http().get(`${API}/memberships/me`).set(bearer(ben.token)).expect(200)).body.data.current).toBeNull();
      await waitFor(ben, 'MEMBERSHIP_UPDATE', 'Your membership was ended');
      await http().post(`${API}/admin/memberships/${grant.id}/revoke`).set(bearer(admin.token)).send({ reason: 'Again' }).expect(400);
      const audit = await prisma.auditLog.findMany({ where: { entityType: { in: ['Membership', 'MembershipPlan'] } }, select: { action: true } });
      expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['membership.start', 'membership.grant', 'membership.revoke', 'membership.plan_update', 'membership.plan_create']));
      const summary = (await http().get(`${API}/admin/memberships/summary`).set(bearer(admin.token)).expect(200)).body.data;
      expect(summary).toMatchObject({ enabled: true, members: 1, revenue30dPaise: 14900 * 2 }); // Ana's two; Ben's was refunded
    });

    it('warns before a membership ends, then expires it', async () => {
      const m = await prisma.membership.findFirstOrThrow({ where: { userId: ana.id, status: 'ACTIVE' }, orderBy: { startsAt: 'desc' } });
      // Without the renewal, Ana's membership ends in two days.
      await prisma.membership.update({ where: { id: m.id }, data: { status: 'REVOKED' } });
      const current = await prisma.membership.findFirstOrThrow({ where: { userId: ana.id, status: 'ACTIVE' } });
      await prisma.membership.update({ where: { id: current.id }, data: { endsAt: hours(48) } });
      const sweeper = worker.get(ReminderSweeper);
      expect((await sweeper.sweep()).memberships).toBe(1);
      expect((await sweeper.sweep()).memberships).toBe(0);
      await waitFor(ana, 'MEMBERSHIP_UPDATE', 'Your membership ends soon');

      await prisma.membership.update({ where: { id: current.id }, data: { endsAt: hours(-1) } });
      expect(await sweeper.expireMemberships()).toBe(1);
      expect(await prisma.membership.findUniqueOrThrow({ where: { id: current.id } })).toMatchObject({ status: 'EXPIRED' });
      await waitFor(ana, 'MEMBERSHIP_UPDATE', 'Your membership has ended');
      expect((await http().get(`${API}/users/me`).set(bearer(ana.token)).expect(200)).body.data.member).toBeNull();
    });
  });

  describe('promotions', () => {
    it('keeps promotions off unless someone opts in, and records the choice', async () => {
      expect((await http().get(`${API}/notifications/preferences`).set(bearer(cy.token)).expect(200)).body.data).toMatchObject({ reminders: true, votes: true, promotions: false });
      await http().put(`${API}/notifications/preferences`).set(bearer(cy.token)).send({ promotions: true }).expect(200);
      await http().put(`${API}/notifications/preferences`).set(bearer(cy.token)).send({ promotions: true }).expect(200);
      await http().put(`${API}/notifications/preferences`).set(bearer(dee.token)).send({ promotions: true, push: false }).expect(200);
      const audit = await prisma.auditLog.findMany({ where: { action: 'notifications.promotions_on' } });
      expect(audit.map((a) => a.actorId).sort()).toEqual([cy.id, dee.id].sort());
    });

    it('sends to people who opted in, within the daily limit', async () => {
      await http().get(`${API}/admin/promotions`).set(bearer(moderator.token)).expect(403);
      expect((await http().get(`${API}/admin/promotions/audience?audience=ALL`).set(bearer(admin.token)).expect(200)).body.data.people).toBe(2);
      await prisma.user.update({ where: { id: cy.id }, data: { city: 'Pune' } });
      expect((await http().get(`${API}/admin/promotions/audience?audience=CITY&city=pune`).set(bearer(admin.token)).expect(200)).body.data.people).toBe(1);
      expect((await http().get(`${API}/admin/promotions/audience?audience=MEMBERS`).set(bearer(admin.token)).expect(200)).body.data.people).toBe(0);

      const send = (body: Record<string, unknown>) => http().post(`${API}/admin/promotions`).set(bearer(admin.token)).send({ title: 'Diwali treats', body: '20% off treats this week.', audience: 'ALL', ...body });
      expect((await send({ link: 'https://evil.example' }).expect(400)).body.message).toMatch(/page in the app/);
      await send({ audience: 'CITY' }).expect(400);
      const later = (await send({ title: 'Later', sendAt: hours(24).toISOString() }).expect(201)).body.data;
      const now = (await send({ link: '/shop' }).expect(201)).body.data;
      pushed.length = 0;
      const sender = worker.get(PromotionSender);
      await sender.sendDue();
      for (let i = 0; i < 60 && (await prisma.promotion.findUniqueOrThrow({ where: { id: now.id } })).status !== 'SENT'; i++) await new Promise((r) => setTimeout(r, 150));
      expect(await prisma.promotion.findUniqueOrThrow({ where: { id: now.id } })).toMatchObject({ status: 'SENT', recipients: 2 });
      expect((await notifications(cy, 'PROMOTION'))[0]).toMatchObject({ title: 'Diwali treats', body: '20% off treats this week.', link: '/shop' });
      expect(await notifications(ana, 'PROMOTION', false)).toHaveLength(0);
      // Dee turned push off: the promotion is in her list but not pushed.
      expect(await notifications(dee, 'PROMOTION', false)).toHaveLength(1);
      expect(pushed.filter((p) => p.data?.type === 'PROMOTION')).toHaveLength(await prisma.deviceToken.count({ where: { userId: cy.id } }));

      // A second promotion today: both already had today's one.
      const second = (await send({ title: 'Second today' }).expect(201)).body.data;
      await sender.sendDue();
      for (let i = 0; i < 60 && (await prisma.promotion.findUniqueOrThrow({ where: { id: second.id } })).status !== 'SENT'; i++) await new Promise((r) => setTimeout(r, 150));
      expect(await prisma.promotion.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({ status: 'SENT', recipients: 0 });

      await http().post(`${API}/admin/promotions/${later.id}/cancel`).set(bearer(admin.token)).expect(200);
      await http().post(`${API}/admin/promotions/${now.id}/cancel`).set(bearer(admin.token)).expect(400);
      const listed = (await http().get(`${API}/admin/promotions`).set(bearer(admin.token)).expect(200)).body;
      expect(listed.data.map((p: { status: string }) => p.status)).toEqual(['SENT', 'SENT', 'CANCELLED']);
      expect(listed.data[0].createdBy).toBe('Root Admin');
    });
  });
});
