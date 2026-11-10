import { likeText } from '../../common/utils/search';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RbacService } from '../rbac/rbac.service';
import { TokenService } from '../auth/token.service';
import { QueueService } from '../../queue/queue.service';
import { MembershipsService } from '../memberships/memberships.service';
import { PlatformService } from '../platform/platform.service';
import { Paged } from '../../common/dto/pagination.dto';
import type { Principal } from '../../common/principal';
import type { RequestMetaInfo } from '../../common/decorators/auth.decorators';
import type { Prisma } from '../../generated/prisma/client';
import type { AddressDto, AdminUsersQuery, SetRolesDto, SetStatusDto, UpdateAddressDto, UpdateMeDto } from './dto/users.dto';

const PROFILE_SELECT = {
  id: true, name: true, phone: true, email: true, avatarUrl: true, gender: true, dateOfBirth: true, city: true,
  status: true, phoneVerifiedAt: true, emailVerifiedAt: true, preferences: true, marketingConsent: true, createdAt: true,
  roles: { select: { role: { select: { key: true } } } },
  _count: { select: { pets: { where: { deletedAt: null } }, followers: true, following: true } },
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
    private readonly tokens: TokenService,
    private readonly queue: QueueService,
    private readonly platform: PlatformService,
    private readonly memberships: MembershipsService,
  ) {}

  // ── self ──

  async me(userId: string) {
    const { roles, _count, ...u } = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: PROFILE_SELECT });
    return {
      ...u, roles: roles.map((r) => r.role.key), counts: { pets: _count.pets, followers: _count.followers, following: _count.following },
      member: await this.memberships.badgeOf(userId),
    };
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...dto,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
        preferences: dto.preferences as Prisma.InputJsonValue | undefined,
      },
    });
    if (dto.name !== undefined) this.queue.assess('USER', userId);
    return this.me(userId);
  }

  /**
   * Marks the account for deletion and signs out everywhere. After the grace period the nightly job erases it
   * (AccountEraser); signing in before then cancels the deletion.
   */
  async requestDeletion(userId: string, meta: RequestMetaInfo) {
    const graceDays = await this.platform.getSetting<number>('privacy.deletionGraceDays');
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { status: 'PENDING_DELETION', deletedAt: new Date() } });
      await this.audit.log({ actorId: userId, action: 'user.delete_request', entityType: 'User', entityId: userId, meta }, tx);
    });
    await this.tokens.revokeAllForUser(userId, 'account_deletion');
    await this.prisma.deviceToken.deleteMany({ where: { userId } });
    await this.rbac.invalidateUser(userId);
    return { graceDays, eraseAfter: new Date(Date.now() + graceDays * 86_400_000) };
  }

  // ── addresses ──

  addresses(userId: string) {
    return this.prisma.address.findMany({ where: { userId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
  }

  async addAddress(userId: string, dto: AddressDto) {
    const count = await this.prisma.address.count({ where: { userId } });
    if (count >= 20) throw new BadRequestException('You can save up to 20 addresses.');
    return this.prisma.$transaction(async (tx) => {
      const makeDefault = dto.isDefault || count === 0;
      if (makeDefault) await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
      return tx.address.create({ data: { ...dto, userId, isDefault: makeDefault } });
    });
  }

  async updateAddress(userId: string, id: string, dto: UpdateAddressDto) {
    await this.ownedAddress(userId, id);
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
      return tx.address.update({ where: { id }, data: dto });
    });
  }

  async deleteAddress(userId: string, id: string) {
    const addr = await this.ownedAddress(userId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.address.delete({ where: { id } });
      if (addr.isDefault) {
        const next = await tx.address.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } });
        if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    });
  }

  private async ownedAddress(userId: string, id: string) {
    // Scoped by owner: another user's address id returns 404 (no IDOR, no existence leak).
    const addr = await this.prisma.address.findFirst({ where: { id, userId } });
    if (!addr) throw new NotFoundException('Address not found.');
    return addr;
  }

  // ── social graph ──

  async publicProfile(id: string, viewerId?: string) {
    const u = await this.prisma.user.findFirst({
      where: { id, status: 'ACTIVE' },
      select: {
        id: true, name: true, avatarUrl: true, city: true, createdAt: true,
        _count: { select: { followers: true, following: true } },
        pets: {
          where: { deletedAt: null, status: 'ACTIVE', visibility: 'PUBLIC' },
          select: { id: true, name: true, handle: true, avatarUrl: true, species: { select: { key: true, name: true } } },
        },
      },
    });
    if (!u) throw new NotFoundException('User not found.');
    if (viewerId && viewerId !== id && (await this.prisma.block.count({ where: { OR: [{ blockerId: viewerId, blockedId: id }, { blockerId: id, blockedId: viewerId }] } }))) {
      throw new NotFoundException('User not found.');
    }
    const isFollowing = viewerId
      ? !!(await this.prisma.userFollower.findUnique({ where: { followerId_followingId: { followerId: viewerId, followingId: id } } }))
      : false;
    const { _count, ...rest } = u;
    return { ...rest, followers: _count.followers, following: _count.following, isFollowing, member: await this.memberships.badgeOf(id) };
  }

  async follow(me: string, id: string) {
    if (me === id) throw new BadRequestException('You cannot follow yourself.');
    const target = await this.prisma.user.findFirst({ where: { id, status: 'ACTIVE' }, select: { id: true } });
    if (!target) throw new NotFoundException('User not found.');
    if (await this.prisma.block.count({ where: { OR: [{ blockerId: me, blockedId: id }, { blockerId: id, blockedId: me }] } })) {
      throw new NotFoundException('User not found.');
    }
    const { count } = await this.prisma.userFollower.createMany({ data: [{ followerId: me, followingId: id }], skipDuplicates: true });
    if (count) this.queue.notify({ type: 'NEW_FOLLOWER', actorId: me, userId: id });
    return { following: true };
  }

  async unfollow(me: string, id: string) {
    await this.prisma.userFollower.deleteMany({ where: { followerId: me, followingId: id } });
    return { following: false };
  }

  // ── admin ──

  async adminList(q: AdminUsersQuery) {
    const s = q.search;
    const where: Prisma.UserWhereInput = {
      status: q.status,
      roles: q.role ? { some: { role: { key: q.role } } } : undefined,
      OR: s
        ? [
            { name: { contains: likeText(s), mode: 'insensitive' } },
            { email: { contains: likeText(s.toLowerCase()) } },
            { phone: { contains: likeText(s.replace(/[^\d+]/g, '') || s) } },
          ]
        : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: q.skip,
        take: q.limit,
        select: {
          id: true, name: true, phone: true, email: true, city: true, status: true, createdAt: true, lastLoginAt: true,
          roles: { select: { role: { select: { key: true } } } },
          _count: { select: { pets: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    return Paged.of(
      items.map(({ roles, _count, ...u }) => ({ ...u, roles: roles.map((r) => r.role.key), petCount: _count.pets })),
      total,
      q,
    );
  }

  async adminDetail(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        ...PROFILE_SELECT, statusReason: true, lastLoginAt: true, deletedAt: true, mfaEnabledAt: true,
        identities: { select: { provider: true, email: true, createdAt: true } },
        pets: { select: { id: true, name: true, handle: true, status: true, isVerified: true, deletedAt: true } },
        addresses: { select: { id: true, city: true, pincode: true, isDefault: true } },
        sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true, audience: true, createdAt: true, userAgent: true, ipAddress: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found.');
    const { roles, ...rest } = user;
    return { ...rest, roles: roles.map((r) => r.role.key) };
  }

  async adminSetStatus(actor: Principal, id: string, dto: SetStatusDto, meta: RequestMetaInfo) {
    if (actor.userId === id) throw new BadRequestException('You cannot change your own account status.');
    const target = await this.prisma.user.findUnique({ where: { id }, select: { status: true, roles: { select: { role: { select: { key: true } } } } } });
    if (!target) throw new NotFoundException('User not found.');
    const targetRoles = target.roles.map((r) => r.role.key);
    if (targetRoles.includes('SUPER_ADMIN') && !actor.isSuperAdmin) throw new ForbiddenException('Only a super admin can change a super admin account.');
    if (target.status === dto.status) throw new BadRequestException(`This account is already ${dto.status.toLowerCase()}.`);

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({ where: { id }, data: { status: dto.status, statusReason: dto.reason }, select: { id: true, status: true, statusReason: true } });
      await this.audit.log({ actorId: actor.userId, action: 'user.status', entityType: 'User', entityId: id, before: { status: target.status }, after: { status: dto.status, reason: dto.reason }, meta }, tx);
      return u;
    });
    if (dto.status !== 'ACTIVE') {
      await this.tokens.revokeAllForUser(id, `status_${dto.status.toLowerCase()}`);
      await this.prisma.deviceToken.deleteMany({ where: { userId: id } }); // nothing is pushed to a locked-out phone
    }
    this.queue.notify({ type: 'ACCOUNT_STATUS', userId: id, status: dto.status });
    await this.rbac.invalidateUser(id);
    return updated;
  }

  /**
   * Replaces a user's roles. Guards against privilege escalation: a non-super-admin can only
   * grant or remove roles whose permissions they hold themselves, and never SUPER_ADMIN.
   */
  async adminSetRoles(actor: Principal, id: string, dto: SetRolesDto, meta: RequestMetaInfo) {
    const target = await this.prisma.user.findUnique({ where: { id }, select: { roles: { select: { role: { select: { id: true, key: true } } } } } });
    if (!target) throw new NotFoundException('User not found.');
    const roles = await this.prisma.role.findMany({
      where: { key: { in: dto.roleKeys } },
      include: { permissions: { include: { permission: { select: { key: true } } } } },
    });
    const unknown = dto.roleKeys.filter((k) => !roles.some((r) => r.key === k));
    if (unknown.length) throw new BadRequestException(`Unknown roles: ${unknown.join(', ')}`);

    const current = target.roles.map((r) => r.role.key);
    const changed = [...dto.roleKeys.filter((k) => !current.includes(k)), ...current.filter((k) => !dto.roleKeys.includes(k))];
    if (!actor.isSuperAdmin) {
      if (changed.includes('SUPER_ADMIN')) throw new ForbiddenException('Only a super admin can grant or remove SUPER_ADMIN.');
      if (actor.userId === id) throw new ForbiddenException('You cannot change your own roles.');
      const changedRoles = await this.prisma.role.findMany({
        where: { key: { in: changed } },
        include: { permissions: { include: { permission: { select: { key: true } } } } },
      });
      const mine = new Set(actor.permissions);
      const beyond = changedRoles.filter((r) => r.permissions.some((p) => !mine.has(p.permission.key))).map((r) => r.key);
      if (beyond.length) throw new ForbiddenException(`You cannot grant or remove roles with permissions you do not hold: ${beyond.join(', ')}`);
    }
    if (actor.userId === id && current.includes('SUPER_ADMIN') && !dto.roleKeys.includes('SUPER_ADMIN')) {
      const others = await this.prisma.userRole.count({ where: { role: { key: 'SUPER_ADMIN' }, userId: { not: id } } });
      if (!others) throw new BadRequestException('At least one super admin must remain.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId: id } });
      await tx.userRole.createMany({ data: roles.map((r) => ({ userId: id, roleId: r.id, assignedById: actor.userId })) });
      await this.audit.log({ actorId: actor.userId, action: 'user.roles', entityType: 'User', entityId: id, before: current, after: dto.roleKeys, meta }, tx);
    });
    await this.rbac.invalidateUser(id);
    return { roles: dto.roleKeys };
  }
}
