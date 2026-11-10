import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Paged } from '../../common/dto/pagination.dto';
import { Prisma } from '../../generated/prisma/client';
import { promotionProblem } from './reminders.rules';
import type { PromotionDto, PromotionsQuery } from './promotions.dto';

/**
 * Who a promotion can reach: active customers (no staff) who turned promotions on, optionally only members or one
 * city. Shared by the audience estimate here and the worker that sends it.
 */
export function promotionAudienceSql(audience: string, city: string | null | undefined, now: Date): Prisma.Sql {
  const members = audience === 'MEMBERS'
    ? Prisma.sql`AND EXISTS (SELECT 1 FROM "Membership" m WHERE m."userId" = u.id AND m.status = 'ACTIVE' AND m."startsAt" <= ${now} AND m."endsAt" > ${now})`
    : Prisma.empty;
  const inCity = audience === 'CITY' && city ? Prisma.sql`AND lower(u.city) = lower(${city.trim()})` : Prisma.empty;
  return Prisma.sql`FROM "User" u JOIN "NotificationPreference" np ON np."userId" = u.id
    WHERE u.status = 'ACTIVE' AND np.promotions = true
      AND NOT EXISTS (SELECT 1 FROM "UserRole" ur JOIN "Role" r ON r.id = ur."roleId" WHERE ur."userId" = u.id AND r."isStaff")
      ${members} ${inCity}`;
}

/** Promotional notifications (spec §36): written by staff, sent by the worker only to people who opted in. */
@Injectable()
export class PromotionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async audienceSize(audience: string, city?: string) {
    const [row] = await this.prisma.$queryRaw<Array<{ n: number }>>`SELECT COUNT(*)::int AS n ${promotionAudienceSql(audience, city, new Date())}`;
    return { audience, city: city ?? null, people: row.n };
  }

  async list(q: PromotionsQuery) {
    const [rows, total] = await Promise.all([
      this.prisma.promotion.findMany({ orderBy: { createdAt: 'desc' }, skip: q.skip, take: q.limit, include: { createdBy: { select: { name: true } } } }),
      this.prisma.promotion.count(),
    ]);
    return Paged.of(rows.map(({ createdBy, ...p }) => ({ ...p, createdBy: createdBy.name })), total, q);
  }

  async create(actorId: string, dto: PromotionDto) {
    const now = new Date();
    const sendAt = dto.sendAt ? new Date(dto.sendAt) : now;
    const problem = promotionProblem({ ...dto, sendAt }, now);
    if (problem) throw new BadRequestException(problem);
    const p = await this.prisma.promotion.create({
      data: { title: dto.title, body: dto.body, link: dto.link || null, audience: dto.audience, city: dto.audience === 'CITY' ? dto.city!.trim() : null, sendAt: sendAt < now ? now : sendAt, createdById: actorId },
    });
    await this.audit.log({ actorId, action: 'promotion.create', entityType: 'Promotion', entityId: p.id, after: { title: p.title, audience: p.audience, city: p.city, sendAt: p.sendAt } });
    return p;
  }

  async cancel(actorId: string, id: string) {
    const { count } = await this.prisma.promotion.updateMany({ where: { id, status: 'QUEUED' }, data: { status: 'CANCELLED' } });
    if (!count) {
      const p = await this.prisma.promotion.findUnique({ where: { id }, select: { status: true } });
      if (!p) throw new NotFoundException('Promotion not found.');
      throw new BadRequestException('Only a promotion that hasn’t started sending can be cancelled.');
    }
    await this.audit.log({ actorId, action: 'promotion.cancel', entityType: 'Promotion', entityId: id });
    return this.prisma.promotion.findUniqueOrThrow({ where: { id } });
  }
}
