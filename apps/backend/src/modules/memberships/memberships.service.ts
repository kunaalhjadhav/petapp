import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformService } from '../platform/platform.service';
import { PaymentsService } from '../payments/payments.service';
import { FinanceService } from '../finance/finance.service';
import { AuditService } from '../audit/audit.service';
import { QueueService } from '../../queue/queue.service';
import { Paged } from '../../common/dto/pagination.dto';
import type { Membership, MembershipPlan, Payment, Prisma } from '../../generated/prisma/client';
import { benefitLines, benefitsOf, currentOf, NO_BENEFITS, purchaseWindow, upcomingOf, type PlanBenefits } from './memberships.rules';
import type { GrantDto, MembersQuery, PlanDto, UpdatePlanDto } from './memberships.dto';

type Tx = Prisma.TransactionClient;
const DAY_MS = 86_400_000;
const unavailable = () => new NotFoundException('Memberships aren’t available right now.');

/** A plan as the app shows it. */
const planView = (p: MembershipPlan) => ({
  id: p.id, key: p.key, name: p.name, description: p.description, pricePaise: p.pricePaise, periodDays: p.periodDays, rank: p.rank,
  benefits: { exclusiveContests: p.exclusiveContests, premiumChallenges: p.premiumChallenges, memberDiscounts: p.memberDiscounts, priorityDays: p.priorityDays, badge: p.badge },
  lines: benefitLines(p),
});

/**
 * Membership plans (spec §40). Off unless ENABLE_MEMBERSHIPS is on; even then nothing is members-only until an admin
 * marks a contest, challenge or coupon so. Benefits of a membership someone paid for are honoured even if the
 * feature is switched off later; members-only checks apply only while it's on.
 */
@Injectable()
export class MembershipsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: PlatformService,
    private readonly payments: PaymentsService,
    private readonly finance: FinanceService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
  ) {}

  onModuleInit() {
    this.payments.registerSettler('MEMBERSHIP', (tx, p) => this.settle(tx, p));
  }

  enabled() {
    return this.platform.isEnabled('ENABLE_MEMBERSHIPS');
  }

  // ───────────── what someone has ─────────────

  /** The benefits someone has right now (the best of their running memberships). */
  async benefits(userId: string, now = new Date()): Promise<PlanBenefits & { planKey: string | null; planName: string | null }> {
    const running = await this.prisma.membership.findMany({
      where: { userId, status: 'ACTIVE', startsAt: { lte: now }, endsAt: { gt: now } },
      include: { plan: true },
      orderBy: { endsAt: 'desc' },
    });
    if (!running.length) return { ...NO_BENEFITS, planKey: null, planName: null };
    const top = [...running].sort((a, b) => b.plan.rank - a.plan.rank)[0].plan;
    return { ...benefitsOf(running.map((m) => m.plan)), planKey: top.key, planName: top.name };
  }

  /** Members-only check for contests, challenges and coupons. Returns the reason, or null when allowed. */
  async membersOnlyProblem(userId: string, need: 'exclusiveContests' | 'premiumChallenges' | 'memberDiscounts'): Promise<string | null> {
    if (!(await this.enabled())) return null;
    const b = await this.benefits(userId);
    if (b[need]) return null;
    return need === 'exclusiveContests' ? 'This contest is for members. See Membership in your profile to join.'
      : need === 'premiumChallenges' ? 'This is a premium challenge for members. See Membership in your profile to join.'
      : 'This coupon is for members only.';
  }

  /** Extra days ahead a member can book services (priority booking); 0 for everyone else. */
  async priorityDays(userId?: string): Promise<number> {
    if (!userId) return 0;
    return (await this.benefits(userId)).priorityDays;
  }

  /** The badge shown on a public profile, or null. */
  async badgeOf(userId: string): Promise<{ plan: string; key: string } | null> {
    const b = await this.benefits(userId);
    return b.badge && b.planName && b.planKey ? { plan: b.planName, key: b.planKey } : null;
  }

  // ───────────── the app ─────────────

  async plans() {
    if (!(await this.enabled())) throw unavailable();
    const plans = await this.prisma.membershipPlan.findMany({ where: { isActive: true }, orderBy: [{ rank: 'asc' }, { pricePaise: 'asc' }] });
    return plans.map(planView);
  }

  async mine(userId: string) {
    const enabled = await this.enabled();
    const now = new Date();
    const list = await this.prisma.membership.findMany({ where: { userId, status: { in: ['ACTIVE', 'EXPIRED', 'REVOKED'] } }, include: { plan: true }, orderBy: { createdAt: 'desc' }, take: 50 });
    const current = currentOf(list, now);
    const view = (m: (typeof list)[number]) => ({ id: m.id, plan: planView(m.plan), status: m.status, startsAt: m.startsAt, endsAt: m.endsAt, pricePaise: m.pricePaise, source: m.source });
    return {
      enabled,
      current: current ? view(current) : null,
      upcoming: upcomingOf(list, now).map(view),
      history: list.filter((m) => m !== current && !(m.startsAt && m.startsAt > now && m.status === 'ACTIVE')).slice(0, 20).map(view),
      benefits: await this.benefits(userId, now),
    };
  }

  /** Starts paying for a plan: a new membership now, or a renewal that starts when the current one ends. */
  async purchase(userId: string, planId: string) {
    if (!(await this.enabled())) throw unavailable();
    const plan = await this.prisma.membershipPlan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plan not found.');
    const maxAhead = await this.platform.getSetting<number>('memberships.maxPeriodsAhead');
    return this.prisma.$transaction(async (tx) => {
      // One purchase at a time per person: two taps can't buy two overlapping periods.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`membership:${userId}`}))`;
      // An unpaid checkout from the last half hour is reused rather than starting another.
      const pending = await tx.membership.findFirst({ where: { userId, planId, status: 'PENDING_PAYMENT', paymentId: { not: null }, createdAt: { gt: new Date(Date.now() - 30 * 60_000) } }, orderBy: { createdAt: 'desc' } });
      const open = pending?.paymentId ? await tx.payment.findFirst({ where: { id: pending.paymentId, status: 'CREATED' } }) : null;
      if (pending && open) return { membershipId: pending.id, payment: this.payments.checkoutParams(open) };
      const mine = await tx.membership.findMany({ where: { userId, status: 'ACTIVE' }, include: { plan: { select: { name: true } } } });
      const now = new Date();
      const other = mine.find((m) => m.planId !== plan.id && m.endsAt && m.endsAt > now);
      const w = purchaseWindow(plan, mine, now, maxAhead, other?.plan.name);
      if ('problem' in w) throw new BadRequestException(w.problem);
      const m = await tx.membership.create({ data: { userId, planId, pricePaise: plan.pricePaise } });
      const payment = await this.payments.createOrder(tx, userId, 'MEMBERSHIP', m.id, plan.pricePaise, { membershipId: m.id, plan: plan.key });
      await tx.membership.update({ where: { id: m.id }, data: { paymentId: payment.id } });
      return { membershipId: m.id, payment: this.payments.checkoutParams(payment) };
    });
  }

  /**
   * Payment captured: the period starts now, or when the current one of the same plan ends. A payment that can't
   * be honoured any more (the person switched plans meanwhile, or paid too far ahead) is refunded instead.
   */
  private async settle(tx: Tx, p: Payment): Promise<'ok' | 'refund'> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`membership:${p.userId}`}))`;
    const m = await tx.membership.findUnique({ where: { id: p.referenceId }, include: { plan: true } });
    if (!m || m.status !== 'PENDING_PAYMENT' || m.paymentId !== p.id) return 'refund';
    const mine = await tx.membership.findMany({ where: { userId: m.userId, status: 'ACTIVE' }, include: { plan: { select: { name: true } } } });
    const now = new Date();
    const other = mine.find((x) => x.planId !== m.planId && x.endsAt && x.endsAt > now);
    const maxAhead = await this.platform.getSetting<number>('memberships.maxPeriodsAhead');
    // A retired plan is still honoured for someone who already paid for it.
    const w = purchaseWindow({ ...m.plan, isActive: true, pricePaise: Math.max(m.pricePaise, 1) }, mine, now, maxAhead, other?.plan.name);
    if ('problem' in w) {
      await tx.membership.update({ where: { id: m.id }, data: { status: 'EXPIRED', note: `Not started: ${w.problem}` } });
      return 'refund';
    }
    await tx.membership.update({ where: { id: m.id }, data: { status: 'ACTIVE', startsAt: w.startsAt, endsAt: w.endsAt } });
    await this.finance.membershipEarned(tx, p, m.plan.name);
    await this.audit.log({ actorId: m.userId, action: 'membership.start', entityType: 'Membership', entityId: m.id, after: { plan: m.plan.key, startsAt: w.startsAt, endsAt: w.endsAt, paymentId: p.id } }, tx);
    this.queue.notify({ type: 'MEMBERSHIP_UPDATE', membershipId: m.id, event: w.startsAt > now ? 'RENEWED' : 'ACTIVE' });
    return 'ok';
  }

  // ───────────── admin ─────────────

  async adminPlans() {
    const now = new Date();
    const [plans, counts] = await Promise.all([
      this.prisma.membershipPlan.findMany({ orderBy: [{ rank: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.membership.groupBy({ by: ['planId'], where: { status: 'ACTIVE', startsAt: { lte: now }, endsAt: { gt: now } }, _count: { _all: true } }),
    ]);
    return plans.map((p) => ({ ...planView(p), isActive: p.isActive, members: counts.find((c) => c.planId === p.id)?._count._all ?? 0, createdAt: p.createdAt, updatedAt: p.updatedAt }));
  }

  async createPlan(actorId: string, dto: PlanDto) {
    if (await this.prisma.membershipPlan.findUnique({ where: { key: dto.key } })) throw new ConflictException('A plan with that key already exists.');
    const p = await this.prisma.membershipPlan.create({ data: { ...dto, description: dto.description ?? '' } });
    await this.audit.log({ actorId, action: 'membership.plan_create', entityType: 'MembershipPlan', entityId: p.id, after: { ...dto } });
    return planView(p);
  }

  async updatePlan(actorId: string, id: string, dto: UpdatePlanDto) {
    const before = await this.prisma.membershipPlan.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Plan not found.');
    if (before.key === 'FREE' && ((dto.pricePaise ?? 0) > 0 || dto.isActive === false)) throw new BadRequestException('The Free plan stays free and available.');
    const p = await this.prisma.membershipPlan.update({ where: { id }, data: dto });
    const changed = Object.fromEntries(Object.keys(dto).map((k) => [k, (before as Record<string, unknown>)[k]]));
    // Price changes apply to new purchases only: what someone paid for keeps its price and length.
    await this.audit.log({ actorId, action: 'membership.plan_update', entityType: 'MembershipPlan', entityId: id, before: changed, after: { ...dto } });
    return planView(p);
  }

  async members(q: MembersQuery) {
    const now = new Date();
    const state: Prisma.MembershipWhereInput =
      q.state === 'current' ? { status: 'ACTIVE', startsAt: { lte: now }, endsAt: { gt: now } }
      : q.state === 'upcoming' ? { status: 'ACTIVE', startsAt: { gt: now } }
      : q.state === 'ended' ? { OR: [{ status: { in: ['EXPIRED', 'REVOKED'] } }, { status: 'ACTIVE', endsAt: { lte: now } }] }
      : q.state === 'pending' ? { status: 'PENDING_PAYMENT' }
      : { status: { not: 'PENDING_PAYMENT' } };
    const text = q.q?.trim();
    const where: Prisma.MembershipWhereInput = {
      ...state,
      ...(q.planId ? { planId: q.planId } : {}),
      ...(text ? { user: { OR: [{ name: { contains: text, mode: 'insensitive' } }, { phone: { contains: text } }, { email: { contains: text, mode: 'insensitive' } }] } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.membership.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: q.skip, take: q.limit,
        include: { plan: { select: { id: true, key: true, name: true } }, user: { select: { id: true, name: true, phone: true } }, grantedBy: { select: { name: true } } },
      }),
      this.prisma.membership.count({ where }),
    ]);
    return Paged.of(rows.map((m) => ({
      id: m.id, user: m.user, plan: m.plan, status: m.status, startsAt: m.startsAt, endsAt: m.endsAt, pricePaise: m.pricePaise, source: m.source,
      grantedBy: m.grantedBy?.name ?? null, note: m.note, createdAt: m.createdAt,
      running: m.status === 'ACTIVE' && !!m.startsAt && !!m.endsAt && m.startsAt <= now && m.endsAt > now,
    })), total, q);
  }

  async summary() {
    const now = new Date();
    const since = new Date(now.getTime() - 30 * DAY_MS);
    const [current, joined, revenue] = await Promise.all([
      this.prisma.membership.findMany({ where: { status: 'ACTIVE', startsAt: { lte: now }, endsAt: { gt: now } }, distinct: ['userId'], select: { userId: true } }),
      this.prisma.membership.count({ where: { status: { in: ['ACTIVE', 'EXPIRED'] }, source: 'PURCHASE', startsAt: { gte: since } } }),
      this.prisma.payment.aggregate({ where: { purpose: 'MEMBERSHIP', status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED'] }, capturedAt: { gte: since } }, _sum: { amountPaise: true } }),
    ]);
    return { enabled: await this.enabled(), members: current.length, purchases30d: joined, revenue30dPaise: revenue._sum.amountPaise ?? 0 };
  }

  /** Staff give someone a membership (a goodwill gesture, a prize): free, audited, starts now. */
  async grant(actorId: string, dto: GrantDto) {
    const [user, plan] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: dto.userId }, select: { id: true, status: true } }),
      this.prisma.membershipPlan.findUnique({ where: { id: dto.planId } }),
    ]);
    if (!user || user.status !== 'ACTIVE') throw new NotFoundException('User not found.');
    if (!plan) throw new NotFoundException('Plan not found.');
    if (plan.pricePaise === 0) throw new BadRequestException('Everyone has the Free plan already.');
    const now = new Date();
    const m = await this.prisma.membership.create({
      data: { userId: user.id, planId: plan.id, status: 'ACTIVE', startsAt: now, endsAt: new Date(now.getTime() + dto.days * DAY_MS), pricePaise: 0, source: 'GRANT', grantedById: actorId, note: dto.reason },
    });
    await this.audit.log({ actorId, action: 'membership.grant', entityType: 'Membership', entityId: m.id, after: { userId: user.id, plan: plan.key, days: dto.days, reason: dto.reason } });
    this.queue.notify({ type: 'MEMBERSHIP_UPDATE', membershipId: m.id, event: 'ACTIVE' });
    return m;
  }

  /**
   * Staff end a membership early (abuse, a mistaken grant). Paid time isn't refunded automatically: if a refund is
   * owed, finance records it from the payment. Audited; the person is told.
   */
  async revoke(actorId: string, id: string, reason: string) {
    const m = await this.prisma.membership.findUnique({ where: { id }, include: { plan: { select: { key: true } } } });
    if (!m) throw new NotFoundException('Membership not found.');
    if (m.status !== 'ACTIVE') throw new BadRequestException('Only an active or upcoming membership can be ended.');
    const now = new Date();
    if (m.endsAt && m.endsAt <= now) throw new BadRequestException('This membership has already ended.');
    const ended: Membership = await this.prisma.membership.update({ where: { id }, data: { status: 'REVOKED', note: reason, endsAt: m.startsAt && m.startsAt < now ? now : m.endsAt } });
    await this.audit.log({ actorId, action: 'membership.revoke', entityType: 'Membership', entityId: id, before: { status: m.status, endsAt: m.endsAt }, after: { status: 'REVOKED', endsAt: ended.endsAt, reason, plan: m.plan.key } });
    this.queue.notify({ type: 'MEMBERSHIP_UPDATE', membershipId: id, event: 'REVOKED' });
    return ended;
  }
}
