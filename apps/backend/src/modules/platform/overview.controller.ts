import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@petapp/types';
import { AdminOnly, CurrentUser } from '../../common/decorators/auth.decorators';
import type { Principal } from '../../common/principal';
import { PrismaService } from '../../prisma/prisma.service';

const DAY = 86_400_000;

/**
 * Dashboard overview. Available to every staff member; each section is included only
 * when the caller holds the permission that section needs.
 */
@ApiTags('Admin · Overview')
@ApiBearerAuth()
@AdminOnly()
@Controller('admin/overview')
export class OverviewController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async overview(@CurrentUser() me: Principal) {
    const can = (p: string) => me.isSuperAdmin || me.permissions.includes(p);
    const now = Date.now();
    const since7 = new Date(now - 7 * DAY);
    const since30 = new Date(now - 30 * DAY);
    const since14 = new Date(now - 13 * DAY);
    since14.setUTCHours(0, 0, 0, 0);

    const [users, pets, recentAudit, moderation] = await Promise.all([
      can(PERMISSIONS.USERS_READ) ? this.users(since7, since30, since14) : null,
      can(PERMISSIONS.PETS_READ_ANY) ? this.pets(since7) : null,
      can(PERMISSIONS.AUDIT_READ)
        ? this.prisma.auditLog.findMany({
            // Sign-ins stay in the full audit log; the overview shows changes.
            where: { action: { notIn: ['admin.login', 'user.register'] } },
            orderBy: { createdAt: 'desc' },
            take: 8,
            select: { id: true, action: true, entityType: true, entityId: true, createdAt: true, actor: { select: { id: true, name: true, email: true } } },
          })
        : null,
      can(PERMISSIONS.CONTENT_READ) ? this.moderation() : null,
    ]);
    return { users, pets, recentAudit, moderation };
  }

  private async moderation() {
    const [openCases, oldest, byType] = await Promise.all([
      this.prisma.moderationCase.count({ where: { status: 'OPEN' } }),
      this.prisma.moderationCase.findFirst({ where: { status: 'OPEN' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
      this.prisma.moderationCase.groupBy({ by: ['targetType'], where: { status: 'OPEN' }, _count: { _all: true } }),
    ]);
    return { openCases, oldestOpenAt: oldest?.createdAt ?? null, byType: Object.fromEntries(byType.map((b) => [b.targetType, b._count._all])) };
  }

  private async users(since7: Date, since30: Date, since14: Date) {
    const [byStatus, newLast7d, signedInLast30d, staff, daily] = await Promise.all([
      this.prisma.user.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.user.count({ where: { createdAt: { gte: since7 } } }),
      this.prisma.user.count({ where: { lastLoginAt: { gte: since30 } } }),
      this.prisma.user.count({ where: { roles: { some: { role: { isStaff: true } } } } }),
      this.prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
        SELECT date_trunc('day', "createdAt") AS day, count(*)::bigint AS count
        FROM "User" WHERE "createdAt" >= ${since14}
        GROUP BY 1 ORDER BY 1`,
    ]);
    const status = Object.fromEntries(byStatus.map((s) => [s.status, s._count._all]));
    const counts = new Map(daily.map((d) => [d.day.toISOString().slice(0, 10), Number(d.count)]));
    const signupsByDay = Array.from({ length: 14 }, (_, i) => {
      const day = new Date(since14.getTime() + i * DAY).toISOString().slice(0, 10);
      return { day, count: counts.get(day) ?? 0 };
    });
    return {
      total: byStatus.reduce((n, s) => n + s._count._all, 0),
      active: status.ACTIVE ?? 0,
      suspended: status.SUSPENDED ?? 0,
      blocked: status.BLOCKED ?? 0,
      pendingDeletion: status.PENDING_DELETION ?? 0,
      newLast7d,
      signedInLast30d,
      staff,
      signupsByDay,
    };
  }

  private async pets(since7: Date) {
    const live = { deletedAt: null };
    const [total, verified, hidden, newLast7d, bySpecies, species] = await Promise.all([
      this.prisma.pet.count({ where: live }),
      this.prisma.pet.count({ where: { ...live, isVerified: true } }),
      this.prisma.pet.count({ where: { ...live, status: 'HIDDEN' } }),
      this.prisma.pet.count({ where: { ...live, createdAt: { gte: since7 } } }),
      this.prisma.pet.groupBy({ by: ['speciesId'], where: live, _count: { _all: true } }),
      this.prisma.petSpecies.findMany({ select: { id: true, name: true } }),
    ]);
    const name = new Map(species.map((s) => [s.id, s.name]));
    return {
      total,
      verified,
      hidden,
      newLast7d,
      bySpecies: bySpecies
        .map((s) => ({ species: name.get(s.speciesId) ?? 'Unknown', count: s._count._all }))
        .sort((a, b) => b.count - a.count),
    };
  }
}
