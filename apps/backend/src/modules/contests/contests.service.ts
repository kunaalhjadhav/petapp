import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConsentService } from '../privacy/consent.service';
import { MembershipsService } from '../memberships/memberships.service';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { postProofProblem } from '../posts/post-proof';
import { needsReview } from '../trust/trust.rules';
import { RedisService } from '../../redis/redis.service';
import { AppConfig } from '../../config/app-config.service';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from '../payments/payments.service';
import { PlatformService } from '../platform/platform.service';
import { FinanceService } from '../finance/finance.service';
import { QueueService } from '../../queue/queue.service';
import { Paged } from '../../common/dto/pagination.dto';
import { slugify } from '../../common/utils/slug';
import type { RequestMetaInfo } from '../../common/decorators/auth.decorators';
import { Prisma, type Contest } from '../../generated/prisma/client';
import type { ContestStatus, ParticipantStatus } from '../../generated/prisma/enums';
import {
  EMPTY_FINANCE, TRANSITIONS, financeBreakdown, rankEntries, readinessProblems, voteRisk, weightedScore,
  type FinanceConfig, type LeaderboardRow,
} from './contest.rules';
import type {
  AdminContestsQuery, CategoryDto, ContestDto, ParticipantStatusDto, PublicContestsQuery, ScoreItem, SubmissionDto, UpdateContestDto,
} from './contests.dto';

/** Entries that are in the running. */
const ACTIVE: ParticipantStatus[] = ['REGISTERED', 'SUBMITTED', 'QUALIFIED', 'FINALIST', 'WINNER'];
/** Entries that can receive votes and be judged. */
const VOTABLE: ParticipantStatus[] = ['SUBMITTED', 'QUALIFIED', 'FINALIST'];
/** Unpaid registrations hold a place this long. */
const PAYMENT_HOLD_MS = 30 * 60_000;
/** Contests the public can see. */
const PUBLIC_STATUSES: ContestStatus[] = ['SCHEDULED', 'LIVE', 'VOTING', 'EVALUATION', 'WINNER_DECLARATION', 'COMPLETED', 'CANCELLED'];

const FULL = {
  category: true,
  tasks: { orderBy: { position: 'asc' as const } },
  criteria: true,
  prizes: { orderBy: [{ rank: 'asc' as const }, { createdAt: 'asc' as const }] },
  judges: { include: { user: { select: { id: true, name: true } } } },
} satisfies Prisma.ContestInclude;
type FullContest = Prisma.ContestGetPayload<{ include: typeof FULL }>;

const finance = (c: Pick<Contest, 'finance'>): FinanceConfig => ({ ...EMPTY_FINANCE, ...((c.finance ?? {}) as Partial<FinanceConfig>) });

@Injectable()
export class ContestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly payments: PaymentsService,
    private readonly platform: PlatformService,
    private readonly queue: QueueService,
    private readonly finance: FinanceService,
    private readonly consents: ConsentService,
    private readonly memberships: MembershipsService,
  ) {}

  // ══════════════ categories ══════════════

  categories(all = false) {
    return this.prisma.contestCategory.findMany({ where: all ? undefined : { isActive: true }, orderBy: [{ group: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }] });
  }

  async saveCategory(actorId: string, dto: CategoryDto, id?: string) {
    const c = id
      ? await this.prisma.contestCategory.update({ where: { id }, data: { name: dto.name, group: dto.group, isActive: dto.isActive, sortOrder: dto.sortOrder } })
      : await this.prisma.contestCategory.create({ data: dto });
    await this.audit.log({ actorId, action: id ? 'contest_category.update' : 'contest_category.create', entityType: 'ContestCategory', entityId: c.id, after: dto });
    return c;
  }

  // ══════════════ admin: build ══════════════

  async create(actorId: string, dto: ContestDto, meta: RequestMetaInfo) {
    await this.assertJudges(dto.judgeIds);
    const slug = `${slugify(dto.title).replace(/\./g, '-')}-${randomBytes(3).toString('hex')}`;
    const c = await this.prisma.$transaction(async (tx) => {
      const created = await tx.contest.create({ data: { ...this.scalarData(dto), slug, createdById: actorId } as Prisma.ContestUncheckedCreateInput });
      await this.replaceNested(tx, created.id, dto);
      await this.audit.log({ actorId, action: 'contest.create', entityType: 'Contest', entityId: created.id, after: { title: dto.title, feePaise: dto.feePaise }, meta }, tx);
      return created;
    });
    return this.adminDetail(c.id);
  }

  async update(actorId: string, id: string, dto: UpdateContestDto, meta: RequestMetaInfo) {
    const c = await this.prisma.contest.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Contest not found.');
    if (c.status !== 'DRAFT' && c.status !== 'REVIEW') throw new BadRequestException('Only draft or in-review contests can be edited.');
    await this.assertJudges(dto.judgeIds);
    await this.prisma.$transaction(async (tx) => {
      const data = this.scalarData(dto);
      if (dto.feePaise !== undefined && dto.feePaise !== c.feePaise) Object.assign(data, { legalReviewApprovedAt: null, legalReviewApprovedBy: null, legalReviewNote: null });
      await tx.contest.update({ where: { id }, data: data as Prisma.ContestUncheckedUpdateInput });
      await this.replaceNested(tx, id, dto);
      await this.audit.log({ actorId, action: 'contest.update', entityType: 'Contest', entityId: id, after: { fields: Object.keys(dto) }, meta }, tx);
    });
    return this.adminDetail(id);
  }

  private scalarData(dto: Partial<ContestDto>) {
    const d: Record<string, unknown> = {};
    for (const k of ['title', 'description', 'bannerUrl', 'categoryId', 'feePaise', 'minParticipants', 'maxParticipants', 'publicWeight', 'votesPerUserPerDay', 'minAccountAgeDays', 'eligibleSpeciesIds', 'rules', 'terms', 'membersOnly'] as const) {
      if (dto[k] !== undefined) d[k] = dto[k];
    }
    for (const k of ['registrationOpensAt', 'registrationClosesAt', 'submissionClosesAt', 'votingClosesAt'] as const) {
      if (dto[k] !== undefined) d[k] = new Date(dto[k] as string);
    }
    if (dto.finance) d.finance = { ...dto.finance } as Prisma.InputJsonValue;
    return d;
  }

  private async replaceNested(tx: Prisma.TransactionClient, contestId: string, dto: Partial<ContestDto>) {
    if (dto.tasks) {
      await tx.contestTask.deleteMany({ where: { contestId } });
      await tx.contestTask.createMany({ data: dto.tasks.map((t, i) => ({ contestId, position: i + 1, type: t.type, title: t.title, description: t.description, required: t.required ?? true })) });
    }
    if (dto.criteria) {
      await tx.judgeCriterion.deleteMany({ where: { contestId } });
      await tx.judgeCriterion.createMany({ data: dto.criteria.map((c) => ({ contestId, name: c.name, weight: c.weight })) });
    }
    if (dto.prizes) {
      await tx.contestPrize.deleteMany({ where: { contestId } });
      await tx.contestPrize.createMany({ data: dto.prizes.map((p) => ({ contestId, rank: p.rank ?? null, title: p.title, kind: p.kind, amountPaise: p.amountPaise, description: p.description })) });
    }
    if (dto.judgeIds) {
      await tx.contestJudge.deleteMany({ where: { contestId } });
      await tx.contestJudge.createMany({ data: [...new Set(dto.judgeIds)].map((userId) => ({ contestId, userId })) });
    }
  }

  private async assertJudges(ids?: string[]) {
    if (!ids?.length) return;
    const ok = await this.prisma.user.count({ where: { id: { in: ids }, status: 'ACTIVE', roles: { some: { role: { key: 'JUDGE' } } } } });
    if (ok !== new Set(ids).size) throw new BadRequestException('Every judge must be an active account with the Judge role.');
  }

  async adminList(q: AdminContestsQuery) {
    const where = { status: q.status };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.contest.findMany({
        where, orderBy: { registrationOpensAt: 'desc' }, skip: q.skip, take: q.limit,
        include: { category: true, _count: { select: { participants: { where: { status: { in: ACTIVE } } } } } },
      }),
      this.prisma.contest.count({ where }),
    ]);
    return Paged.of(items.map(({ _count, ...c }) => ({ ...c, entries: _count.participants })), total, q);
  }

  async adminDetail(id: string) {
    const c = await this.prisma.contest.findUnique({ where: { id }, include: FULL });
    if (!c) throw new NotFoundException('Contest not found.');
    const [byStatus, captured] = await Promise.all([
      this.prisma.contestParticipant.groupBy({ by: ['status'], where: { contestId: id }, _count: { _all: true } }),
      this.prisma.payment.aggregate({ where: { purpose: 'CONTEST_REGISTRATION', referenceId: id, status: 'CAPTURED' }, _count: { _all: true }, _sum: { amountPaise: true } }),
    ]);
    const paidEntries = captured._count._all;
    return {
      ...c,
      readiness: readinessProblems(this.readinessInput(c)),
      entries: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
      finance: finance(c),
      money: {
        collectedPaise: captured._sum.amountPaise ?? 0,
        paidEntries,
        actual: c.feePaise > 0 ? financeBreakdown(c.feePaise, paidEntries, finance(c)) : null,
        atMinimum: c.feePaise > 0 ? financeBreakdown(c.feePaise, c.minParticipants, finance(c)) : null,
        atMaximum: c.feePaise > 0 && c.maxParticipants ? financeBreakdown(c.feePaise, c.maxParticipants, finance(c)) : null,
      },
    };
  }

  async financePreview(id: string, participants: number) {
    const c = await this.prisma.contest.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Contest not found.');
    return financeBreakdown(c.feePaise, Math.max(0, Math.min(participants, 1_000_000)), finance(c));
  }

  private readinessInput(c: FullContest) {
    return {
      title: c.title, feePaise: c.feePaise, minParticipants: c.minParticipants, maxParticipants: c.maxParticipants, publicWeight: c.publicWeight,
      registrationOpensAt: c.registrationOpensAt, registrationClosesAt: c.registrationClosesAt, submissionClosesAt: c.submissionClosesAt, votingClosesAt: c.votingClosesAt,
      finance: finance(c), tasks: c.tasks.length, criteriaWeights: c.criteria.map((x) => x.weight), judges: c.judges.length, prizes: c.prizes.length,
    };
  }

  // ══════════════ admin: lifecycle ══════════════

  async transition(actorId: string, id: string, to: ContestStatus, reason: string | undefined, meta: RequestMetaInfo) {
    const c = await this.prisma.contest.findUnique({ where: { id }, include: FULL });
    if (!c) throw new NotFoundException('Contest not found.');
    if (!TRANSITIONS[c.status].includes(to)) throw new BadRequestException(`A ${c.status.toLowerCase()} contest can’t move to ${to.toLowerCase()}.`);
    const problems = (to === 'REVIEW' || to === 'SCHEDULED') ? readinessProblems(this.readinessInput(c)) : [];
    if (problems.length) throw new BadRequestException({ message: 'This contest isn’t ready yet.', errors: problems.map((message) => ({ message })) });
    if (to === 'LIVE' && c.feePaise > 0 && !c.legalReviewApprovedAt) {
      throw new BadRequestException('Paid contests need a recorded legal review before they can go live.');
    }
    if (to === 'VOTING') {
      const active = await this.prisma.contestParticipant.count({ where: { contestId: id, status: { in: ACTIVE } } });
      if (active < c.minParticipants) throw new BadRequestException(`Only ${active} of the minimum ${c.minParticipants} entries. Cancel the contest (entry fees will be refunded) or lower the minimum before it goes live.`);
    }
    if (to === 'WINNER_DECLARATION' && !c.leaderboardFrozenAt) throw new BadRequestException('Freeze the leaderboard first.');
    if (to === 'COMPLETED' && c.prizes.some((p) => p.rank !== null && !p.participantId)) {
      const entries = await this.prisma.contestParticipant.count({ where: { contestId: id, status: 'WINNER' } });
      if (!entries) throw new BadRequestException('Declare the winners first.');
    }
    if (to === 'CANCELLED' && !reason) throw new BadRequestException('Give a reason for cancelling. Participants will see it.');

    await this.prisma.$transaction(async (tx) => {
      await tx.contest.update({ where: { id }, data: { status: to, cancelReason: to === 'CANCELLED' ? reason : undefined } });
      // Completed: the entry fees still held become PetApp's revenue (prizes are approved separately by finance).
      if (to === 'COMPLETED') await this.finance.entryFeesEarned(tx, 'CONTEST_REGISTRATION', id, c.title);
      if (to === 'CANCELLED') {
        // Every paid entry is refunded in full; the finance worker sends the refunds.
        const paid = await tx.payment.findMany({ where: { purpose: 'CONTEST_REGISTRATION', referenceId: id, status: 'CAPTURED' }, select: { id: true, amountPaise: true } });
        for (const p of paid) await this.finance.oweRefund(tx, { paymentId: p.id, amountPaise: p.amountPaise, reason: 'CONTEST_CANCELLED', reference: `Payment:${p.id}` });
        await tx.contestParticipant.updateMany({ where: { contestId: id, status: { in: [...ACTIVE, 'PENDING_PAYMENT'] } }, data: { status: 'WITHDRAWN', statusReason: `Contest cancelled: ${reason}` } });
      }
      await this.audit.log({ actorId, action: 'contest.transition', entityType: 'Contest', entityId: id, before: { status: c.status }, after: { status: to, reason }, meta }, tx);
    });
    if (to === 'VOTING') this.queue.notify({ type: 'CONTEST_VOTING_OPEN', contestId: id });
    return this.adminDetail(id);
  }

  async legalApprove(actorId: string, id: string, note: string, meta: RequestMetaInfo) {
    const c = await this.prisma.contest.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Contest not found.');
    if (c.feePaise === 0) throw new BadRequestException('Free contests don’t need a legal review.');
    if (!['DRAFT', 'REVIEW', 'SCHEDULED'].includes(c.status)) throw new BadRequestException('The legal review must be recorded before the contest goes live.');
    await this.prisma.$transaction(async (tx) => {
      await tx.contest.update({ where: { id }, data: { legalReviewApprovedAt: new Date(), legalReviewApprovedBy: actorId, legalReviewNote: note } });
      await this.audit.log({ actorId, action: 'contest.legal_approval', entityType: 'Contest', entityId: id, after: { note, feePaise: c.feePaise }, meta }, tx);
    });
    return this.adminDetail(id);
  }

  async setParticipantStatus(actorId: string, participantId: string, dto: ParticipantStatusDto, meta: RequestMetaInfo) {
    const p = await this.prisma.contestParticipant.findUnique({ where: { id: participantId }, include: { contest: true } });
    if (!p) throw new NotFoundException('Entry not found.');
    if (p.contest.leaderboardFrozenAt) throw new BadRequestException('The leaderboard is frozen; entries can’t change now.');
    if (p.status === 'PENDING_PAYMENT' || p.status === 'WITHDRAWN') throw new BadRequestException('This entry isn’t active.');
    await this.prisma.$transaction(async (tx) => {
      await tx.contestParticipant.update({ where: { id: participantId }, data: { status: dto.status, statusReason: dto.reason } });
      await this.audit.log({ actorId, action: 'contest.entry_status', entityType: 'ContestParticipant', entityId: participantId, before: { status: p.status }, after: { status: dto.status, reason: dto.reason }, meta }, tx);
    });
    await this.invalidateBoard(p.contestId);
    return { id: participantId, status: dto.status };
  }

  async flaggedVotes(contestId: string) {
    const votes = await this.prisma.contestVote.findMany({
      where: { contestId, flagged: true, reviewedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: { voter: { select: { id: true, name: true, createdAt: true } }, participant: { select: { id: true, pet: { select: { name: true } } } } },
    });
    return votes.map((v) => ({ id: v.id, riskScore: v.riskScore, riskReasons: v.riskReasons, createdAt: v.createdAt, voter: v.voter, entry: { id: v.participant.id, pet: v.participant.pet.name } }));
  }

  async reviewVote(actorId: string, voteId: string, valid: boolean) {
    const v = await this.prisma.contestVote.findUnique({ where: { id: voteId }, include: { contest: { select: { leaderboardFrozenAt: true } } } });
    if (!v) throw new NotFoundException('Vote not found.');
    if (v.contest.leaderboardFrozenAt) throw new BadRequestException('The leaderboard is frozen.');
    await this.prisma.$transaction(async (tx) => {
      await tx.contestVote.update({ where: { id: voteId }, data: { flagged: !valid, reviewedAt: new Date() } });
      await this.audit.log({ actorId, action: 'contest.vote_review', entityType: 'ContestVote', entityId: voteId, after: { valid } }, tx);
    });
    await this.invalidateBoard(v.contestId);
    return { id: voteId, counts: valid };
  }

  /** Locks the ranking that winners will be declared from. */
  async freeze(actorId: string, id: string, meta: RequestMetaInfo) {
    const c = await this.prisma.contest.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Contest not found.');
    if (c.status !== 'EVALUATION') throw new BadRequestException('Freeze the leaderboard during evaluation, after voting has closed.');
    if (c.leaderboardFrozenAt) throw new BadRequestException('Already frozen.');
    const rows = await this.computeBoard(c);
    await this.prisma.$transaction(async (tx) => {
      await tx.leaderboardSnapshot.create({ data: { contestId: id, rows: rows as unknown as Prisma.InputJsonValue, frozenById: actorId } });
      await tx.contest.update({ where: { id }, data: { leaderboardFrozenAt: new Date() } });
      await this.audit.log({ actorId, action: 'contest.freeze', entityType: 'Contest', entityId: id, after: { entries: rows.length, top: rows.slice(0, 3).map((r) => ({ id: r.participantId, combined: r.combined })) }, meta }, tx);
    });
    await this.invalidateBoard(id);
    return { frozenAt: new Date(), entries: rows.length };
  }

  /** Assigns ranked prizes from the frozen snapshot. Prize payouts start as PENDING (paid in Phase 6). */
  async declareWinners(actorId: string, id: string, meta: RequestMetaInfo) {
    const c = await this.prisma.contest.findUnique({ where: { id }, include: { prizes: true } });
    if (!c) throw new NotFoundException('Contest not found.');
    if (c.status !== 'WINNER_DECLARATION') throw new BadRequestException('Move the contest to winner declaration first.');
    const snap = await this.prisma.leaderboardSnapshot.findFirst({ where: { contestId: id }, orderBy: { createdAt: 'desc' } });
    if (!snap) throw new BadRequestException('No frozen leaderboard.');
    const rows = snap.rows as unknown as LeaderboardRow[];
    const awarded: Array<{ prize: string; participantId: string }> = [];
    await this.prisma.$transaction(async (tx) => {
      for (const prize of c.prizes.filter((p) => p.rank !== null)) {
        const row = rows.find((r) => r.rank === prize.rank);
        if (!row) continue;
        await tx.contestPrize.update({ where: { id: prize.id }, data: { participantId: row.participantId, payoutStatus: 'PENDING' } });
        await tx.contestParticipant.update({ where: { id: row.participantId }, data: { status: 'WINNER' } });
        awarded.push({ prize: prize.title, participantId: row.participantId });
      }
      await this.audit.log({ actorId, action: 'contest.winners', entityType: 'Contest', entityId: id, after: { awarded }, meta }, tx);
    });
    this.queue.notify({ type: 'CONTEST_RESULT', contestId: id });
    return { awarded };
  }

  async awardSpecial(actorId: string, prizeId: string, participantId: string) {
    const prize = await this.prisma.contestPrize.findUnique({ where: { id: prizeId }, include: { contest: true } });
    if (!prize) throw new NotFoundException('Prize not found.');
    if (prize.rank !== null) throw new BadRequestException('Ranked prizes follow the leaderboard.');
    if (prize.contest.status !== 'WINNER_DECLARATION') throw new BadRequestException('Special awards are given during winner declaration.');
    const p = await this.prisma.contestParticipant.findFirst({ where: { id: participantId, contestId: prize.contestId, status: { in: ACTIVE } } });
    if (!p) throw new BadRequestException('That entry isn’t in this contest.');
    await this.prisma.$transaction(async (tx) => {
      await tx.contestPrize.update({ where: { id: prizeId }, data: { participantId, payoutStatus: 'PENDING' } });
      await this.audit.log({ actorId, action: 'contest.special_award', entityType: 'ContestPrize', entityId: prizeId, after: { participantId } }, tx);
    });
    return { prizeId, participantId };
  }

  // ══════════════ public ══════════════

  async list(q: PublicContestsQuery) {
    const when: Record<string, ContestStatus[]> = { upcoming: ['SCHEDULED'], live: ['LIVE', 'VOTING', 'EVALUATION'], past: ['WINNER_DECLARATION', 'COMPLETED', 'CANCELLED'] };
    const where: Prisma.ContestWhereInput = { status: { in: q.when ? when[q.when] : PUBLIC_STATUSES }, categoryId: q.categoryId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.contest.findMany({
        where, skip: q.skip, take: q.limit,
        orderBy: q.when === 'past' ? { votingClosesAt: 'desc' } : { registrationClosesAt: 'asc' },
        include: { category: true, prizes: { orderBy: { rank: 'asc' } }, _count: { select: { participants: { where: { status: { in: ACTIVE } } } } } },
      }),
      this.prisma.contest.count({ where }),
    ]);
    return Paged.of(items.map((c) => this.card(c, c._count.participants)), total, q);
  }

  private card(c: Contest & { category: { id: string; name: string; group: string } | null; prizes: Array<{ rank: number | null; title: string; kind: string; amountPaise: number | null }> }, entries: number) {
    return {
      id: c.id, slug: c.slug, title: c.title, bannerUrl: c.bannerUrl, category: c.category ? { id: c.category.id, name: c.category.name, group: c.category.group } : null,
      status: c.status, feePaise: c.feePaise, currency: c.currency, entries, maxParticipants: c.maxParticipants, membersOnly: c.membersOnly,
      registrationOpensAt: c.registrationOpensAt, registrationClosesAt: c.registrationClosesAt, submissionClosesAt: c.submissionClosesAt, votingClosesAt: c.votingClosesAt,
      prizes: c.prizes.map((p) => ({ rank: p.rank, title: p.title, kind: p.kind, amountPaise: p.amountPaise })),
    };
  }

  /** Public contest cards for these ids, in this order. */
  async cardsByIds(ids: string[]) {
    if (!ids.length) return [];
    const rows = await this.prisma.contest.findMany({
      where: { id: { in: ids }, status: { in: PUBLIC_STATUSES } },
      include: { category: true, prizes: { orderBy: { rank: 'asc' } }, _count: { select: { participants: { where: { status: { in: ACTIVE } } } } } },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.filter((id) => byId.has(id)).map((id) => this.card(byId.get(id)!, byId.get(id)!._count.participants));
  }

  async detail(idOrSlug: string, viewerId?: string) {
    const c = await this.prisma.contest.findFirst({
      where: { OR: [{ slug: idOrSlug }, ...(/^[0-9a-f-]{36}$/.test(idOrSlug) ? [{ id: idOrSlug }] : [])], status: { in: PUBLIC_STATUSES } },
      include: { category: true, tasks: { orderBy: { position: 'asc' } }, prizes: { orderBy: { rank: 'asc' } }, criteria: true },
    });
    if (!c) throw new NotFoundException('Contest not found.');
    const entries = await this.prisma.contestParticipant.count({ where: { contestId: c.id, status: { in: ACTIVE } } });
    const mine = viewerId
      ? await this.prisma.contestParticipant.findMany({
          where: { contestId: c.id, userId: viewerId, status: { not: 'WITHDRAWN' } },
          include: { pet: { select: { id: true, name: true } }, submissions: { select: { taskId: true } }, payment: true },
        })
      : [];
    return {
      ...this.card(c, entries),
      description: c.description, rules: c.rules, terms: c.terms, publicWeight: c.publicWeight, votesPerUserPerDay: c.votesPerUserPerDay,
      cancelReason: c.cancelReason, leaderboardFrozen: !!c.leaderboardFrozenAt,
      tasks: c.tasks.map((t) => ({ id: t.id, type: t.type, title: t.title, description: t.description, required: t.required })),
      judgingCriteria: c.criteria.map((x) => ({ name: x.name, weight: x.weight })),
      viewer: {
        entries: mine.map((m) => ({
          id: m.id, status: m.status, pet: m.pet, submittedTaskIds: m.submissions.map((s) => s.taskId),
          payment: m.payment && m.status === 'PENDING_PAYMENT' ? this.payments.checkoutParams(m.payment) : null,
        })),
      },
    };
  }

  /**
   * Registers a pet. Free: in immediately. Paid: a payment order is created and the place is held
   * for 30 minutes; the entry becomes REGISTERED only when the payment is verified server-side.
   * The contest row is locked so the last place can't be sold twice.
   */
  async register(userId: string, contestId: string, petId: string) {
    // The Contest Terms (prizes, TDS, disqualification, publicity) must be accepted before entering, once published.
    await this.consents.require(userId, 'contest-terms');
    const pet = await this.prisma.pet.findFirst({ where: { id: petId, ownerId: userId, deletedAt: null, status: 'ACTIVE' } });
    if (!pet) throw new NotFoundException('Pet not found.');
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Contest" WHERE id = ${contestId}::uuid FOR UPDATE`;
      const c = await tx.contest.findUnique({ where: { id: contestId } });
      if (!c || !PUBLIC_STATUSES.includes(c.status)) throw new NotFoundException('Contest not found.');
      const now = new Date();
      if (!['SCHEDULED', 'LIVE'].includes(c.status) || now < c.registrationOpensAt || now > c.registrationClosesAt) {
        throw new BadRequestException('Registration is currently closed for this contest.');
      }
      if (c.eligibleSpeciesIds.length && !c.eligibleSpeciesIds.includes(pet.speciesId)) throw new BadRequestException(`${pet.name} isn’t eligible for this contest.`);
      if (c.membersOnly) {
        const problem = await this.memberships.membersOnlyProblem(userId, 'exclusiveContests');
        if (problem) throw new ForbiddenException(problem);
      }

      const existing = await tx.contestParticipant.findUnique({ where: { contestId_petId: { contestId, petId } }, include: { payment: true } });
      if (existing && existing.status !== 'WITHDRAWN') {
        if (existing.status === 'PENDING_PAYMENT' && existing.payment?.status === 'CREATED') return { participant: existing, payment: existing.payment };
        if (existing.status !== 'PENDING_PAYMENT') throw new ConflictException(`${pet.name} is already entered in this contest.`);
      }
      if (c.maxParticipants) {
        const taken = await tx.contestParticipant.count({
          where: { contestId, OR: [{ status: { in: ACTIVE } }, { status: 'PENDING_PAYMENT', createdAt: { gt: new Date(now.getTime() - PAYMENT_HOLD_MS) } }] },
        });
        if (taken >= c.maxParticipants) throw new BadRequestException('This contest is full.');
      }
      const free = c.feePaise === 0;
      const participant = existing
        ? await tx.contestParticipant.update({ where: { id: existing.id }, data: { status: free ? 'REGISTERED' : 'PENDING_PAYMENT', registeredAt: free ? now : null, paymentId: null, createdAt: now } })
        : await tx.contestParticipant.create({ data: { contestId, userId, petId, status: free ? 'REGISTERED' : 'PENDING_PAYMENT', registeredAt: free ? now : null } });
      if (free) return { participant, payment: null };
      const payment = await this.payments.createOrder(tx, userId, 'CONTEST_REGISTRATION', contestId, c.feePaise, { contestId, participantId: participant.id, petId });
      await tx.contestParticipant.update({ where: { id: participant.id }, data: { paymentId: payment.id } });
      return { participant, payment };
    });
    if (!result.payment) this.queue.notify({ type: 'CONTEST_ENTRY_CONFIRMED', participantId: result.participant.id });
    return {
      entryId: result.participant.id,
      status: result.payment ? 'PENDING_PAYMENT' : 'REGISTERED',
      payment: result.payment ? this.payments.checkoutParams(result.payment) : null,
    };
  }

  async submit(userId: string, participantId: string, dto: SubmissionDto) {
    const p = await this.prisma.contestParticipant.findFirst({ where: { id: participantId, userId }, include: { contest: { include: { tasks: true } } } });
    if (!p) throw new NotFoundException('Entry not found.');
    const c = p.contest;
    if (c.status !== 'LIVE' || new Date() > c.submissionClosesAt) throw new BadRequestException('Submissions are closed for this contest.');
    if (!['REGISTERED', 'SUBMITTED'].includes(p.status)) throw new BadRequestException(p.status === 'PENDING_PAYMENT' ? 'Complete the entry payment first.' : 'This entry can’t take submissions.');
    const task = c.tasks.find((t) => t.id === dto.taskId);
    if (!task) throw new BadRequestException('That task isn’t part of this contest.');
    if (task.type === 'POST') {
      if (!dto.postId) throw new BadRequestException('Choose one of your posts for this task.');
      const problem = await postProofProblem(this.prisma, dto.postId, userId);
      if (problem) throw new BadRequestException(problem);
    } else if (!dto.text) {
      throw new BadRequestException('Write your answer for this task.');
    }
    await this.prisma.contestSubmission.upsert({
      where: { participantId_taskId: { participantId, taskId: task.id } },
      update: { postId: task.type === 'POST' ? dto.postId : null, text: task.type === 'TEXT' ? dto.text : null },
      create: { participantId, taskId: task.id, postId: task.type === 'POST' ? dto.postId : null, text: task.type === 'TEXT' ? dto.text : null },
    });
    this.queue.assess('CONTEST_ENTRY', participantId);
    const done = await this.prisma.contestSubmission.count({ where: { participantId, task: { required: true } } });
    const required = c.tasks.filter((t) => t.required).length;
    const status = done >= required ? 'SUBMITTED' : 'REGISTERED';
    if (status !== p.status) await this.prisma.contestParticipant.update({ where: { id: participantId }, data: { status } });
    return { entryId: participantId, status, completedTasks: done, requiredTasks: required };
  }

  async entry(participantId: string) {
    const p = await this.prisma.contestParticipant.findFirst({
      where: { id: participantId, status: { in: ACTIVE }, contest: { status: { in: PUBLIC_STATUSES } } },
      include: {
        pet: { select: { id: true, name: true, handle: true, avatarUrl: true } },
        user: { select: { id: true, name: true } },
        submissions: { include: { task: { select: { id: true, title: true, type: true } } } },
      },
    });
    if (!p) throw new NotFoundException('Entry not found.');
    const votes = await this.prisma.contestVote.count({ where: { participantId, flagged: false } });
    return {
      id: p.id, contestId: p.contestId, status: p.status, pet: p.pet, owner: p.user, votes,
      submissions: p.submissions.map((s) => ({ task: s.task, postId: s.postId, text: s.text, at: s.updatedAt })),
    };
  }

  // ══════════════ voting ══════════════

  async vote(voterId: string, participantId: string, ip?: string) {
    if (!(await this.platform.isEnabled('ENABLE_PUBLIC_VOTING'))) throw new NotFoundException('Public voting isn’t available right now.');
    const p = await this.prisma.contestParticipant.findUnique({ where: { id: participantId }, include: { contest: true } });
    if (!p || !PUBLIC_STATUSES.includes(p.contest.status)) throw new NotFoundException('Entry not found.');
    const c = p.contest;
    const now = new Date();
    if (c.status !== 'VOTING' || now > c.votingClosesAt) throw new BadRequestException('Voting is closed for this contest.');
    if (c.publicWeight === 0) throw new BadRequestException('This contest is decided by judges only.');
    if (!VOTABLE.includes(p.status)) throw new BadRequestException('This entry isn’t open for votes.');
    if (p.userId === voterId) throw new BadRequestException('You can’t vote for your own entry.');

    const voter = await this.prisma.user.findUniqueOrThrow({ where: { id: voterId }, select: { createdAt: true, phoneVerifiedAt: true } });
    if (!voter.phoneVerifiedAt) throw new ForbiddenException('Verify your mobile number to vote.');
    const ageHours = (now.getTime() - voter.createdAt.getTime()) / 3_600_000;
    if (ageHours < c.minAccountAgeDays * 24) throw new ForbiddenException(`Accounts need to be at least ${c.minAccountAgeDays} days old to vote in this contest.`);

    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const usedUp = () => new BadRequestException(`You’ve used today’s ${c.votesPerUserPerDay === 1 ? 'vote' : `${c.votesPerUserPerDay} votes`}. Come back tomorrow.`);
    if ((await this.prisma.contestVote.count({ where: { contestId: c.id, voterId, voteDate: day } })) >= c.votesPerUserPerDay) throw usedUp();

    const ipHash = ip ? createHash('sha256').update(`${this.config.get('OTP_PEPPER')}:${ip}:${day.toISOString().slice(0, 10)}`).digest('hex').slice(0, 32) : null;
    const sameNetwork = ipHash ? await this.prisma.contestVote.count({ where: { participantId, ipHash, voteDate: day, voterId: { not: voterId } } }) : 0;
    const accountRisk = (await this.platform.getSetting<boolean>('risk.holdVotesFromHighRisk'))
      ? await this.prisma.accountRisk.findUnique({ where: { userId: voterId }, select: { level: true, score: true, reviewedScore: true } })
      : null;
    const risk = voteRisk({
      accountAgeHours: ageHours,
      joinedAfterContestOpened: voter.createdAt > c.registrationOpensAt,
      sameNetworkVotesToday: sameNetwork,
      accountUnderReview: !!accountRisk && needsReview(accountRisk.level, accountRisk.score, accountRisk.reviewedScore),
    });
    let today: number;
    try {
      // One voter's votes in one contest are counted and written one at a time, so many requests sent at once
      // can't each see "no votes yet today" and all be counted.
      today = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`vote:${c.id}:${voterId}`}))`;
        const used = await tx.contestVote.count({ where: { contestId: c.id, voterId, voteDate: day } });
        if (used >= c.votesPerUserPerDay) throw usedUp();
        await tx.contestVote.create({
          data: { contestId: c.id, participantId, voterId, voteDate: day, ipHash, riskScore: risk.score, riskReasons: risk.reasons, flagged: risk.flagged },
        });
        return used;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('You’ve already voted for this entry today.');
      throw e;
    }
    this.queue.scoreRisk(voterId);
    await this.invalidateBoard(c.id);
    // The entrant hears about new votes at most once an hour, counted at the end of the hour (held votes don't count).
    if (!risk.flagged) {
      const hour = Math.floor(Date.now() / 3_600_000);
      this.queue.notifyOnce({ type: 'CONTEST_VOTES', participantId, since: new Date(hour * 3_600_000).toISOString() }, `votes-${participantId}-${hour}`, (hour + 1) * 3_600_000 - Date.now() + 5_000);
    }
    // The voter isn't told their vote was flagged: that would teach fraud rings what to avoid.
    return { voted: true, votesLeftToday: c.votesPerUserPerDay - today - 1 };
  }

  // ══════════════ judging ══════════════

  async judgeContests(judgeId: string) {
    const rows = await this.prisma.contestJudge.findMany({
      where: { userId: judgeId, contest: { status: { in: ['VOTING', 'EVALUATION'] } } },
      include: { contest: { include: { criteria: true, _count: { select: { participants: { where: { status: { in: VOTABLE } } } } } } } },
    });
    return rows.map(({ contest: c }) => ({ id: c.id, title: c.title, status: c.status, frozen: !!c.leaderboardFrozenAt, entries: c._count.participants, criteria: c.criteria }));
  }

  async judgeEntries(judgeId: string, contestId: string) {
    await this.assertJudge(judgeId, contestId);
    const entries = await this.prisma.contestParticipant.findMany({
      where: { contestId, status: { in: VOTABLE } },
      orderBy: { registeredAt: 'asc' },
      include: {
        pet: { select: { id: true, name: true, handle: true } },
        submissions: { include: { task: { select: { title: true, type: true } } } },
        judgeScores: { where: { judgeId }, select: { criterionId: true, score: true } },
      },
    });
    return entries.map((e) => ({ id: e.id, pet: e.pet, submissions: e.submissions.map((s) => ({ task: s.task, postId: s.postId, text: s.text })), myScores: e.judgeScores }));
  }

  async score(judgeId: string, participantId: string, scores: ScoreItem[]) {
    const p = await this.prisma.contestParticipant.findUnique({ where: { id: participantId }, include: { contest: { include: { criteria: true } } } });
    if (!p) throw new NotFoundException('Entry not found.');
    await this.assertJudge(judgeId, p.contestId);
    const c = p.contest;
    if (!['VOTING', 'EVALUATION'].includes(c.status) || c.leaderboardFrozenAt) throw new BadRequestException('Judging is closed for this contest.');
    if (!VOTABLE.includes(p.status)) throw new BadRequestException('This entry isn’t being judged.');
    const valid = new Set(c.criteria.map((x) => x.id));
    if (scores.some((s) => !valid.has(s.criterionId))) throw new BadRequestException('Unknown judging criterion.');
    await this.prisma.$transaction(
      scores.map((s) =>
        this.prisma.contestJudgeScore.upsert({
          where: { participantId_judgeId_criterionId: { participantId, judgeId, criterionId: s.criterionId } },
          update: { score: s.score },
          create: { participantId, judgeId, criterionId: s.criterionId, score: s.score },
        }),
      ),
    );
    await this.invalidateBoard(c.id);
    const mine = await this.prisma.contestJudgeScore.findMany({ where: { participantId, judgeId } });
    return { entryId: participantId, myScore: weightedScore(mine, new Map(c.criteria.map((x) => [x.id, x.weight]))) };
  }

  private async assertJudge(judgeId: string, contestId: string) {
    const ok = await this.prisma.contestJudge.findUnique({ where: { contestId_userId: { contestId, userId: judgeId } } });
    if (!ok) throw new ForbiddenException('You aren’t a judge for this contest.');
  }

  // ══════════════ leaderboard ══════════════

  private boardKey = (id: string) => `contest:board:${id}`;

  private async invalidateBoard(contestId: string) {
    await this.redis.client.del(this.boardKey(contestId));
  }

  async leaderboard(contestId: string) {
    const c = await this.prisma.contest.findFirst({ where: { id: contestId, status: { in: PUBLIC_STATUSES } } });
    if (!c) throw new NotFoundException('Contest not found.');
    let rows: LeaderboardRow[];
    if (c.leaderboardFrozenAt) {
      const snap = await this.prisma.leaderboardSnapshot.findFirst({ where: { contestId }, orderBy: { createdAt: 'desc' } });
      rows = (snap?.rows ?? []) as unknown as LeaderboardRow[];
    } else {
      const cached = await this.redis.getJson<LeaderboardRow[]>(this.boardKey(contestId));
      rows = cached ?? (await this.computeBoard(c));
      if (!cached) await this.redis.setJson(this.boardKey(contestId), rows, 30);
    }
    const ids = rows.map((r) => r.participantId);
    const people = await this.prisma.contestParticipant.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true, pet: { select: { id: true, name: true, handle: true, avatarUrl: true } }, user: { select: { id: true, name: true } } },
    });
    const byId = new Map(people.map((p) => [p.id, p]));
    return {
      frozen: !!c.leaderboardFrozenAt,
      publicWeight: c.publicWeight,
      rows: rows.map((r) => ({
        rank: r.rank, entryId: r.participantId, pet: byId.get(r.participantId)?.pet, owner: byId.get(r.participantId)?.user,
        status: byId.get(r.participantId)?.status, votes: r.votes, voteScore: r.voteScore, judgeScore: r.judgeScore, combined: r.combined,
      })),
    };
  }

  private async computeBoard(c: Contest): Promise<LeaderboardRow[]> {
    const entries = await this.prisma.contestParticipant.findMany({
      where: { contestId: c.id, status: { in: ACTIVE } },
      select: { id: true, registeredAt: true, createdAt: true },
    });
    const ids = entries.map((e) => e.id);
    const [votes, scores, criteria] = await Promise.all([
      this.prisma.contestVote.groupBy({ by: ['participantId'], where: { contestId: c.id, flagged: false }, _count: { _all: true } }),
      this.prisma.contestJudgeScore.findMany({ where: { participantId: { in: ids } }, select: { participantId: true, judgeId: true, criterionId: true, score: true } }),
      this.prisma.judgeCriterion.findMany({ where: { contestId: c.id } }),
    ]);
    const weights = new Map(criteria.map((x) => [x.id, x.weight]));
    const voteCount = new Map(votes.map((v) => [v.participantId, v._count._all]));
    return rankEntries(
      entries.map((e) => {
        const byJudge = new Map<string, Array<{ criterionId: string; score: number }>>();
        for (const s of scores.filter((x) => x.participantId === e.id)) byJudge.set(s.judgeId, [...(byJudge.get(s.judgeId) ?? []), s]);
        const perJudge = [...byJudge.values()].map((s) => weightedScore(s, weights)).filter((x): x is number => x !== null);
        return {
          participantId: e.id,
          votes: voteCount.get(e.id) ?? 0,
          judgeAverage: perJudge.length ? perJudge.reduce((a, b) => a + b, 0) / perJudge.length : null,
          registeredAt: e.registeredAt ?? e.createdAt,
        };
      }),
      c.publicWeight,
    );
  }
}
