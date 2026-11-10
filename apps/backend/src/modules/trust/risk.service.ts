import { Injectable, NotFoundException } from '@nestjs/common';
import { isIP } from 'net';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { Paged } from '../../common/dto/pagination.dto';
import { AuditService } from '../audit/audit.service';
import { PlatformService } from '../platform/platform.service';
import { SAME_PHOTO_DISTANCE, accountRisk, needsReview, type RiskSignals } from './trust.rules';

/** Loopback and private networks say nothing about a person (development, office NAT behind a proxy, our own servers). */
export function isPublicIp(ip: string | null | undefined): ip is string {
  if (!ip) return false;
  const a = ip.replace(/^::ffff:/, '');
  if (!isIP(a)) return false;
  if (a === '::1' || a.startsWith('127.') || a.startsWith('10.') || a.startsWith('192.168.') || a.startsWith('169.254.') || /^fe80:|^f[cd]/i.test(a)) return false;
  const m = /^172\.(\d+)\./.exec(a);
  return !(m && Number(m[1]) >= 16 && Number(m[1]) <= 31);
}

/**
 * Account fraud-risk scoring (spec §14). A score from automated signals helps staff decide whom to look at; it never
 * bans or blocks anyone. High-risk accounts' contest votes can be held for review (a setting), which is reversible.
 */
@Injectable()
export class RiskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: PlatformService,
    private readonly audit: AuditService,
  ) {}

  async signals(userId: string): Promise<RiskSignals | null> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true, phoneVerifiedAt: true, deletedAt: true } });
    if (!u || u.deletedAt) return null;
    const now = Date.now();
    const d7 = new Date(now - 7 * 86_400_000);
    const d30 = new Date(now - 30 * 86_400_000);
    const d1 = new Date(now - 86_400_000);
    const ips = [...new Set((await this.prisma.session.findMany({ where: { userId, createdAt: { gte: d7 } }, select: { ipAddress: true } })).map((s) => s.ipAddress).filter(isPublicIp))];
    const [shared, flaggedVotes30d, votes24h, [{ n: anomalies }], [{ n: copied }], aiFlags30d, [{ n: cases }]] = await Promise.all([
      ips.length
        ? this.prisma.session.findMany({ where: { ipAddress: { in: ips }, userId: { not: userId }, createdAt: { gte: d7 } }, select: { userId: true }, distinct: ['userId'] })
        : Promise.resolve([]),
      this.prisma.contestVote.count({ where: { voterId: userId, flagged: true, createdAt: { gte: d30 } } }),
      this.prisma.contestVote.count({ where: { voterId: userId, createdAt: { gte: d1 } } }),
      this.prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT COUNT(*) AS n FROM "AuditLog" a
        WHERE a.action IN ('payment.signature_invalid', 'payment.amount_mismatch') AND a."createdAt" >= ${d30}
          AND (a."actorId" = ${userId}::uuid OR a."entityId" IN (SELECT id::text FROM "Payment" WHERE "userId" = ${userId}::uuid))`,
      this.prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT COUNT(*) AS n FROM "MediaAsset" m
        WHERE m."ownerId" = ${userId}::uuid AND m."createdAt" >= ${d30} AND m."perceptualHash" IS NOT NULL
          AND m."perceptualHash" NOT IN ('0000000000000000', 'ffffffffffffffff')
          AND EXISTS (
            SELECT 1 FROM "MediaAsset" o
            WHERE o."ownerId" <> m."ownerId" AND o."perceptualHash" IS NOT NULL AND o."createdAt" < m."createdAt"
              AND bit_count(('x' || o."perceptualHash")::bit(64) # ('x' || m."perceptualHash")::bit(64)) <= ${SAME_PHOTO_DISTANCE})`,
      this.prisma.aiAssessment.count({ where: { ownerId: userId, verdict: 'FLAGGED', createdAt: { gte: d30 } } }),
      this.prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT COUNT(*) AS n FROM "ModerationCase" c
        WHERE c.status = 'OPEN' AND (
          (c."targetType" = 'USER' AND c."targetId" = ${userId}::uuid)
          OR (c."targetType" = 'POST' AND c."targetId" IN (SELECT id FROM "Post" WHERE "authorId" = ${userId}::uuid))
          OR (c."targetType" = 'COMMENT' AND c."targetId" IN (SELECT id FROM "Comment" WHERE "authorId" = ${userId}::uuid))
          OR (c."targetType" = 'PET' AND c."targetId" IN (SELECT id FROM "Pet" WHERE "ownerId" = ${userId}::uuid)))`,
    ]);
    return {
      accountAgeHours: (now - u.createdAt.getTime()) / 3_600_000,
      phoneVerified: !!u.phoneVerifiedAt,
      sharedNetworkAccounts: shared.length,
      flaggedVotes30d,
      votes24h,
      paymentAnomalies30d: Number(anomalies),
      copiedPhotos30d: Number(copied),
      aiFlags30d,
      openCases: Number(cases),
    };
  }

  /** Recomputes and stores the account's score. Returns it (null for a deleted or unknown account). */
  async score(userId: string) {
    const s = await this.signals(userId);
    if (!s) return null;
    const [reviewScore, mediumScore] = await Promise.all([this.platform.getSetting<number>('risk.reviewScore'), this.platform.getSetting<number>('risk.mediumScore')]);
    const r = accountRisk(s, reviewScore, mediumScore);
    const before = await this.prisma.accountRisk.findUnique({ where: { userId } });
    const data = { score: r.score, level: r.level, signals: r.signals as unknown as Prisma.InputJsonValue, computedAt: new Date() };
    const saved = await this.prisma.accountRisk.upsert({ where: { userId }, update: data, create: { userId, ...data } });
    if (r.level === 'HIGH' && before?.level !== 'HIGH') {
      await this.audit.log({ actorId: null, action: 'risk.high', entityType: 'User', entityId: userId, after: { score: r.score, signals: r.signals.map((x) => x.signal) } });
    }
    return saved;
  }

  /** Is this account waiting for a staff review (high risk, not yet looked at at this level)? */
  async underReview(userId: string): Promise<boolean> {
    const r = await this.prisma.accountRisk.findUnique({ where: { userId }, select: { level: true, score: true, reviewedScore: true } });
    return !!r && needsReview(r.level, r.score, r.reviewedScore);
  }

  /** Nightly: accounts that signed in, voted or were created in the last two days. */
  async sweep(limit = 5000) {
    const since = new Date(Date.now() - 2 * 86_400_000);
    const ids = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT DISTINCT id FROM (
        SELECT "userId" AS id FROM "Session" WHERE "createdAt" >= ${since}
        UNION SELECT "voterId" FROM "ContestVote" WHERE "createdAt" >= ${since}
        UNION SELECT id FROM "User" WHERE "createdAt" >= ${since} AND "deletedAt" IS NULL
      ) x LIMIT ${limit}`;
    let high = 0;
    for (const { id } of ids) if ((await this.score(id))?.level === 'HIGH') high++;
    return { scored: ids.length, high };
  }

  // ───────────── staff ─────────────

  async list(q: { skip: number; limit: number; page: number; level?: 'LOW' | 'MEDIUM' | 'HIGH'; state?: 'to_review' | 'reviewed' | 'all' }) {
    const state = q.state ?? 'to_review';
    const include = { user: { select: { id: true, name: true, phone: true, email: true, status: true, createdAt: true } } } as const;
    if (state === 'all') {
      const where: Prisma.AccountRiskWhereInput = { level: q.level };
      const [rows, total] = await Promise.all([
        this.prisma.accountRisk.findMany({ where, orderBy: [{ score: 'desc' }, { computedAt: 'desc' }], skip: q.skip, take: q.limit, include }),
        this.prisma.accountRisk.count({ where }),
      ]);
      return Paged.of(rows.map((r) => this.view(r)), total, q);
    }
    // Waiting for review / reviewed: only high-risk accounts, which are few; the "risen by 10+" rule is applied here.
    const rows = await this.prisma.accountRisk.findMany({ where: { level: 'HIGH' }, orderBy: [{ score: 'desc' }, { computedAt: 'desc' }], take: 5000, include });
    const filtered = rows.filter((r) => (state === 'reviewed' ? !!r.reviewedAt && !needsReview(r.level, r.score, r.reviewedScore) : needsReview(r.level, r.score, r.reviewedScore)));
    return Paged.of(filtered.slice(q.skip, q.skip + q.limit).map((r) => this.view(r)), filtered.length, q);
  }

  async detail(userId: string) {
    const r = await this.prisma.accountRisk.findUnique({ where: { userId }, include: { user: { select: { id: true, name: true, phone: true, email: true, status: true, createdAt: true } } } });
    if (!r) throw new NotFoundException('No risk score for this account yet.');
    const reviewer = r.reviewedById ? await this.prisma.user.findUnique({ where: { id: r.reviewedById }, select: { id: true, name: true, email: true } }) : null;
    return { ...this.view(r), reviewedBy: reviewer };
  }

  async review(actorId: string, userId: string, note: string) {
    const r = await this.prisma.accountRisk.findUnique({ where: { userId } });
    if (!r) throw new NotFoundException('No risk score for this account yet.');
    const saved = await this.prisma.accountRisk.update({ where: { userId }, data: { reviewedAt: new Date(), reviewedById: actorId, reviewNote: note, reviewedScore: r.score } });
    await this.audit.log({ actorId, action: 'risk.review', entityType: 'User', entityId: userId, after: { score: r.score, note } });
    return this.detail(saved.userId);
  }

  private view(r: Prisma.AccountRiskGetPayload<{ include: { user: { select: { id: true; name: true; phone: true; email: true; status: true; createdAt: true } } } }>) {
    return {
      userId: r.userId, score: r.score, level: r.level, signals: r.signals, computedAt: r.computedAt,
      needsReview: needsReview(r.level, r.score, r.reviewedScore),
      reviewedAt: r.reviewedAt, reviewNote: r.reviewNote, reviewedScore: r.reviewedScore,
      user: r.user,
    };
  }
}
