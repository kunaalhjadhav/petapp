import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import type { UserStatus } from '../../generated/prisma/client';

export interface UserAccess {
  status: UserStatus;
  roles: string[];
  permissions: string[];
  isStaff: boolean;
}

const TTL = 60;
const VERSION_KEY = 'rbac:version';

/** Resolves a user's roles/permissions/status with a short Redis cache. */
@Injectable()
export class RbacService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  private async key(userId: string): Promise<string> {
    const v = (await this.redis.client.get(VERSION_KEY)) ?? '0';
    return `rbac:v${v}:u:${userId}`;
  }

  async getAccess(userId: string): Promise<UserAccess | null> {
    const k = await this.key(userId);
    const cached = await this.redis.getJson<UserAccess>(k);
    if (cached) return cached;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        status: true,
        roles: {
          select: {
            role: { select: { key: true, isStaff: true, permissions: { select: { permission: { select: { key: true } } } } } },
          },
        },
      },
    });
    if (!user) return null;
    const roles = user.roles.map((r) => r.role.key);
    const permissions = [...new Set(user.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.key)))];
    const access: UserAccess = {
      status: user.status,
      roles,
      permissions,
      isStaff: user.roles.some((r) => r.role.isStaff),
    };
    await this.redis.setJson(k, access, TTL);
    return access;
  }

  /** Call after changing one user's roles or status. */
  async invalidateUser(userId: string): Promise<void> {
    await this.redis.client.del(await this.key(userId));
  }

  /** Call after changing a role's permissions (affects many users). */
  async invalidateAll(): Promise<void> {
    await this.redis.client.incr(VERSION_KEY);
  }
}
