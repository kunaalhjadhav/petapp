import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PlatformService } from '../platform/platform.service';
import { RbacService } from '../rbac/rbac.service';
import { Paged } from '../../common/dto/pagination.dto';
import type { RequestMetaInfo } from '../../common/decorators/auth.decorators';
import type { Prisma } from '../../generated/prisma/client';
import { AccountEraser } from './account-eraser';
import type { PrivacyRequestsQuery } from './privacy.dto';

const DAY = 86_400_000;

/** Staff view of deletion requests and data exports. */
@Injectable()
export class PrivacyAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly platform: PlatformService,
    private readonly rbac: RbacService,
    private readonly eraser: AccountEraser,
  ) {}

  async deletions(q: PrivacyRequestsQuery) {
    const state = q.state ?? 'scheduled';
    const where: Prisma.UserWhereInput =
      state === 'erased' ? { status: 'DELETED', statusReason: 'Erased' }
      : state === 'deferred' ? { status: 'PENDING_DELETION', statusReason: { startsWith: 'Waiting:' } }
      : { status: 'PENDING_DELETION' };
    const graceDays = await this.platform.getSetting<number>('privacy.deletionGraceDays');
    const since = new Date(Date.now() - 30 * DAY);
    const [items, total, counts, exports] = await Promise.all([
      this.prisma.user.findMany({
        where, skip: q.skip, take: q.limit,
        orderBy: state === 'erased' ? { updatedAt: 'desc' } : { deletedAt: 'asc' },
        select: { id: true, name: true, phone: true, email: true, status: true, statusReason: true, deletedAt: true, updatedAt: true, createdAt: true },
      }),
      this.prisma.user.count({ where }),
      this.prisma.user.groupBy({ by: ['status'], where: { OR: [{ status: 'PENDING_DELETION' }, { status: 'DELETED', statusReason: 'Erased' }] }, _count: { _all: true } }),
      this.prisma.dataExport.groupBy({ by: ['status'], where: { createdAt: { gt: since } }, _count: { _all: true } }),
    ]);
    const deferred = await this.prisma.user.count({ where: { status: 'PENDING_DELETION', statusReason: { startsWith: 'Waiting:' } } });
    const rows = items.map((u) => ({
      ...u,
      requestedAt: u.deletedAt,
      eraseAfter: u.deletedAt && u.status === 'PENDING_DELETION' ? new Date(u.deletedAt.getTime() + graceDays * DAY) : null,
      waitingFor: u.statusReason?.startsWith('Waiting:') ? u.statusReason.slice(9).split('; ') : [],
      erasedAt: u.status === 'DELETED' ? u.updatedAt : null,
    }));
    const page = Paged.of(rows, total, q);
    // Extra numbers ride along in the page meta (the response keeps the class to put them there).
    return new Paged(rows, {
      ...page.meta,
      graceDays,
      counts: {
        scheduled: counts.find((c) => c.status === 'PENDING_DELETION')?._count._all ?? 0,
        deferred,
        erased: counts.find((c) => c.status === 'DELETED')?._count._all ?? 0,
      },
      exports30d: Object.fromEntries(exports.map((e) => [e.status, e._count._all])),
    } as typeof page.meta);
  }

  async eraseNow(userId: string, actorId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
    if (!u) throw new NotFoundException('User not found.');
    if (u.status !== 'PENDING_DELETION') throw new BadRequestException('Only accounts whose owner asked for deletion can be erased.');
    return this.eraser.erase(userId, actorId);
  }

  async cancel(userId: string, actorId: string, meta: RequestMetaInfo) {
    const done = await this.prisma.$transaction(async (tx) => {
      const r = await tx.user.updateMany({ where: { id: userId, status: 'PENDING_DELETION' }, data: { status: 'ACTIVE', deletedAt: null, statusReason: null } });
      if (r.count) await this.audit.log({ actorId, action: 'user.delete_cancelled', entityType: 'User', entityId: userId, after: { by: 'staff' }, meta }, tx);
      return r.count > 0;
    });
    if (!done) throw new BadRequestException('This account isn’t waiting to be deleted.');
    await this.rbac.invalidateUser(userId);
    return { status: 'ACTIVE' };
  }
}
