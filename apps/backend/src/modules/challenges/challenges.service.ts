import { BadRequestException, ForbiddenException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { postProofProblem } from '../posts/post-proof';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from '../payments/payments.service';
import { MembershipsService } from '../memberships/memberships.service';
import { FinanceService } from '../finance/finance.service';
import { QueueService } from '../../queue/queue.service';
import { Paged } from '../../common/dto/pagination.dto';
import { slugify } from '../../common/utils/slug';
import { Prisma, type Challenge } from '../../generated/prisma/client';
import { applyCheckIn, indiaDay, liveStreak } from './challenge.rules';
import type { AdminChallengesQuery, BadgeDto, ChallengeDto, CheckInDto, PublicChallengesQuery, UpdateChallengeDto } from './challenges.dto';

const DAY_MS = 86_400_000;

@Injectable()
export class ChallengesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly payments: PaymentsService,
    private readonly queue: QueueService,
    private readonly finance: FinanceService,
    private readonly memberships: MembershipsService,
  ) {}

  // ══════════════ admin ══════════════

  badges() {
    return this.prisma.badge.findMany({ orderBy: { createdAt: 'asc' }, include: { _count: { select: { awarded: true } } } });
  }

  async saveBadge(actorId: string, dto: BadgeDto, id?: string) {
    const b = id ? await this.prisma.badge.update({ where: { id }, data: dto }) : await this.prisma.badge.create({ data: dto });
    await this.audit.log({ actorId, action: id ? 'badge.update' : 'badge.create', entityType: 'Badge', entityId: b.id, after: dto });
    return b;
  }

  private problems(c: Pick<Challenge, 'kind' | 'feePaise' | 'contestId' | 'startsAt' | 'endsAt' | 'requiredCheckIns'>): string[] {
    const p: string[] = [];
    if (c.endsAt <= c.startsAt) p.push('The challenge must end after it starts.');
    const days = Math.ceil((c.endsAt.getTime() - c.startsAt.getTime()) / DAY_MS);
    if (c.requiredCheckIns > days) p.push(`${c.requiredCheckIns} check-ins can’t fit in ${days} day${days === 1 ? '' : 's'}.`);
    if (c.kind === 'PAID' && c.feePaise <= 0) p.push('A paid challenge needs an entry fee.');
    if (c.kind !== 'PAID' && c.feePaise > 0) p.push('Only paid challenges have a fee.');
    if (c.kind === 'CONTEST_LINKED' && !c.contestId) p.push('Choose the contest this challenge belongs to.');
    return p;
  }

  private data(dto: Partial<ChallengeDto>) {
    const d: Record<string, unknown> = { ...dto };
    if (dto.startsAt) d.startsAt = new Date(dto.startsAt);
    if (dto.endsAt) d.endsAt = new Date(dto.endsAt);
    if (dto.kind && dto.kind !== 'PAID' && dto.feePaise === undefined) d.feePaise = 0;
    return d;
  }

  async create(actorId: string, dto: ChallengeDto) {
    const slug = `${slugify(dto.title).replace(/\./g, '-')}-${randomBytes(3).toString('hex')}`;
    const c = await this.prisma.challenge.create({ data: { ...(this.data(dto) as Prisma.ChallengeUncheckedCreateInput), slug, createdById: actorId } });
    await this.audit.log({ actorId, action: 'challenge.create', entityType: 'Challenge', entityId: c.id, after: { title: c.title, kind: c.kind } });
    return this.adminDetail(c.id);
  }

  async update(actorId: string, id: string, dto: UpdateChallengeDto) {
    const c = await this.prisma.challenge.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Challenge not found.');
    if (c.status !== 'DRAFT') throw new BadRequestException('Only drafts can be edited.');
    await this.prisma.challenge.update({ where: { id }, data: this.data(dto) as Prisma.ChallengeUncheckedUpdateInput });
    await this.audit.log({ actorId, action: 'challenge.update', entityType: 'Challenge', entityId: id, after: { fields: Object.keys(dto) } });
    return this.adminDetail(id);
  }

  async setStatus(actorId: string, id: string, to: 'PUBLISHED' | 'ENDED' | 'CANCELLED') {
    const c = await this.prisma.challenge.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Challenge not found.');
    const allowed: Record<string, string[]> = { DRAFT: ['PUBLISHED', 'CANCELLED'], PUBLISHED: ['ENDED', 'CANCELLED'], ENDED: [], CANCELLED: [] };
    if (!allowed[c.status].includes(to)) throw new BadRequestException(`A ${c.status.toLowerCase()} challenge can’t become ${to.toLowerCase()}.`);
    if (to === 'PUBLISHED') {
      const p = this.problems(c);
      if (p.length) throw new BadRequestException({ message: 'This challenge isn’t ready yet.', errors: p.map((message) => ({ message })) });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.challenge.update({ where: { id }, data: { status: to } });
      if (to === 'ENDED') await this.finance.entryFeesEarned(tx, 'CHALLENGE_JOIN', id, c.title);
      if (to === 'CANCELLED') {
        const paid = await tx.payment.findMany({ where: { purpose: 'CHALLENGE_JOIN', referenceId: id, status: 'CAPTURED' }, select: { id: true, amountPaise: true } });
        for (const p of paid) await this.finance.oweRefund(tx, { paymentId: p.id, amountPaise: p.amountPaise, reason: 'CHALLENGE_CANCELLED', reference: `Payment:${p.id}` });
        await tx.challengeParticipant.updateMany({ where: { challengeId: id, status: { in: ['ACTIVE', 'PENDING_PAYMENT'] } }, data: { status: 'WITHDRAWN' } });
      }
      await this.audit.log({ actorId, action: 'challenge.status', entityType: 'Challenge', entityId: id, before: { status: c.status }, after: { status: to } }, tx);
    });
    return this.adminDetail(id);
  }

  async adminList(q: AdminChallengesQuery) {
    const where = { status: q.status };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.challenge.findMany({ where, orderBy: { startsAt: 'desc' }, skip: q.skip, take: q.limit, include: { badge: true, _count: { select: { participants: { where: { status: { in: ['ACTIVE', 'COMPLETED'] } } } } } } }),
      this.prisma.challenge.count({ where }),
    ]);
    return Paged.of(items.map(({ _count, ...c }) => ({ ...c, participants: _count.participants })), total, q);
  }

  async adminDetail(id: string) {
    const c = await this.prisma.challenge.findUnique({ where: { id }, include: { badge: true } });
    if (!c) throw new NotFoundException('Challenge not found.');
    const [byStatus, captured] = await Promise.all([
      this.prisma.challengeParticipant.groupBy({ by: ['status'], where: { challengeId: id }, _count: { _all: true } }),
      this.prisma.payment.aggregate({ where: { purpose: 'CHALLENGE_JOIN', referenceId: id, status: 'CAPTURED' }, _sum: { amountPaise: true } }),
    ]);
    return { ...c, readiness: this.problems(c), participants: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])), collectedPaise: captured._sum.amountPaise ?? 0 };
  }

  // ══════════════ public ══════════════

  async list(q: PublicChallengesQuery, viewerId?: string) {
    const now = new Date();
    const where: Prisma.ChallengeWhereInput =
      q.when === 'upcoming' ? { status: 'PUBLISHED', startsAt: { gt: now } }
      : q.when === 'past' ? { OR: [{ status: 'ENDED' }, { status: 'PUBLISHED', endsAt: { lt: now } }] }
      : q.when === 'active' ? { status: 'PUBLISHED', startsAt: { lte: now }, endsAt: { gte: now } }
      : { status: { in: ['PUBLISHED', 'ENDED'] } };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.challenge.findMany({ where, skip: q.skip, take: q.limit, orderBy: { startsAt: q.when === 'past' ? 'desc' : 'asc' }, include: { badge: true, _count: { select: { participants: { where: { status: { in: ['ACTIVE', 'COMPLETED'] } } } } } } }),
      this.prisma.challenge.count({ where }),
    ]);
    const mine = viewerId ? await this.prisma.challengeParticipant.findMany({ where: { userId: viewerId, challengeId: { in: items.map((c) => c.id) } } }) : [];
    return Paged.of(items.map((c) => this.card(c, c._count.participants, mine.find((m) => m.challengeId === c.id))), total, q);
  }

  /** Challenge cards for these ids, in this order, with the viewer's progress. */
  async cardsByIds(ids: string[], viewerId?: string) {
    if (!ids.length) return [];
    const rows = await this.prisma.challenge.findMany({
      where: { id: { in: ids }, status: { in: ['PUBLISHED', 'ENDED'] } },
      include: { badge: true, _count: { select: { participants: { where: { status: { in: ['ACTIVE', 'COMPLETED'] } } } } } },
    });
    const mine = viewerId ? await this.prisma.challengeParticipant.findMany({ where: { userId: viewerId, challengeId: { in: ids } } }) : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.filter((id) => byId.has(id)).map((id) => { const c = byId.get(id)!; return this.card(c, c._count.participants, mine.find((m) => m.challengeId === c.id)); });
  }

  private card(c: Challenge & { badge: { name: string; iconUrl: string | null } | null }, participants: number, mine?: { status: string; points: number; checkIns: number; currentStreak: number; lastCheckInDay: Date | null }) {
    const today = indiaDay(new Date());
    return {
      id: c.id, slug: c.slug, title: c.title, bannerUrl: c.bannerUrl, kind: c.kind, feePaise: c.feePaise, startsAt: c.startsAt, endsAt: c.endsAt,
      status: c.status, requiredCheckIns: c.requiredCheckIns, proof: c.proof, pointsPerCheckIn: c.pointsPerCheckIn,
      streakBonusEvery: c.streakBonusEvery, streakBonusPoints: c.streakBonusPoints, participants, membersOnly: c.membersOnly,
      badge: c.badge ? { name: c.badge.name, iconUrl: c.badge.iconUrl } : null,
      mine: mine
        ? { status: mine.status, points: mine.points, checkIns: mine.checkIns, streak: liveStreak(mine, today), checkedInToday: mine.lastCheckInDay?.getTime() === today.getTime() }
        : null,
    };
  }

  async detail(idOrSlug: string, viewerId?: string) {
    const c = await this.prisma.challenge.findFirst({
      where: { OR: [{ slug: idOrSlug }, ...(/^[0-9a-f-]{36}$/.test(idOrSlug) ? [{ id: idOrSlug }] : [])], status: { in: ['PUBLISHED', 'ENDED', 'CANCELLED'] } },
      include: { badge: true, _count: { select: { participants: { where: { status: { in: ['ACTIVE', 'COMPLETED'] } } } } } },
    });
    if (!c) throw new NotFoundException('Challenge not found.');
    const mine = viewerId ? await this.prisma.challengeParticipant.findUnique({ where: { challengeId_userId: { challengeId: c.id, userId: viewerId } }, include: { payment: true, days: { orderBy: { day: 'asc' }, select: { day: true, points: true } } } }) : null;
    return {
      ...this.card(c, c._count.participants, mine ?? undefined),
      description: c.description,
      contestId: c.contestId,
      entry: mine
        ? {
            id: mine.id,
            longestStreak: mine.longestStreak,
            days: mine.days.map((d) => ({ day: d.day.toISOString().slice(0, 10), points: d.points })),
            payment: mine.status === 'PENDING_PAYMENT' && mine.payment ? this.payments.checkoutParams(mine.payment) : null,
          }
        : null,
    };
  }

  async join(userId: string, challengeId: string, petId?: string) {
    const c = await this.prisma.challenge.findUnique({ where: { id: challengeId } });
    if (!c || c.status !== 'PUBLISHED') throw new NotFoundException('Challenge not found.');
    if (new Date() > c.endsAt) throw new BadRequestException('This challenge has ended.');
    if (petId && !(await this.prisma.pet.count({ where: { id: petId, ownerId: userId, deletedAt: null } }))) throw new NotFoundException('Pet not found.');
    if (c.membersOnly) {
      const problem = await this.memberships.membersOnlyProblem(userId, 'premiumChallenges');
      if (problem) throw new ForbiddenException(problem);
    }
    if (c.kind === 'CONTEST_LINKED') {
      const entered = await this.prisma.contestParticipant.count({ where: { contestId: c.contestId!, userId, status: { in: ['REGISTERED', 'SUBMITTED', 'QUALIFIED', 'FINALIST', 'WINNER'] } } });
      if (!entered) throw new BadRequestException('This challenge is for entrants of its contest. Enter the contest first.');
    }
    const existing = await this.prisma.challengeParticipant.findUnique({ where: { challengeId_userId: { challengeId, userId } }, include: { payment: true } });
    if (existing && existing.status !== 'WITHDRAWN') {
      if (existing.status === 'PENDING_PAYMENT' && existing.payment?.status === 'CREATED') return { entryId: existing.id, status: existing.status, payment: this.payments.checkoutParams(existing.payment) };
      throw new ConflictException('You’ve already joined this challenge.');
    }
    const paid = c.kind === 'PAID';
    return this.prisma.$transaction(async (tx) => {
      const entry = existing
        ? await tx.challengeParticipant.update({ where: { id: existing.id }, data: { status: paid ? 'PENDING_PAYMENT' : 'ACTIVE', petId, paymentId: null, joinedAt: new Date() } })
        : await tx.challengeParticipant.create({ data: { challengeId, userId, petId, status: paid ? 'PENDING_PAYMENT' : 'ACTIVE' } });
      if (!paid) return { entryId: entry.id, status: 'ACTIVE', payment: null };
      const payment = await this.payments.createOrder(tx, userId, 'CHALLENGE_JOIN', challengeId, c.feePaise, { challengeId, participantId: entry.id });
      await tx.challengeParticipant.update({ where: { id: entry.id }, data: { paymentId: payment.id } });
      return { entryId: entry.id, status: 'PENDING_PAYMENT', payment: this.payments.checkoutParams(payment) };
    });
  }

  /** One check-in per India day, inside the challenge window. Locks the entry row against double taps. */
  async checkIn(userId: string, challengeId: string, dto: CheckInDto) {
    const c = await this.prisma.challenge.findUnique({ where: { id: challengeId }, include: { badge: true } });
    if (!c || c.status !== 'PUBLISHED') throw new NotFoundException('Challenge not found.');
    const now = new Date();
    if (now < c.startsAt) throw new BadRequestException('This challenge hasn’t started yet.');
    if (now > c.endsAt) throw new BadRequestException('This challenge has ended.');
    if (c.proof === 'POST') {
      if (!dto.postId) throw new BadRequestException('Choose today’s post as proof.');
      const problem = await postProofProblem(this.prisma, dto.postId, userId);
      if (problem) throw new BadRequestException(problem);
    }
    if (c.proof === 'TEXT' && !dto.text) throw new BadRequestException('Write a line about today.');
    const today = indiaDay(now);

    const result = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "ChallengeParticipant" WHERE "challengeId" = ${challengeId}::uuid AND "userId" = ${userId}::uuid FOR UPDATE`;
      if (!rows.length) throw new BadRequestException('Join the challenge first.');
      const p = await tx.challengeParticipant.findUniqueOrThrow({ where: { id: rows[0].id } });
      if (p.status === 'PENDING_PAYMENT') throw new BadRequestException('Complete the payment to start checking in.');
      if (p.status === 'WITHDRAWN') throw new BadRequestException('You’re no longer in this challenge.');
      const o = applyCheckIn(p, today, c);
      if (o.already) throw new ConflictException('You’ve already checked in today. Come back tomorrow!');
      await tx.challengeCheckIn.create({ data: { participantId: p.id, day: today, postId: c.proof === 'POST' ? dto.postId : null, text: c.proof === 'TEXT' ? dto.text : null, points: o.earned } });
      await tx.challengeParticipant.update({
        where: { id: p.id },
        data: { ...o.next, ...(o.completedNow ? { status: 'COMPLETED', completedAt: now } : {}) },
      });
      let badgeAwarded = false;
      if (o.completedNow && c.badgeId) {
        badgeAwarded = (await tx.userBadge.createMany({ data: [{ userId, badgeId: c.badgeId, source: `challenge:${c.id}` }], skipDuplicates: true })).count > 0;
      }
      return { participantId: p.id, o, badgeAwarded };
    });
    if (result.o.completedNow) this.queue.notify({ type: 'CHALLENGE_COMPLETED', participantId: result.participantId });
    if (result.badgeAwarded) this.queue.notify({ type: 'BADGE_EARNED', userId, badgeId: c.badgeId! });
    const n = result.o.next;
    return {
      day: today.toISOString().slice(0, 10), earned: result.o.earned, bonus: result.o.bonus, points: n.points, streak: n.currentStreak,
      checkIns: n.checkIns, requiredCheckIns: c.requiredCheckIns, completed: n.checkIns >= c.requiredCheckIns,
      badge: result.badgeAwarded && c.badge ? { name: c.badge.name } : null,
    };
  }

  /** Points, then longest streak, then who joined first. */
  async leaderboard(challengeId: string, limit: number, viewerId?: string) {
    const c = await this.prisma.challenge.findFirst({ where: { id: challengeId, status: { in: ['PUBLISHED', 'ENDED'] } } });
    if (!c) throw new NotFoundException('Challenge not found.');
    const where = { challengeId, status: { in: ['ACTIVE' as const, 'COMPLETED' as const] } };
    const orderBy: Prisma.ChallengeParticipantOrderByWithRelationInput[] = [{ points: 'desc' }, { longestStreak: 'desc' }, { joinedAt: 'asc' }];
    const rows = await this.prisma.challengeParticipant.findMany({
      where, orderBy, take: limit,
      include: { user: { select: { id: true, name: true, avatarUrl: true } }, pet: { select: { id: true, name: true } } },
    });
    const today = indiaDay(new Date());
    let me: { rank: number; points: number } | null = null;
    if (viewerId) {
      const mine = await this.prisma.challengeParticipant.findUnique({ where: { challengeId_userId: { challengeId, userId: viewerId } } });
      if (mine && (mine.status === 'ACTIVE' || mine.status === 'COMPLETED')) {
        const ahead = await this.prisma.challengeParticipant.count({
          where: {
            ...where,
            OR: [
              { points: { gt: mine.points } },
              { points: mine.points, longestStreak: { gt: mine.longestStreak } },
              { points: mine.points, longestStreak: mine.longestStreak, joinedAt: { lt: mine.joinedAt } },
            ],
          },
        });
        me = { rank: ahead + 1, points: mine.points };
      }
    }
    return {
      rows: rows.map((r, i) => ({ rank: i + 1, user: r.user, pet: r.pet, points: r.points, checkIns: r.checkIns, streak: liveStreak(r, today), completed: r.status === 'COMPLETED' })),
      me,
    };
  }

  userBadges(userId: string) {
    return this.prisma.userBadge
      .findMany({ where: { userId }, orderBy: { awardedAt: 'desc' }, include: { badge: true } })
      .then((rows) => rows.map((r) => ({ key: r.badge.key, name: r.badge.name, description: r.badge.description, iconUrl: r.badge.iconUrl, awardedAt: r.awardedAt })));
  }
}
