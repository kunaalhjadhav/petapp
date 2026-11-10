import { likeText } from '../../common/utils/search';
import { ConsentService } from '../privacy/consent.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../../providers/storage/storage.service';
import { QueueService } from '../../queue/queue.service';
import { Paged } from '../../common/dto/pagination.dto';
import { slugify } from '../../common/utils/slug';
import type { Prisma, ServicePartner } from '../../generated/prisma/client';
import { LedgerService } from '../finance/ledger.service';
import type {
  AdminPartnersQuery,
  CategoryDto,
  DocumentDto,
  HoursItem,
  PartnerProfileDto,
  PartnerReviewDecisionDto,
  ServiceDto,
  TimeOffDto,
  UpdatePartnerProfileDto,
  UpdateServiceDto,
} from './services.dto';

const normPhone = (p: string) => (p.startsWith('+91') ? p : `+91${p}`);

@Injectable()
export class PartnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly queue: QueueService,
    private readonly ledger: LedgerService,
    private readonly consents: ConsentService,
  ) {}

  // ══════════════ categories ══════════════

  categories(all = false) {
    return this.prisma.serviceCategory.findMany({
      where: all ? undefined : { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async saveCategory(actorId: string, dto: CategoryDto, id?: string) {
    const c = id
      ? await this.prisma.serviceCategory.update({ where: { id }, data: dto })
      : await this.prisma.serviceCategory.create({ data: dto });
    await this.audit.log({
      actorId,
      action: id ? 'service_category.update' : 'service_category.create',
      entityType: 'ServiceCategory',
      entityId: c.id,
      after: dto,
    });
    return c;
  }

  // ══════════════ partner: own profile ══════════════

  private async mine(userId: string) {
    const p = await this.prisma.servicePartner.findUnique({ where: { userId } });
    if (!p) throw new NotFoundException('Create your business profile first.');
    if (p.status === 'SUSPENDED')
      throw new ForbiddenException('Your business is paused. Contact support.');
    return p;
  }

  async createProfile(userId: string, dto: PartnerProfileDto) {
    if (await this.prisma.servicePartner.count({ where: { userId } }))
      throw new ConflictException('You already have a business profile.');
    const slug = `${slugify(dto.businessName).replace(/\./g, '-')}-${randomBytes(2).toString('hex')}`;
    const p = await this.prisma.servicePartner.create({
      data: { ...dto, phone: normPhone(dto.phone), userId, slug },
    });
    await this.audit.log({
      actorId: userId,
      action: 'partner.create',
      entityType: 'ServicePartner',
      entityId: p.id,
      after: { businessName: p.businessName, city: p.city },
    });
    return this.me(userId);
  }

  async updateProfile(userId: string, dto: UpdatePartnerProfileDto) {
    const p = await this.mine(userId);
    await this.prisma.servicePartner.update({
      where: { id: p.id },
      data: { ...dto, phone: dto.phone ? normPhone(dto.phone) : undefined },
    });
    await this.audit.log({
      actorId: userId,
      action: 'partner.update',
      entityType: 'ServicePartner',
      entityId: p.id,
      after: { fields: Object.keys(dto) },
    });
    return this.me(userId);
  }

  async me(userId: string) {
    const p = await this.prisma.servicePartner.findUnique({
      where: { userId },
      include: {
        documents: { include: { media: true }, orderBy: { createdAt: 'asc' } },
        services: { include: { category: true }, orderBy: { createdAt: 'asc' } },
        hours: { orderBy: [{ weekday: 'asc' }, { opensMin: 'asc' }] },
        timeOff: { where: { endsAt: { gt: new Date() } }, orderBy: { startsAt: 'asc' } },
      },
    });
    if (!p) return null;
    return { ...(await this.withDocs(p)), checklist: this.checklist(p) };
  }

  /** What's still needed before the application can be submitted. */
  private checklist(p: {
    documents: Array<{ kind: string; status: string }>;
    services: Array<{ isActive: boolean }>;
    hours: unknown[];
  }) {
    const missing: string[] = [];
    if (!p.documents.some((d) => d.kind === 'ID_PROOF' && d.status !== 'REJECTED'))
      missing.push('Upload an ID proof.');
    if (!p.services.some((s) => s.isActive)) missing.push('Add at least one service.');
    if (!p.hours.length) missing.push('Set your opening hours.');
    return missing;
  }

  private async withDocs<
    T extends {
      documents: Array<{
        id: string;
        kind: string;
        status: string;
        note: string | null;
        createdAt: Date;
        media: { storageKey: string; mimeType: string };
      }>;
    },
  >(p: T) {
    const documents = await Promise.all(
      p.documents.map(async (d) => ({
        id: d.id,
        kind: d.kind,
        status: d.status,
        note: d.note,
        createdAt: d.createdAt,
        mimeType: d.media.mimeType,
        url: await this.storage.privateDocumentUrl(d.media.storageKey),
      })),
    );
    return { ...p, documents };
  }

  /**
   * Earnings from completed visits, by month in India time, plus what confirmed upcoming
   * bookings will add. Payouts themselves arrive with the finance module (Phase 6).
   */
  async earnings(userId: string, months = 6) {
    const p = await this.mine(userId);
    const since = new Date();
    since.setUTCMonth(since.getUTCMonth() - (months - 1), 1);
    since.setUTCHours(0, 0, 0, 0);
    const [completed, upcoming, noShows, byMonth] = await Promise.all([
      this.prisma.booking.aggregate({
        where: { partnerId: p.id, status: 'COMPLETED' },
        _count: { _all: true },
        _sum: { pricePaise: true, platformFeePaise: true, partnerEarningPaise: true },
      }),
      this.prisma.booking.aggregate({
        where: { partnerId: p.id, status: 'CONFIRMED', startsAt: { gt: new Date() } },
        _count: { _all: true },
        _sum: { partnerEarningPaise: true },
      }),
      this.prisma.booking.count({ where: { partnerId: p.id, status: 'NO_SHOW' } }),
      this.prisma.$queryRaw<Array<{ month: string; visits: bigint; gross: bigint; fees: bigint; earned: bigint }>>`
        SELECT to_char(date_trunc('month', ("startsAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM') AS month,
               count(*) AS visits, sum("pricePaise") AS gross, sum("platformFeePaise") AS fees, sum("partnerEarningPaise") AS earned
        FROM "Booking"
        WHERE "partnerId" = ${p.id}::uuid AND status = 'COMPLETED' AND "startsAt" >= ${since}
        GROUP BY 1 ORDER BY 1 DESC`,
    ]);
    return {
      completed: {
        visits: completed._count._all,
        grossPaise: completed._sum.pricePaise ?? 0,
        platformFeesPaise: completed._sum.platformFeePaise ?? 0,
        earnedPaise: completed._sum.partnerEarningPaise ?? 0,
      },
      upcoming: { visits: upcoming._count._all, expectedPaise: upcoming._sum.partnerEarningPaise ?? 0 },
      noShows,
      months: byMonth.map((m) => ({ month: m.month, visits: Number(m.visits), grossPaise: Number(m.gross), platformFeesPaise: Number(m.fees), earnedPaise: Number(m.earned) })),
      // What PetApp owes the partner now, from the ledger (after TCS and TDS, including late-cancellation charges).
      balancePaise: await this.ledger.balance(`PARTNER:${p.id}`),
      payouts: 'Earnings become payable after a short holding period, and are paid to your bank account or UPI ID in regular payout batches. Your statement shows every visit, fee and tax deduction.',
    };
  }

  async addDocument(userId: string, dto: DocumentDto) {
    const p = await this.mine(userId);
    const media = await this.prisma.mediaAsset.findFirst({
      where: { id: dto.mediaId, ownerId: userId, kind: 'DOCUMENT', status: 'READY' },
    });
    if (!media)
      throw new BadRequestException('Upload the document first (kind DOCUMENT), then add it here.');
    await this.prisma.partnerDocument.create({
      data: { partnerId: p.id, kind: dto.kind, mediaId: media.id },
    });
    return this.me(userId);
  }

  async removeDocument(userId: string, id: string) {
    const p = await this.mine(userId);
    const d = await this.prisma.partnerDocument.findFirst({ where: { id, partnerId: p.id } });
    if (!d) throw new NotFoundException('Document not found.');
    if (d.status === 'ACCEPTED')
      throw new BadRequestException(
        'Accepted documents can’t be removed. Contact support to replace one.',
      );
    await this.prisma.partnerDocument.delete({ where: { id } });
    return this.me(userId);
  }

  async submit(userId: string) {
    const p = await this.mine(userId);
    if (!['DRAFT', 'REJECTED'].includes(p.status))
      throw new BadRequestException(
        p.status === 'SUBMITTED'
          ? 'Already submitted. We’ll be in touch.'
          : 'Your business is already approved.',
      );
    const full = await this.prisma.servicePartner.findUniqueOrThrow({
      where: { id: p.id },
      include: { documents: true, services: true, hours: true },
    });
    const missing = this.checklist(full);
    if (missing.length)
      throw new BadRequestException({
        message: 'A few things are still missing.',
        errors: missing.map((message) => ({ message })),
      });
    await this.consents.require(userId, 'partner-terms');
    await this.prisma.servicePartner.update({
      where: { id: p.id },
      data: { status: 'SUBMITTED', submittedAt: new Date(), statusReason: null },
    });
    await this.audit.log({
      actorId: userId,
      action: 'partner.submit',
      entityType: 'ServicePartner',
      entityId: p.id,
    });
    return this.me(userId);
  }

  // ── services, hours, time off ──

  async addService(userId: string, dto: ServiceDto) {
    const p = await this.mine(userId);
    await this.assertCategory(dto.categoryId);
    if (dto.modes.includes('AT_HOME') && p.homeVisitRadiusKm === 0)
      throw new BadRequestException(
        'Set how far you travel for home visits in your profile first.',
      );
    await this.prisma.partnerService.create({ data: { ...dto, partnerId: p.id } });
    return this.me(userId);
  }

  async updateService(userId: string, id: string, dto: UpdateServiceDto) {
    const p = await this.mine(userId);
    const s = await this.prisma.partnerService.findFirst({ where: { id, partnerId: p.id } });
    if (!s) throw new NotFoundException('Service not found.');
    if (dto.categoryId) await this.assertCategory(dto.categoryId);
    // Price changes apply to new bookings only; existing bookings keep their snapshot.
    await this.prisma.partnerService.update({ where: { id }, data: dto });
    return this.me(userId);
  }

  private async assertCategory(id: string) {
    if (!(await this.prisma.serviceCategory.count({ where: { id, isActive: true } })))
      throw new BadRequestException('Choose an active category.');
  }

  async setHours(userId: string, hours: HoursItem[]) {
    const p = await this.mine(userId);
    for (const h of hours)
      if (h.closesMin <= h.opensMin)
        throw new BadRequestException('Closing time must be after opening time.');
    for (let d = 0; d < 7; d++) {
      const day = hours.filter((h) => h.weekday === d).sort((a, b) => a.opensMin - b.opensMin);
      for (let i = 1; i < day.length; i++)
        if (day[i].opensMin < day[i - 1].closesMin)
          throw new BadRequestException('Opening hours on the same day can’t overlap.');
    }
    await this.prisma.$transaction([
      this.prisma.partnerHours.deleteMany({ where: { partnerId: p.id } }),
      this.prisma.partnerHours.createMany({ data: hours.map((h) => ({ ...h, partnerId: p.id })) }),
    ]);
    return this.me(userId);
  }

  async addTimeOff(userId: string, dto: TimeOffDto) {
    const p = await this.mine(userId);
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (endsAt <= startsAt) throw new BadRequestException('Time off must end after it starts.');
    const clashes = await this.prisma.booking.count({
      where: {
        partnerId: p.id,
        status: { in: ['CONFIRMED', 'IN_PROGRESS'] },
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
      },
    });
    await this.prisma.partnerTimeOff.create({
      data: { partnerId: p.id, startsAt, endsAt, reason: dto.reason },
    });
    // Existing bookings are kept: the partner decides whether to cancel them (with a full refund).
    return {
      ...(await this.me(userId)),
      warning: clashes
        ? `${clashes} confirmed booking${clashes === 1 ? '' : 's'} fall in this time. Cancel them from your bookings if you can’t serve them.`
        : null,
    };
  }

  async removeTimeOff(userId: string, id: string) {
    const p = await this.mine(userId);
    await this.prisma.partnerTimeOff.deleteMany({ where: { id, partnerId: p.id } });
    return this.me(userId);
  }

  // ══════════════ admin: verification ══════════════

  async adminList(q: AdminPartnersQuery) {
    const where: Prisma.ServicePartnerWhereInput = {
      status: q.status,
      ...(q.q
        ? {
            OR: [
              { businessName: { contains: likeText(q.q), mode: 'insensitive' } },
              { city: { contains: likeText(q.q), mode: 'insensitive' } },
              { phone: { contains: likeText(q.q) } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.servicePartner.findMany({
        where,
        skip: q.skip,
        take: q.limit,
        orderBy: q.status === 'SUBMITTED' ? { submittedAt: 'asc' } : { createdAt: 'desc' },
        include: {
          user: { select: { id: true, name: true } },
          _count: {
            select: { services: { where: { isActive: true } }, documents: true, bookings: true },
          },
        },
      }),
      this.prisma.servicePartner.count({ where }),
    ]);
    return Paged.of(items, total, q);
  }

  async adminDetail(id: string) {
    const p = await this.prisma.servicePartner.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, phone: true, email: true, createdAt: true } },
        documents: { include: { media: true }, orderBy: { createdAt: 'asc' } },
        services: { include: { category: true } },
        hours: { orderBy: [{ weekday: 'asc' }, { opensMin: 'asc' }] },
      },
    });
    if (!p) throw new NotFoundException('Partner not found.');
    const [byStatus, earnings] = await Promise.all([
      this.prisma.booking.groupBy({
        by: ['status'],
        where: { partnerId: id },
        _count: { _all: true },
      }),
      this.prisma.booking.aggregate({
        where: { partnerId: id, status: 'COMPLETED' },
        _sum: { pricePaise: true, platformFeePaise: true, partnerEarningPaise: true },
      }),
    ]);
    return {
      ...(await this.withDocs(p)),
      checklist: this.checklist(p),
      bookings: Object.fromEntries(byStatus.map((b) => [b.status, b._count._all])),
      completedTotals: earnings._sum,
    };
  }

  async review(actorId: string, id: string, dto: PartnerReviewDecisionDto) {
    const p = await this.prisma.servicePartner.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Partner not found.');
    const next: Record<string, { from: string[]; to: ServicePartner['status'] }> = {
      APPROVE: { from: ['SUBMITTED'], to: 'APPROVED' },
      REJECT: { from: ['SUBMITTED'], to: 'REJECTED' },
      SUSPEND: { from: ['APPROVED'], to: 'SUSPENDED' },
      REINSTATE: { from: ['SUSPENDED'], to: 'APPROVED' },
    };
    const step = next[dto.decision];
    if (!step.from.includes(p.status))
      throw new BadRequestException(
        `Can’t ${dto.decision.toLowerCase()} a partner that is ${p.status.toLowerCase()}.`,
      );
    if ((dto.decision === 'REJECT' || dto.decision === 'SUSPEND') && !dto.reason)
      throw new BadRequestException('Give a reason. The partner will see it.');
    if (dto.decision === 'APPROVE') {
      const docs = await this.prisma.partnerDocument.findMany({ where: { partnerId: id } });
      const decided = new Map((dto.documents ?? []).map((d) => [d.id, d.status]));
      const idOk = docs.some(
        (d) => d.kind === 'ID_PROOF' && (decided.get(d.id) ?? d.status) === 'ACCEPTED',
      );
      if (!idOk) throw new BadRequestException('Accept the partner’s ID proof before approving.');
    }
    await this.prisma.$transaction(async (tx) => {
      for (const d of dto.documents ?? [])
        await tx.partnerDocument.updateMany({
          where: { id: d.id, partnerId: id },
          data: { status: d.status, note: d.note },
        });
      await tx.servicePartner.update({
        where: { id },
        data: {
          status: step.to,
          statusReason: dto.reason ?? null,
          reviewedAt: new Date(),
          reviewedById: actorId,
        },
      });
      if (step.to === 'APPROVED') {
        const role = await tx.role.findUniqueOrThrow({ where: { key: 'SERVICE_PARTNER' } });
        await tx.userRole.createMany({
          data: [{ userId: p.userId, roleId: role.id }],
          skipDuplicates: true,
        });
      }
      await this.audit.log(
        {
          actorId,
          action: `partner.${dto.decision.toLowerCase()}`,
          entityType: 'ServicePartner',
          entityId: id,
          before: { status: p.status },
          after: { status: step.to, reason: dto.reason, documents: dto.documents },
        },
        tx,
      );
    });
    this.queue.notify({ type: 'PARTNER_STATUS', partnerId: id });
    return this.adminDetail(id);
  }

  async setCommission(actorId: string, id: string, commissionBps: number | null) {
    const p = await this.prisma.servicePartner.update({ where: { id }, data: { commissionBps } });
    await this.audit.log({
      actorId,
      action: 'partner.commission',
      entityType: 'ServicePartner',
      entityId: id,
      after: { commissionBps },
    });
    return { id: p.id, commissionBps: p.commissionBps };
  }
}
