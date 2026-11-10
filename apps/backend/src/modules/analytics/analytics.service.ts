import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { Prisma } from '../../generated/prisma/client';
import {
  addDays, fillSeries, istDay, parseRange, pct, previousRange, ratio, retention,
  type Kpi, type Range, type Report, type Table,
} from './analytics.rules';

export const ANALYTICS_TABS = ['users', 'reels', 'contests', 'marketplace', 'services'] as const;
export type AnalyticsTab = (typeof ANALYTICS_TABS)[number];

type Row = Record<string, unknown>;
type Body = Pick<Report, 'kpis' | 'series' | 'tables' | 'notes'>;
const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
/** India-time day of a timestamp column, for GROUP BY. */
const ist = (col: string) => Prisma.raw(`(${col} + interval '330 minutes')::date`);
/** Accounts that can sign in to the dashboard aren't customers: left out of user counts. */
const NOT_STAFF = Prisma.sql`NOT EXISTS (SELECT 1 FROM "UserRole" ur JOIN "Role" r ON r.id = ur."roleId" WHERE ur."userId" = u.id AND r."isStaff")`;
const PAID_BOOKING = Prisma.sql`b.status::text NOT IN ('PENDING_PAYMENT', 'EXPIRED')`;
const snippet = (s: unknown, max = 50) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t || '(no caption)';
};

/**
 * Admin analytics (spec §55): users, reels, contests, the shop and services, for any range of India-time days.
 * Everything is a total or an average; no report lists what a named customer did. Reports are cached for five
 * minutes (an hour for ranges that have ended).
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  range(from?: string, to?: string): Range {
    const r = parseRange(from, to);
    if ('problem' in r) throw new BadRequestException(r.problem);
    return r;
  }

  async report(tab: AnalyticsTab, from?: string, to?: string): Promise<Report> {
    const r = this.range(from, to);
    const key = `analytics:v1:${tab}:${r.from}:${r.to}`;
    const cached = await this.redis.client.get(key).catch(() => null);
    if (cached) return JSON.parse(cached) as Report;
    const body: Body = tab === 'users' ? await this.users(r) : tab === 'reels' ? await this.reels(r) : tab === 'contests' ? await this.contests(r)
      : tab === 'marketplace' ? await this.marketplace(r) : await this.services(r);
    const report: Report = { tab, from: r.from, to: r.to, days: r.days, generatedAt: new Date().toISOString(), ...body };
    const ended = r.to < istDay();
    await this.redis.client.set(key, JSON.stringify(report), 'EX', ended ? 3600 : 300).catch(() => undefined);
    return report;
  }

  /** Each KPI with the same figure for the period just before. */
  private async compare(r: Range, kpis: (r: Range) => Promise<Kpi[]>): Promise<Kpi[]> {
    const [now, before] = await Promise.all([kpis(r), kpis(previousRange(r))]);
    return now.map((k, i) => ({ ...k, previous: before[i]?.value ?? null }));
  }

  private q<T = Row>(sql: Prisma.Sql) {
    return this.prisma.$queryRaw<T[]>(sql);
  }

  // ───────────── users ─────────────

  private async users(r: Range): Promise<Body> {
    const kpis = (x: Range) => this.userKpis(x);
    const [figures, active, joined, cohortRows] = await Promise.all([
      this.compare(r, kpis),
      this.q(Prisma.sql`SELECT day, COUNT(*)::int AS value FROM "UserActivity" WHERE day BETWEEN ${r.from}::date AND ${r.to}::date GROUP BY day`),
      this.q(Prisma.sql`SELECT ${ist('u."createdAt"')} AS day, COUNT(*)::int AS value FROM "User" u
        WHERE u."createdAt" >= ${r.start} AND u."createdAt" < ${r.end} AND ${NOT_STAFF} GROUP BY 1`),
      this.cohorts(r),
    ]);
    // Weekly cohorts: people who joined in each 7-day block of the range, and how many came back.
    const weeks: Table['rows'] = [];
    for (let i = 0; i < r.days; i += 7) {
      const first = addDays(r.from, i);
      const last = addDays(r.from, Math.min(i + 6, r.days - 1));
      const block = cohortRows.filter((c) => c.day >= first && c.day <= last);
      const signups = block.reduce((a, c) => a + c.joined, 0);
      weeks.push({ week: first === last ? first : `${first} to ${last}`, signups, d1: retention(block, 1, r.to), d7: retention(block, 7, r.to), d30: retention(block, 30, r.to) });
    }
    return {
      kpis: figures,
      series: [
        { key: 'active', label: 'Daily active users', format: 'count', points: fillSeries(r, active as Array<{ day: Date; value: number }>) },
        { key: 'registrations', label: 'New sign-ups', format: 'count', points: fillSeries(r, joined as Array<{ day: Date; value: number }>) },
      ],
      tables: [{
        key: 'retention', label: 'Retention by sign-up week',
        columns: [{ key: 'week', label: 'Joined', format: 'text' }, { key: 'signups', label: 'Sign-ups', format: 'count' }, { key: 'd1', label: 'Day 1', format: 'pct' }, { key: 'd7', label: 'Day 7', format: 'pct' }, { key: 'd30', label: 'Day 30', format: 'pct' }],
        rows: weeks,
      }],
      notes: [
        'Active means signed in and used the app that day (India time). Staff accounts are left out.',
        'Retention: of the people who joined, the share who used the app again exactly 1, 7 or 30 days later. Blank until enough days have passed.',
        'Activity has been recorded since Phase 9d; earlier days show no active users.',
      ],
    };
  }

  private async userKpis(r: Range): Promise<Kpi[]> {
    const [[a], [m], [j], cohorts] = await Promise.all([
      this.q(Prisma.sql`SELECT COUNT(*)::int AS total, COUNT(DISTINCT "userId")::int AS people,
        COUNT(*) FILTER (WHERE day = ${r.to}::date)::int AS last FROM "UserActivity" WHERE day BETWEEN ${r.from}::date AND ${r.to}::date`),
      this.q(Prisma.sql`SELECT COUNT(DISTINCT "userId")::int AS mau FROM "UserActivity" WHERE day > ${r.to}::date - 30 AND day <= ${r.to}::date`),
      this.q(Prisma.sql`SELECT COUNT(*)::int AS joined FROM "User" u WHERE u."createdAt" >= ${r.start} AND u."createdAt" < ${r.end} AND ${NOT_STAFF}`),
      this.cohorts(r),
    ]);
    const dau = ratio(n(a.total), r.days);
    return [
      { key: 'dau', label: 'Daily active users (average)', value: dau, format: 'count' },
      { key: 'lastDay', label: `Active on ${r.to}`, value: n(a.last), format: 'count' },
      { key: 'mau', label: 'Monthly active users', value: n(m.mau), format: 'count', hint: `Used the app in the 30 days to ${r.to}` },
      { key: 'activePeople', label: 'Active in this period', value: n(a.people), format: 'count' },
      { key: 'registrations', label: 'New sign-ups', value: n(j.joined), format: 'count' },
      { key: 'stickiness', label: 'Daily ÷ monthly active', value: dau === null ? null : pct(dau, n(m.mau)), format: 'pct', hint: 'How often monthly users come back' },
      { key: 'd1', label: 'Day-1 retention', value: retention(cohorts, 1, r.to), format: 'pct' },
      { key: 'd7', label: 'Day-7 retention', value: retention(cohorts, 7, r.to), format: 'pct' },
      { key: 'd30', label: 'Day-30 retention', value: retention(cohorts, 30, r.to), format: 'pct' },
    ];
  }

  private async cohorts(r: Range) {
    const rows = await this.q(Prisma.sql`
      SELECT j.day::text AS day, COUNT(*)::int AS joined,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "UserActivity" a WHERE a."userId" = j.id AND a.day = j.day + 1))::int AS d1,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "UserActivity" a WHERE a."userId" = j.id AND a.day = j.day + 7))::int AS d7,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "UserActivity" a WHERE a."userId" = j.id AND a.day = j.day + 30))::int AS d30
      FROM (SELECT u.id, ${ist('u."createdAt"')} AS day FROM "User" u WHERE u."createdAt" >= ${r.start} AND u."createdAt" < ${r.end} AND ${NOT_STAFF}) j
      GROUP BY j.day`);
    return rows.map((c) => ({ day: String(c.day), joined: n(c.joined), back: { 1: n(c.d1), 7: n(c.d7), 30: n(c.d30) } as Record<number, number> }));
  }

  // ───────────── reels ─────────────

  private async reels(r: Range): Promise<Body> {
    const [figures, views, engagement, top] = await Promise.all([
      this.compare(r, (x) => this.reelKpis(x)),
      this.q(Prisma.sql`SELECT s.day, SUM(s.views)::int AS views, SUM(s.completions)::int AS completions FROM "PostDailyStat" s JOIN "Post" p ON p.id = s."postId"
        WHERE p.type = 'REEL' AND s.day BETWEEN ${r.from}::date AND ${r.to}::date GROUP BY s.day`),
      this.q(Prisma.sql`SELECT day, SUM(c)::int AS value FROM (
          SELECT ${ist('l."createdAt"')} AS day, COUNT(*) AS c FROM "PostLike" l JOIN "Post" p ON p.id = l."postId" WHERE p.type = 'REEL' AND l."createdAt" >= ${r.start} AND l."createdAt" < ${r.end} GROUP BY 1
          UNION ALL SELECT ${ist('c."createdAt"')}, COUNT(*) FROM "Comment" c JOIN "Post" p ON p.id = c."postId" WHERE p.type = 'REEL' AND c."deletedAt" IS NULL AND c."createdAt" >= ${r.start} AND c."createdAt" < ${r.end} GROUP BY 1
          UNION ALL SELECT ${ist('s."createdAt"')}, COUNT(*) FROM "PostShare" s JOIN "Post" p ON p.id = s."postId" WHERE p.type = 'REEL' AND s."createdAt" >= ${r.start} AND s."createdAt" < ${r.end} GROUP BY 1
          UNION ALL SELECT ${ist('v."createdAt"')}, COUNT(*) FROM "PostSave" v JOIN "Post" p ON p.id = v."postId" WHERE p.type = 'REEL' AND v."createdAt" >= ${r.start} AND v."createdAt" < ${r.end} GROUP BY 1
        ) x GROUP BY day`),
      this.q(Prisma.sql`SELECT p.id, p.caption, u.name AS author, SUM(s.views)::int AS views, SUM(s.completions)::int AS completions,
          (SELECT COUNT(*)::int FROM "PostLike" l WHERE l."postId" = p.id AND l."createdAt" >= ${r.start} AND l."createdAt" < ${r.end}) AS likes,
          (SELECT COUNT(*)::int FROM "PostShare" h WHERE h."postId" = p.id AND h."createdAt" >= ${r.start} AND h."createdAt" < ${r.end}) AS shares
        FROM "PostDailyStat" s JOIN "Post" p ON p.id = s."postId" JOIN "User" u ON u.id = p."authorId"
        WHERE p.type = 'REEL' AND p."deletedAt" IS NULL AND s.day BETWEEN ${r.from}::date AND ${r.to}::date
        GROUP BY p.id, u.name ORDER BY views DESC, p.id LIMIT 10`),
    ]);
    const typed = views as Array<{ day: Date; views: number; completions: number }>;
    return {
      kpis: figures,
      series: [
        { key: 'views', label: 'Views', format: 'count', points: fillSeries(r, typed.map((v) => ({ day: v.day, value: v.views }))) },
        { key: 'completions', label: 'Watched to the end', format: 'count', points: fillSeries(r, typed.map((v) => ({ day: v.day, value: v.completions }))) },
        { key: 'engagement', label: 'Likes, comments, shares and saves', format: 'count', points: fillSeries(r, engagement as Array<{ day: Date; value: number }>) },
      ],
      tables: [{
        key: 'top', label: 'Most-viewed reels',
        columns: [{ key: 'caption', label: 'Reel', format: 'text' }, { key: 'author', label: 'By', format: 'text' }, { key: 'views', label: 'Views', format: 'count' }, { key: 'completion', label: 'Watched to the end', format: 'pct' }, { key: 'likes', label: 'Likes', format: 'count' }, { key: 'shares', label: 'Shares', format: 'count' }],
        rows: top.map((t) => ({ id: String(t.id), caption: snippet(t.caption), author: String(t.author ?? ''), views: n(t.views), completion: pct(n(t.completions), n(t.views)), likes: n(t.likes), shares: n(t.shares) })),
      }],
      notes: [
        'A view counts once per viewer per reel per day. “Watched to the end” is reported by the app when a reel plays to its last frame.',
        'Engagement rate = likes, comments, shares and saves ÷ views. Likes that were later taken back are not counted.',
        'Daily view counts have been recorded since Phase 9d.',
      ],
    };
  }

  private async reelKpis(r: Range): Promise<Kpi[]> {
    const [[v], [e], [p]] = await Promise.all([
      this.q(Prisma.sql`SELECT COALESCE(SUM(s.views), 0)::int AS views, COALESCE(SUM(s.completions), 0)::int AS completions FROM "PostDailyStat" s JOIN "Post" p ON p.id = s."postId"
        WHERE p.type = 'REEL' AND s.day BETWEEN ${r.from}::date AND ${r.to}::date`),
      this.q(Prisma.sql`SELECT
          (SELECT COUNT(*) FROM "PostLike" l JOIN "Post" p ON p.id = l."postId" WHERE p.type = 'REEL' AND l."createdAt" >= ${r.start} AND l."createdAt" < ${r.end})::int AS likes,
          (SELECT COUNT(*) FROM "Comment" c JOIN "Post" p ON p.id = c."postId" WHERE p.type = 'REEL' AND c."deletedAt" IS NULL AND c."createdAt" >= ${r.start} AND c."createdAt" < ${r.end})::int AS comments,
          (SELECT COUNT(*) FROM "PostShare" s JOIN "Post" p ON p.id = s."postId" WHERE p.type = 'REEL' AND s."createdAt" >= ${r.start} AND s."createdAt" < ${r.end})::int AS shares,
          (SELECT COUNT(*) FROM "PostSave" s JOIN "Post" p ON p.id = s."postId" WHERE p.type = 'REEL' AND s."createdAt" >= ${r.start} AND s."createdAt" < ${r.end})::int AS saves`),
      this.q(Prisma.sql`SELECT COUNT(*)::int AS published, COUNT(DISTINCT "authorId")::int AS creators FROM "Post"
        WHERE type = 'REEL' AND status = 'PUBLISHED' AND "deletedAt" IS NULL AND "publishedAt" >= ${r.start} AND "publishedAt" < ${r.end}`),
    ]);
    const views = n(v.views);
    const interactions = n(e.likes) + n(e.comments) + n(e.shares) + n(e.saves);
    return [
      { key: 'views', label: 'Views', value: views, format: 'count' },
      { key: 'completionRate', label: 'Completion rate', value: pct(n(v.completions), views), format: 'pct', hint: 'Views watched to the end' },
      { key: 'likes', label: 'Likes', value: n(e.likes), format: 'count' },
      { key: 'comments', label: 'Comments', value: n(e.comments), format: 'count' },
      { key: 'shares', label: 'Shares', value: n(e.shares), format: 'count' },
      { key: 'saves', label: 'Saves', value: n(e.saves), format: 'count' },
      { key: 'engagementRate', label: 'Engagement rate', value: pct(interactions, views), format: 'pct' },
      { key: 'published', label: 'Reels published', value: n(p.published), format: 'count' },
      { key: 'creators', label: 'People who posted reels', value: n(p.creators), format: 'count' },
    ];
  }

  // ───────────── contests ─────────────

  private async contests(r: Range): Promise<Body> {
    const [figures, regs, votes, table] = await Promise.all([
      this.compare(r, (x) => this.contestKpis(x)),
      this.q(Prisma.sql`SELECT ${ist('"registeredAt"')} AS day, COUNT(*)::int AS value FROM "ContestParticipant" WHERE "registeredAt" >= ${r.start} AND "registeredAt" < ${r.end} GROUP BY 1`),
      this.q(Prisma.sql`SELECT ${ist('"createdAt"')} AS day, COUNT(*)::int AS value FROM "ContestVote" WHERE "createdAt" >= ${r.start} AND "createdAt" < ${r.end} GROUP BY 1`),
      this.q(Prisma.sql`
        SELECT c.id, c.title, c.status::text AS status,
          (SELECT COUNT(*)::int FROM "ContestParticipant" p WHERE p."contestId" = c.id AND p."registeredAt" >= ${r.start} AND p."registeredAt" < ${r.end}) AS registrations,
          (SELECT COUNT(DISTINCT p."userId")::int FROM "ContestParticipant" p WHERE p."contestId" = c.id AND p."registeredAt" IS NOT NULL AND p.status::text <> 'WITHDRAWN') AS participants,
          (SELECT COUNT(*)::int FROM "ContestVote" v WHERE v."contestId" = c.id AND v."createdAt" >= ${r.start} AND v."createdAt" < ${r.end}) AS votes,
          (SELECT COALESCE(SUM(y."amountPaise"), 0)::int FROM "Payment" y WHERE y.purpose = 'CONTEST_REGISTRATION' AND y."referenceId" = c.id AND y."capturedAt" >= ${r.start} AND y."capturedAt" < ${r.end}) AS fees,
          (SELECT COUNT(*)::int FROM "ContestParticipant" p WHERE p."contestId" = c.id AND p.status::text = 'WINNER') AS winners
        FROM "Contest" c
        WHERE c.status::text NOT IN ('DRAFT', 'REVIEW') AND (
          c.status::text IN ('SCHEDULED', 'LIVE', 'VOTING', 'EVALUATION', 'WINNER_DECLARATION')
          OR EXISTS (SELECT 1 FROM "ContestParticipant" p WHERE p."contestId" = c.id AND p."registeredAt" >= ${r.start} AND p."registeredAt" < ${r.end})
          OR EXISTS (SELECT 1 FROM "ContestVote" v WHERE v."contestId" = c.id AND v."createdAt" >= ${r.start} AND v."createdAt" < ${r.end}))
        ORDER BY votes DESC, registrations DESC, c."createdAt" DESC LIMIT 20`),
    ]);
    return {
      kpis: figures,
      series: [
        { key: 'registrations', label: 'Registrations', format: 'count', points: fillSeries(r, regs as Array<{ day: Date; value: number }>) },
        { key: 'votes', label: 'Votes', format: 'count', points: fillSeries(r, votes as Array<{ day: Date; value: number }>) },
      ],
      tables: [{
        key: 'contests', label: 'Contests',
        columns: [{ key: 'title', label: 'Contest', format: 'text' }, { key: 'status', label: 'Status', format: 'text' }, { key: 'registrations', label: 'Registrations', format: 'count' }, { key: 'participants', label: 'Participants (all time)', format: 'count' }, { key: 'votes', label: 'Votes', format: 'count' }, { key: 'fees', label: 'Entry fees', format: 'paise' }, { key: 'winners', label: 'Winners', format: 'count' }],
        rows: table.map((t) => ({ id: String(t.id), title: String(t.title), status: String(t.status), registrations: n(t.registrations), participants: n(t.participants), votes: n(t.votes), fees: n(t.fees), winners: n(t.winners) })),
      }],
      notes: [
        'Registrations count entries confirmed in the period (paid, or free). Entry fees are what was paid in the period, before refunds.',
        'Votes held for review are suspected fraud; they count only if a moderator approves them.',
      ],
    };
  }

  private async contestKpis(r: Range): Promise<Kpi[]> {
    const [[p], [v], [f], [w], [live]] = await Promise.all([
      this.q(Prisma.sql`SELECT COUNT(*)::int AS registrations, COUNT(DISTINCT "userId")::int AS people FROM "ContestParticipant" WHERE "registeredAt" >= ${r.start} AND "registeredAt" < ${r.end}`),
      this.q(Prisma.sql`SELECT COUNT(*)::int AS votes, COUNT(*) FILTER (WHERE flagged AND "reviewedAt" IS NULL)::int AS held, COUNT(DISTINCT "voterId")::int AS voters
        FROM "ContestVote" WHERE "createdAt" >= ${r.start} AND "createdAt" < ${r.end}`),
      this.q(Prisma.sql`SELECT COALESCE(SUM(y."amountPaise"), 0)::int AS fees,
          (SELECT COALESCE(SUM(f."amountPaise"), 0)::int FROM "Refund" f JOIN "Payment" q ON q.id = f."paymentId" WHERE q.purpose = 'CONTEST_REGISTRATION' AND f."createdAt" >= ${r.start} AND f."createdAt" < ${r.end}) AS refunded
        FROM "Payment" y WHERE y.purpose = 'CONTEST_REGISTRATION' AND y."capturedAt" >= ${r.start} AND y."capturedAt" < ${r.end}`),
      this.q(Prisma.sql`SELECT COUNT(*)::int AS winners FROM "ContestParticipant" WHERE status::text = 'WINNER' AND "updatedAt" >= ${r.start} AND "updatedAt" < ${r.end}`),
      this.q(Prisma.sql`SELECT COUNT(*)::int AS live FROM "Contest" WHERE status::text IN ('LIVE', 'VOTING')`),
    ]);
    return [
      { key: 'registrations', label: 'Registrations', value: n(p.registrations), format: 'count' },
      { key: 'participants', label: 'People who entered', value: n(p.people), format: 'count' },
      { key: 'fees', label: 'Entry fees paid', value: n(f.fees), format: 'paise' },
      { key: 'refunded', label: 'Entry fees refunded', value: n(f.refunded), format: 'paise' },
      { key: 'votes', label: 'Votes', value: n(v.votes), format: 'count' },
      { key: 'voters', label: 'People who voted', value: n(v.voters), format: 'count' },
      { key: 'held', label: 'Votes held for review', value: n(v.held), format: 'count' },
      { key: 'winners', label: 'Winners declared', value: n(w.winners), format: 'count' },
      { key: 'live', label: 'Contests open or voting now', value: n(live.live), format: 'count', hint: 'Right now, whatever the dates chosen' },
    ];
  }

  // ───────────── marketplace ─────────────

  private async marketplace(r: Range): Promise<Body> {
    const [figures, daily, sellers] = await Promise.all([
      this.compare(r, (x) => this.shopKpis(x)),
      this.q(Prisma.sql`SELECT ${ist('y."capturedAt"')} AS day, COUNT(*)::int AS orders, SUM(o."totalPaise")::bigint AS gmv
        FROM "Order" o JOIN "Payment" y ON y.id = o."paymentId" WHERE y."capturedAt" >= ${r.start} AND y."capturedAt" < ${r.end} GROUP BY 1`),
      this.q(Prisma.sql`SELECT v.id, v."businessName" AS seller, COUNT(s.id)::int AS parcels, SUM(s."totalPaise")::bigint AS gmv,
          (SELECT COUNT(*)::int FROM "ReturnRequest" x JOIN "SubOrder" t ON t.id = x."subOrderId" WHERE t."vendorId" = v.id AND x."createdAt" >= ${r.start} AND x."createdAt" < ${r.end}) AS returns,
          COUNT(s.id) FILTER (WHERE s.status::text = 'CANCELLED')::int AS cancelled, v."ratingAvg" AS rating
        FROM "SubOrder" s JOIN "Order" o ON o.id = s."orderId" JOIN "Payment" y ON y.id = o."paymentId" JOIN "Vendor" v ON v.id = s."vendorId"
        WHERE y."capturedAt" >= ${r.start} AND y."capturedAt" < ${r.end}
        GROUP BY v.id ORDER BY gmv DESC, v.id LIMIT 20`),
    ]);
    const d = daily as Array<{ day: Date; orders: number; gmv: bigint }>;
    return {
      kpis: figures,
      series: [
        { key: 'orders', label: 'Orders', format: 'count', points: fillSeries(r, d.map((x) => ({ day: x.day, value: x.orders }))) },
        { key: 'gmv', label: 'Gross sales (GMV)', format: 'paise', points: fillSeries(r, d.map((x) => ({ day: x.day, value: x.gmv }))) },
      ],
      tables: [{
        key: 'sellers', label: 'Top sellers',
        columns: [{ key: 'seller', label: 'Seller', format: 'text' }, { key: 'parcels', label: 'Parcels', format: 'count' }, { key: 'gmv', label: 'Gross sales', format: 'paise' }, { key: 'cancelled', label: 'Cancelled', format: 'count' }, { key: 'returns', label: 'Returns asked', format: 'count' }, { key: 'rating', label: 'Rating', format: 'text' }],
        rows: sellers.map((s) => ({ id: String(s.id), seller: String(s.seller), parcels: n(s.parcels), gmv: n(s.gmv), cancelled: n(s.cancelled), returns: n(s.returns), rating: n(s.rating) > 0 ? n(s.rating).toFixed(1) : '–' })),
      }],
      notes: [
        'Orders count when they are paid. GMV is what customers paid, including shipping and after coupons, before cancellations and returns.',
        'Return rate = returns asked for ÷ parcels delivered in the same period.',
      ],
    };
  }

  private async shopKpis(r: Range): Promise<Kpi[]> {
    const [[o], [u], [x]] = await Promise.all([
      this.q(Prisma.sql`SELECT COUNT(*)::int AS orders, COALESCE(SUM(o."totalPaise"), 0)::bigint AS gmv, COALESCE(SUM(o."discountPaise"), 0)::bigint AS discounts, COUNT(DISTINCT o."userId")::int AS buyers
        FROM "Order" o JOIN "Payment" y ON y.id = o."paymentId" WHERE y."capturedAt" >= ${r.start} AND y."capturedAt" < ${r.end}`),
      this.q(Prisma.sql`SELECT COALESCE(SUM(i.qty), 0)::int AS units FROM "OrderItem" i JOIN "SubOrder" s ON s.id = i."subOrderId" JOIN "Order" o ON o.id = s."orderId" JOIN "Payment" y ON y.id = o."paymentId"
        WHERE y."capturedAt" >= ${r.start} AND y."capturedAt" < ${r.end}`),
      this.q(Prisma.sql`SELECT
          (SELECT COUNT(*) FROM "ReturnRequest" WHERE "createdAt" >= ${r.start} AND "createdAt" < ${r.end})::int AS returns,
          (SELECT COUNT(*) FROM "SubOrder" WHERE "deliveredAt" >= ${r.start} AND "deliveredAt" < ${r.end})::int AS delivered,
          (SELECT COUNT(*) FROM "SubOrder" WHERE "cancelledAt" >= ${r.start} AND "cancelledAt" < ${r.end})::int AS cancelled,
          (SELECT COALESCE(SUM(f."amountPaise"), 0) FROM "Refund" f JOIN "Payment" q ON q.id = f."paymentId" WHERE q.purpose = 'PRODUCT_ORDER' AND f."createdAt" >= ${r.start} AND f."createdAt" < ${r.end})::bigint AS refunded`),
    ]);
    const orders = n(o.orders);
    const gmv = n(o.gmv);
    return [
      { key: 'orders', label: 'Orders', value: orders, format: 'count' },
      { key: 'gmv', label: 'Gross sales (GMV)', value: gmv, format: 'paise' },
      { key: 'aov', label: 'Average order value', value: ratio(gmv, orders), format: 'paise' },
      { key: 'units', label: 'Items sold', value: n(u.units), format: 'count' },
      { key: 'buyers', label: 'Buyers', value: n(o.buyers), format: 'count' },
      { key: 'discounts', label: 'Coupon discounts', value: n(o.discounts), format: 'paise' },
      { key: 'cancelled', label: 'Parcels cancelled', value: n(x.cancelled), format: 'count' },
      { key: 'returns', label: 'Returns asked for', value: n(x.returns), format: 'count' },
      { key: 'returnRate', label: 'Return rate', value: pct(n(x.returns), n(x.delivered)), format: 'pct' },
      { key: 'refunded', label: 'Refunded', value: n(x.refunded), format: 'paise' },
    ];
  }

  // ───────────── services ─────────────

  private async services(r: Range): Promise<Body> {
    const [figures, daily, partners] = await Promise.all([
      this.compare(r, (x) => this.serviceKpis(x)),
      this.q(Prisma.sql`SELECT ${ist('b."createdAt"')} AS day, COUNT(*)::int AS bookings, SUM(b."pricePaise")::bigint AS value FROM "Booking" b
        WHERE ${PAID_BOOKING} AND b."createdAt" >= ${r.start} AND b."createdAt" < ${r.end} GROUP BY 1`),
      this.q(Prisma.sql`SELECT sp.id, sp."businessName" AS partner, COUNT(*)::int AS bookings,
          COUNT(*) FILTER (WHERE b.status::text = 'COMPLETED')::int AS completed,
          COUNT(*) FILTER (WHERE b.status::text = 'CANCELLED' AND b."cancelledBy" = 'PARTNER')::int AS "partnerCancelled",
          COUNT(*) FILTER (WHERE b.status::text = 'CANCELLED')::int AS cancelled,
          COUNT(*) FILTER (WHERE b.status::text = 'NO_SHOW')::int AS "noShow",
          SUM(b."pricePaise")::bigint AS value, sp."ratingAvg" AS rating, sp."ratingCount" AS reviews
        FROM "Booking" b JOIN "ServicePartner" sp ON sp.id = b."partnerId"
        WHERE ${PAID_BOOKING} AND b."createdAt" >= ${r.start} AND b."createdAt" < ${r.end}
        GROUP BY sp.id ORDER BY bookings DESC, value DESC, sp.id LIMIT 20`),
    ]);
    const d = daily as Array<{ day: Date; bookings: number; value: bigint }>;
    return {
      kpis: figures,
      series: [
        { key: 'bookings', label: 'Bookings', format: 'count', points: fillSeries(r, d.map((x) => ({ day: x.day, value: x.bookings }))) },
        { key: 'value', label: 'Booking value', format: 'paise', points: fillSeries(r, d.map((x) => ({ day: x.day, value: x.value }))) },
      ],
      tables: [{
        key: 'partners', label: 'Partner performance',
        columns: [{ key: 'partner', label: 'Partner', format: 'text' }, { key: 'bookings', label: 'Bookings', format: 'count' }, { key: 'completed', label: 'Completed', format: 'count' }, { key: 'cancelRate', label: 'Cancelled', format: 'pct' }, { key: 'partnerCancelled', label: 'Cancelled by partner', format: 'count' }, { key: 'noShow', label: 'No-shows', format: 'count' }, { key: 'value', label: 'Value', format: 'paise' }, { key: 'rating', label: 'Rating', format: 'text' }],
        rows: partners.map((p) => ({
          id: String(p.id), partner: String(p.partner), bookings: n(p.bookings), completed: n(p.completed), cancelRate: pct(n(p.cancelled), n(p.bookings)),
          partnerCancelled: n(p.partnerCancelled), noShow: n(p.noShow), value: n(p.value), rating: n(p.reviews) > 0 ? `${n(p.rating).toFixed(1)} (${n(p.reviews)})` : '–',
        })),
      }],
      notes: [
        'Bookings count when they were made and paid for; cancellations and no-shows are of the bookings made in the period.',
        'Revenue is PetApp’s booking fee on visits completed in the period (GST included).',
      ],
    };
  }

  private async serviceKpis(r: Range): Promise<Kpi[]> {
    const [[b], [c]] = await Promise.all([
      this.q(Prisma.sql`SELECT COUNT(*)::int AS bookings, COALESCE(SUM(b."pricePaise"), 0)::bigint AS value, COUNT(DISTINCT b."customerId")::int AS customers,
          COUNT(*) FILTER (WHERE b.status::text = 'CANCELLED')::int AS cancelled,
          COUNT(*) FILTER (WHERE b.status::text = 'CANCELLED' AND b."cancelledBy" = 'PARTNER')::int AS "byPartner",
          COUNT(*) FILTER (WHERE b.status::text = 'NO_SHOW')::int AS "noShow",
          COUNT(*) FILTER (WHERE b.mode::text = 'AT_HOME')::int AS "atHome"
        FROM "Booking" b WHERE ${PAID_BOOKING} AND b."createdAt" >= ${r.start} AND b."createdAt" < ${r.end}`),
      this.q(Prisma.sql`SELECT COUNT(*)::int AS completed, COALESCE(SUM(b."platformFeePaise"), 0)::bigint AS fees FROM "Booking" b
        WHERE b.status::text = 'COMPLETED' AND b."completedAt" >= ${r.start} AND b."completedAt" < ${r.end}`),
    ]);
    const bookings = n(b.bookings);
    return [
      { key: 'bookings', label: 'Bookings', value: bookings, format: 'count' },
      { key: 'value', label: 'Booking value', value: n(b.value), format: 'paise' },
      { key: 'average', label: 'Average booking', value: ratio(n(b.value), bookings), format: 'paise' },
      { key: 'customers', label: 'Customers who booked', value: n(b.customers), format: 'count' },
      { key: 'completed', label: 'Visits completed', value: n(c.completed), format: 'count' },
      { key: 'revenue', label: 'PetApp booking fees', value: n(c.fees), format: 'paise' },
      { key: 'cancelRate', label: 'Cancellation rate', value: pct(n(b.cancelled), bookings), format: 'pct' },
      { key: 'partnerCancelRate', label: 'Cancelled by partners', value: pct(n(b.byPartner), bookings), format: 'pct' },
      { key: 'noShowRate', label: 'No-show rate', value: pct(n(b.noShow), bookings), format: 'pct' },
      { key: 'atHome', label: 'Home visits', value: pct(n(b.atHome), bookings), format: 'pct' },
    ];
  }
}
