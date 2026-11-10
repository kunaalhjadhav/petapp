import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PERMISSIONS } from '@petapp/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MediaService } from '../media/media.service';
import { UsersService } from '../users/users.service';
import { QueueService } from '../../queue/queue.service';
import { Paged } from '../../common/dto/pagination.dto';
import type { Principal } from '../../common/principal';
import type { RequestMetaInfo } from '../../common/decorators/auth.decorators';
import type { AiAssessment, ModerationCase, Prisma } from '../../generated/prisma/client';
import type { ReportTarget } from '../../generated/prisma/enums';
import { SafetyService } from './safety.service';
import type { CasesQuery, ReportsQuery, ResolveCaseDto } from './safety.dto';
import { likeText } from '../../common/utils/search';

@Injectable()
export class ModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly safety: SafetyService,
    private readonly media: MediaService,
    private readonly users: UsersService,
    private readonly queue: QueueService,
  ) {}

  async list(q: CasesQuery) {
    const where: Prisma.ModerationCaseWhereInput = {
      status: q.status ?? 'OPEN',
      targetType: q.targetType,
      ...(q.source === 'ai' ? { aiAssessmentId: { not: null } } : q.source === 'reports' ? { reportCount: { gt: 0 } } : {}),
    };
    const orderBy: Prisma.ModerationCaseOrderByWithRelationInput[] =
      q.source === 'ai' ? [{ aiFlaggedAt: 'desc' }] : [{ reportCount: 'desc' }, { lastReportedAt: 'desc' }];
    const [cases, total] = await this.prisma.$transaction([
      this.prisma.moderationCase.findMany({ where, orderBy, skip: q.skip, take: q.limit, include: { aiAssessment: true } }),
      this.prisma.moderationCase.count({ where }),
    ]);
    const reasons = await this.prisma.report.groupBy({ by: ['caseId', 'reason'], where: { caseId: { in: cases.map((c) => c.id) } }, _count: { _all: true } });
    const items = await Promise.all(
      cases.map(async (c) => ({
        ...this.caseFields(c),
        ai: c.aiAssessment ? this.aiView(c.aiAssessment) : null,
        reasons: reasons.filter((r) => r.caseId === c.id).map((r) => ({ reason: r.reason, count: r._count._all })).sort((a, b) => b.count - a.count),
        target: await this.preview(c.targetType, c.targetId),
      })),
    );
    return Paged.of(items, total, q);
  }

  async detail(id: string) {
    const c = await this.prisma.moderationCase.findUnique({
      where: { id },
      include: {
        reports: { orderBy: { createdAt: 'desc' }, include: { reporter: { select: { id: true, name: true } } } },
        resolvedBy: { select: { id: true, name: true, email: true } },
        aiAssessment: true,
      },
    });
    if (!c) throw new NotFoundException('Case not found.');
    const aiHistory = await this.prisma.aiAssessment.findMany({ where: { targetType: c.targetType, targetId: c.targetId }, orderBy: { createdAt: 'desc' }, take: 5 });
    const previousCases = await this.prisma.moderationCase.count({ where: { targetType: c.targetType, targetId: c.targetId, id: { not: id } } });
    return {
      ...this.caseFields(c),
      resolvedBy: c.resolvedBy,
      previousCases,
      ai: c.aiAssessment ? this.aiView(c.aiAssessment) : null,
      aiHistory: aiHistory.map((a) => this.aiView(a)),
      reports: await Promise.all(c.reports.map(async (r) => ({ id: r.id, reason: r.reason, details: r.details, status: r.status, createdAt: r.createdAt, reporter: r.reporter, evidence: await this.evidence(r.evidenceIds) }))),
      target: await this.preview(c.targetType, c.targetId),
    };
  }

  async resolve(actor: Principal, id: string, dto: ResolveCaseDto, meta: RequestMetaInfo) {
    const c = await this.prisma.moderationCase.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Case not found.');
    if (c.status !== 'OPEN') throw new BadRequestException('This case is already resolved.');
    const { resolution } = dto;
    if (c.targetType === 'USER' && (resolution === 'CONTENT_HIDDEN' || resolution === 'CONTENT_REMOVED')) {
      throw new BadRequestException('A person can’t be hidden or removed. Dismiss the case or suspend the account.');
    }
    if (c.targetType === 'SERVICE_PARTNER' && (resolution === 'CONTENT_HIDDEN' || resolution === 'CONTENT_REMOVED')) {
      // Taking a business off PetApp affects its bookings and payouts, so it's done on the partner's own page.
      throw new BadRequestException('A business is suspended from its page under Services → Partners. Dismiss this case, suspend the account, or suspend the business there first.');
    }
    if (c.targetType === 'CONTEST_ENTRY' && (resolution === 'CONTENT_HIDDEN' || resolution === 'CONTENT_REMOVED')) {
      // Disqualifying an entry affects the leaderboard and the entry fee, so it's done on the contest's own page.
      throw new BadRequestException('Contest entries are disqualified from the contest’s page. Dismiss this case, or disqualify the entry there first.');
    }
    if (resolution === 'USER_SUSPENDED' && !actor.isSuperAdmin && !actor.permissions.includes(PERMISSIONS.USERS_SUSPEND)) {
      throw new ForbiddenException('Suspending accounts needs the “suspend users” permission.');
    }
    const owner = await this.safety.targetOwner(c.targetType, c.targetId);

    await this.prisma.$transaction(async (tx) => {
      if (resolution === 'CONTENT_HIDDEN') await this.safety.setContentState(tx, c.targetType, c.targetId, 'HIDDEN', dto.note);
      if (resolution === 'CONTENT_REMOVED' || resolution === 'USER_SUSPENDED') {
        if (c.targetType !== 'USER' && c.targetType !== 'CONTEST_ENTRY' && c.targetType !== 'SERVICE_PARTNER') await this.safety.setContentState(tx, c.targetType, c.targetId, 'REMOVED', dto.note);
      }
      if (resolution === 'DISMISSED') {
        // Restore content only if the system auto-hid it for this case.
        const autoHidden = await tx.auditLog.count({ where: { action: 'moderation.auto_hide', entityId: c.targetId, createdAt: { gte: c.createdAt } } });
        if (autoHidden) await this.safety.setContentState(tx, c.targetType, c.targetId, 'VISIBLE');
      }
      await tx.report.updateMany({ where: { caseId: id }, data: { status: resolution === 'DISMISSED' ? 'DISMISSED' : 'ACTIONED' } });
      await tx.moderationCase.update({
        where: { id },
        data: { status: 'RESOLVED', openKey: null, resolution, resolutionNote: dto.note, resolvedById: actor.userId, resolvedAt: new Date() },
      });
      await this.audit.log(
        { actorId: actor.userId, action: 'moderation.resolve', entityType: c.targetType, entityId: c.targetId, after: { caseId: id, resolution, note: dto.note, reports: c.reportCount }, meta },
        tx,
      );
    });

    if ((resolution === 'CONTENT_HIDDEN' || resolution === 'CONTENT_REMOVED') && owner) {
      this.queue.notify({ type: 'CONTENT_REMOVED', ownerId: owner, targetType: c.targetType, targetId: c.targetId, resolution });
    }
    if (resolution === 'USER_SUSPENDED' && owner && owner !== actor.userId) {
      try {
        await this.users.adminSetStatus(actor, owner, { status: 'SUSPENDED', reason: `Moderation case ${id.slice(0, 8)}: ${dto.note}` }, meta);
      } catch (e) {
        if (!(e instanceof BadRequestException)) throw e; // already suspended is fine
      }
    }
    return this.detail(id);
  }

  // ══════════════ the reports list (spec §59) ══════════════

  /**
   * Every report, one row each: what was reported and why, who reported it, their evidence, and — once the case is
   * decided — the moderator and the outcome.
   */
  async reports(q: ReportsQuery) {
    const IST = 330 * 60_000;
    const day = (d: string, end = false) => new Date(Date.parse(`${d}T00:00:00Z`) - IST + (end ? 86_400_000 : 0));
    const text = q.q ? { contains: likeText(q.q), mode: 'insensitive' as const } : undefined;
    const where: Prisma.ReportWhereInput = {
      status: q.status, targetType: q.targetType, reason: q.reason, reporterId: q.reporterId, targetId: q.targetId,
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: day(q.from) } : {}), ...(q.to ? { lt: day(q.to, true) } : {}) } } : {}),
      ...(text ? { OR: [{ details: text }, { reporter: { name: text } }, { reporter: { email: text } }] } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.report.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: q.skip, take: q.limit,
        include: { reporter: { select: { id: true, name: true, email: true } }, case: { include: { resolvedBy: { select: { id: true, name: true } } } } },
      }),
      this.prisma.report.count({ where }),
    ]);
    const labels = await this.labels(rows.map((r) => ({ type: r.targetType, id: r.targetId })));
    const items = await Promise.all(rows.map(async (r) => ({
      id: r.id, targetType: r.targetType, targetId: r.targetId, reason: r.reason, details: r.details, status: r.status, createdAt: r.createdAt,
      reporter: r.reporter,
      entity: labels.get(`${r.targetType}:${r.targetId}`) ?? { label: 'Deleted', status: null, owner: null, exists: false },
      evidence: await this.evidence(r.evidenceIds),
      case: r.case ? {
        id: r.case.id, status: r.case.status, reportCount: r.case.reportCount, resolution: r.case.resolution, resolutionNote: r.case.resolutionNote,
        resolvedAt: r.case.resolvedAt, moderator: r.case.resolvedBy,
      } : null,
    })));
    return Paged.of(items, total, q);
  }

  /** Counts for the reports page: open reports by type, and how many came in today and this week. */
  async reportsSummary() {
    const IST = 330 * 60_000;
    const today = new Date(Date.parse(`${new Date(Date.now() + IST).toISOString().slice(0, 10)}T00:00:00Z`) - IST);
    const [byType, byStatus, todayCount, week] = await Promise.all([
      this.prisma.report.groupBy({ by: ['targetType'], where: { status: 'OPEN' }, _count: { _all: true } }),
      this.prisma.report.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.report.count({ where: { createdAt: { gte: today } } }),
      this.prisma.report.count({ where: { createdAt: { gte: new Date(today.getTime() - 6 * 86_400_000) } } }),
    ]);
    return {
      open: byStatus.find((s) => s.status === 'OPEN')?._count._all ?? 0,
      actioned: byStatus.find((s) => s.status === 'ACTIONED')?._count._all ?? 0,
      dismissed: byStatus.find((s) => s.status === 'DISMISSED')?._count._all ?? 0,
      today: todayCount, last7Days: week,
      openByType: byType.map((t) => ({ targetType: t.targetType, count: t._count._all })).sort((a, b) => b.count - a.count),
    };
  }

  /** A short name for each reported thing, one query per kind. */
  private async labels(targets: Array<{ type: ReportTarget; id: string }>) {
    const out = new Map<string, { label: string; status: string | null; owner: { id: string; name: string | null } | null; exists: true }>();
    const ids = (t: ReportTarget) => [...new Set(targets.filter((x) => x.type === t).map((x) => x.id))];
    const put = (t: ReportTarget, id: string, label: string, status: string | null, owner: { id: string; name: string | null } | null) => out.set(`${t}:${id}`, { label, status, owner, exists: true });
    const cut = (v: string | null | undefined, n = 60) => (!v ? '' : v.length > n ? `${v.slice(0, n - 1)}…` : v);
    const jobs: Array<Promise<void>> = [];
    const run = (t: ReportTarget, f: (list: string[]) => Promise<void>) => { const list = ids(t); if (list.length) jobs.push(f(list)); };
    run('USER', async (l) => { for (const u of await this.prisma.user.findMany({ where: { id: { in: l } }, select: { id: true, name: true, status: true } })) put('USER', u.id, u.name ?? 'Unnamed account', u.status, { id: u.id, name: u.name }); });
    run('PET', async (l) => { for (const p of await this.prisma.pet.findMany({ where: { id: { in: l } }, select: { id: true, name: true, handle: true, status: true, owner: { select: { id: true, name: true } } } })) put('PET', p.id, `${p.name} (@${p.handle})`, p.status, p.owner); });
    run('POST', async (l) => { for (const p of await this.prisma.post.findMany({ where: { id: { in: l } }, select: { id: true, type: true, caption: true, status: true, author: { select: { id: true, name: true } } } })) put('POST', p.id, `${p.type === 'REEL' ? 'Reel' : 'Post'}${p.caption ? `: ${cut(p.caption)}` : ''}`, p.status, p.author); });
    run('COMMENT', async (l) => { for (const c of await this.prisma.comment.findMany({ where: { id: { in: l } }, select: { id: true, body: true, status: true, author: { select: { id: true, name: true } } } })) put('COMMENT', c.id, `“${cut(c.body)}”`, c.status, c.author); });
    run('PRODUCT', async (l) => { for (const p of await this.prisma.product.findMany({ where: { id: { in: l } }, select: { id: true, title: true, status: true, vendor: { select: { userId: true, businessName: true } } } })) put('PRODUCT', p.id, p.title, p.status, { id: p.vendor.userId, name: p.vendor.businessName }); });
    run('SERVICE_PARTNER', async (l) => { for (const p of await this.prisma.servicePartner.findMany({ where: { id: { in: l } }, select: { id: true, businessName: true, status: true, userId: true } })) put('SERVICE_PARTNER', p.id, p.businessName, p.status, { id: p.userId, name: p.businessName }); });
    run('SERVICE_REVIEW', async (l) => { for (const r of await this.prisma.serviceReview.findMany({ where: { id: { in: l } }, select: { id: true, rating: true, comment: true, status: true, customer: { select: { id: true, name: true } }, partner: { select: { businessName: true } } } })) put('SERVICE_REVIEW', r.id, `${r.rating}★ for ${r.partner.businessName}${r.comment ? `: ${cut(r.comment, 40)}` : ''}`, r.status, r.customer); });
    run('PRODUCT_REVIEW', async (l) => { for (const r of await this.prisma.productReview.findMany({ where: { id: { in: l } }, select: { id: true, rating: true, comment: true, status: true, customer: { select: { id: true, name: true } }, product: { select: { title: true } } } })) put('PRODUCT_REVIEW', r.id, `${r.rating}★ for ${cut(r.product.title, 30)}${r.comment ? `: ${cut(r.comment, 40)}` : ''}`, r.status, r.customer); });
    run('CONTEST_ENTRY', async (l) => { for (const e of await this.prisma.contestParticipant.findMany({ where: { id: { in: l } }, select: { id: true, status: true, pet: { select: { name: true } }, contest: { select: { title: true } }, user: { select: { id: true, name: true } } } })) put('CONTEST_ENTRY', e.id, `${e.pet.name} in ${e.contest.title}`, e.status, e.user); });
    // Chat messages are private: the list says whose message it is, not what it says. The case shows it.
    run('CHAT_MESSAGE', async (l) => { for (const m of await this.prisma.chatMessage.findMany({ where: { id: { in: l } }, select: { id: true, status: true, sender: { select: { id: true, name: true } } } })) put('CHAT_MESSAGE', m.id, 'Chat message', m.status, m.sender); });
    await Promise.all(jobs);
    return out;
  }

  private aiView(a: AiAssessment) {
    return {
      id: a.id, verdict: a.verdict, labels: a.labels, topLabel: a.topLabel, confidence: a.confidence, reason: a.reason,
      provider: a.provider, model: a.model, version: a.version, error: a.error, createdAt: a.createdAt,
    };
  }

  private caseFields(c: ModerationCase) {
    return {
      id: c.id, targetType: c.targetType, targetId: c.targetId, status: c.status, reportCount: c.reportCount, aiFlaggedAt: c.aiFlaggedAt,
      lastReportedAt: c.lastReportedAt, resolution: c.resolution, resolutionNote: c.resolutionNote, resolvedAt: c.resolvedAt, createdAt: c.createdAt,
    };
  }

  private async mediaViews(ids: string[]) {
    if (!ids.length) return [];
    const rows = await this.prisma.mediaAsset.findMany({ where: { id: { in: ids } } });
    return Promise.all(ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => !!r).map((r) => this.media.view(r)));
  }

  /** Evidence is private: short-lived signed links, for moderators only. */
  private evidence(ids: string[]) {
    return this.mediaViews(ids);
  }

  /** Enough of the reported thing for a moderator to decide, including hidden or removed content. */
  private async preview(type: ReportTarget, id: string) {
    if (type === 'POST') {
      const p = await this.prisma.post.findUnique({
        where: { id },
        include: { author: { select: { id: true, name: true } }, media: { orderBy: { position: 'asc' }, take: 4, include: { media: true } } },
      });
      if (!p) return { exists: false };
      return {
        exists: true, kind: 'POST', postType: p.type, status: p.status, caption: p.caption, author: p.author, createdAt: p.createdAt,
        media: await Promise.all(p.media.map((m) => this.media.view(m.media))),
      };
    }
    if (type === 'COMMENT') {
      const cm = await this.prisma.comment.findUnique({ where: { id }, include: { author: { select: { id: true, name: true } } } });
      return cm ? { exists: true, kind: 'COMMENT', status: cm.status, body: cm.body, postId: cm.postId, author: cm.author, createdAt: cm.createdAt } : { exists: false };
    }
    if (type === 'PET') {
      const pet = await this.prisma.pet.findUnique({ where: { id }, include: { owner: { select: { id: true, name: true } } } });
      return pet ? { exists: true, kind: 'PET', status: pet.status, name: pet.name, handle: pet.handle, about: pet.about, author: pet.owner } : { exists: false };
    }
    if (type === 'PRODUCT') {
      const p = await this.prisma.product.findUnique({ where: { id }, include: { vendor: { select: { id: true, businessName: true, userId: true } } } });
      if (!p) return { exists: false };
      const media = await this.prisma.mediaAsset.findMany({ where: { id: { in: p.imageIds.slice(0, 4) } } });
      return {
        exists: true, kind: 'PRODUCT', status: p.status, name: p.title, body: [p.brand, p.description].filter(Boolean).join(' · '), createdAt: p.createdAt,
        author: { id: p.vendor.userId, name: p.vendor.businessName }, vendorId: p.vendor.id, blockReason: p.blockReason,
        media: await Promise.all(media.map((m) => this.media.view(m))),
      };
    }
    if (type === 'SERVICE_REVIEW') {
      const r = await this.prisma.serviceReview.findUnique({ where: { id }, include: { customer: { select: { id: true, name: true } }, partner: { select: { id: true, businessName: true } } } });
      return r
        ? { exists: true, kind: 'SERVICE_REVIEW', status: r.status, body: r.comment, rating: r.rating, reply: r.reply, author: r.customer, partner: r.partner, createdAt: r.createdAt, media: await this.mediaViews(r.photoIds) }
        : { exists: false };
    }
    if (type === 'PRODUCT_REVIEW') {
      const r = await this.prisma.productReview.findUnique({ where: { id }, include: { customer: { select: { id: true, name: true } }, product: { select: { id: true, title: true } }, vendor: { select: { id: true, businessName: true } } } });
      return r
        ? { exists: true, kind: 'PRODUCT_REVIEW', status: r.status, body: r.comment, rating: r.rating, reply: r.reply, author: r.customer, name: r.product.title, product: r.product, vendor: r.vendor, createdAt: r.createdAt, media: await this.mediaViews(r.photoIds) }
        : { exists: false };
    }
    if (type === 'SERVICE_PARTNER') {
      const p = await this.prisma.servicePartner.findUnique({ where: { id }, include: { user: { select: { id: true, name: true } } } });
      return p
        ? { exists: true, kind: 'SERVICE_PARTNER', status: p.status, name: p.businessName, body: [p.kind, [p.area, p.city].filter(Boolean).join(', '), p.about].filter(Boolean).join(' · '), author: p.user, partnerId: p.id, slug: p.slug, rating: p.ratingAvg, ratingCount: p.ratingCount, createdAt: p.createdAt }
        : { exists: false };
    }
    if (type === 'CHAT_MESSAGE') {
      // The reported message and a few around it, so a moderator sees what it answered. Staff notes are never shown.
      const m = await this.prisma.chatMessage.findUnique({ where: { id }, include: { media: true, sender: { select: { id: true, name: true } }, conversation: { include: { partner: { select: { businessName: true } }, vendor: { select: { businessName: true } }, customer: { select: { id: true, name: true } } } } } });
      if (!m) return { exists: false };
      const around = async (dir: 'lt' | 'gt') => this.prisma.chatMessage.findMany({
        where: { conversationId: m.conversationId, internal: false, createdAt: { [dir]: m.createdAt } },
        orderBy: { createdAt: dir === 'lt' ? 'desc' : 'asc' }, take: dir === 'lt' ? 6 : 3,
        select: { id: true, side: true, body: true, mediaId: true, status: true, createdAt: true },
      });
      const [before, after] = await Promise.all([around('lt'), around('gt')]);
      const c = m.conversation;
      return {
        exists: true, kind: 'CHAT_MESSAGE', status: m.status, body: m.body, author: m.sender, createdAt: m.createdAt,
        media: m.media ? [await this.media.view(m.media)] : [],
        conversation: { id: c.id, kind: c.kind, customer: c.customer, business: c.partner?.businessName ?? c.vendor?.businessName ?? null },
        context: [...before.reverse(), { id: m.id, side: m.side, body: m.body, mediaId: m.mediaId, status: m.status, createdAt: m.createdAt, reported: true }, ...after],
      };
    }
    if (type === 'CONTEST_ENTRY') {
      const e = await this.prisma.contestParticipant.findUnique({
        where: { id },
        include: { user: { select: { id: true, name: true } }, pet: { select: { id: true, name: true } }, contest: { select: { id: true, title: true } }, submissions: { include: { task: { select: { title: true } } } } },
      });
      if (!e) return { exists: false };
      const posts = await this.prisma.post.findMany({ where: { id: { in: e.submissions.map((s) => s.postId).filter((x): x is string => !!x) } }, include: { media: { orderBy: { position: 'asc' }, take: 2, include: { media: true } } } });
      return {
        exists: true, kind: 'CONTEST_ENTRY', status: e.status, name: e.pet.name, author: e.user, contest: e.contest, createdAt: e.createdAt,
        body: e.submissions.map((s) => `${s.task.title}: ${s.text ?? posts.find((p) => p.id === s.postId)?.caption ?? '(post)'}`).join('\n'),
        media: await Promise.all(posts.flatMap((p) => p.media.map((m) => this.media.view(m.media)))),
      };
    }
    const u = await this.prisma.user.findUnique({ where: { id }, select: { id: true, name: true, status: true, createdAt: true } });
    return u ? { exists: true, kind: 'USER', status: u.status, name: u.name, author: { id: u.id, name: u.name }, createdAt: u.createdAt } : { exists: false };
  }
}
