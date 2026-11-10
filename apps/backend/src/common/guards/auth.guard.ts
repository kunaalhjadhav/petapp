import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AppConfig } from '../../config/app-config.service';
import { RbacService } from '../../modules/rbac/rbac.service';
import { RedisService } from '../../redis/redis.service';
import { ActivityService } from '../../modules/analytics/activity.service';
import { ADMIN_ONLY, IS_PUBLIC, MFA_SETUP_ALLOWED, OPTIONAL_AUTH } from '../decorators/auth.decorators';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformService } from '../../modules/platform/platform.service';
import type { AccessTokenPayload, Principal } from '../principal';
import { setContextUser } from '../../observability/context';

export const AUDIENCE = { APP: 'petapp:app', ADMIN: 'petapp:admin' } as const;

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    private readonly rbac: RbacService,
    private readonly redis: RedisService,
    private readonly activity: ActivityService,
    private readonly prisma: PrismaService,
    private readonly platform: PlatformService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);
    const optional = this.reflector.getAllAndOverride<boolean>(OPTIONAL_AUTH, targets);
    const adminOnly = this.reflector.getAllAndOverride<boolean>(ADMIN_ONLY, targets);
    const req = ctx.switchToHttp().getRequest();
    const token = this.extract(req.headers.authorization);

    if (isPublic) return true;
    if (!token) {
      if (optional) return true;
      throw new UnauthorizedException('Please sign in to continue.');
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.get('JWT_ACCESS_SECRET'),
        issuer: this.config.get('JWT_ISSUER'),
        audience: [AUDIENCE.APP, AUDIENCE.ADMIN],
        algorithms: ['HS256'],
      });
    } catch {
      if (optional) return true;
      throw new UnauthorizedException('Your session has expired. Please sign in again.');
    }

    const audience = payload.aud === AUDIENCE.ADMIN ? 'ADMIN' : 'APP';
    if (adminOnly && audience !== 'ADMIN') throw new ForbiddenException('Admin access required.');
    if (!adminOnly && audience === 'ADMIN') throw new ForbiddenException('Use an app session for this endpoint.');

    const access = await this.rbac.getAccess(payload.sub);
    if (!access) throw new UnauthorizedException('Account not found.');
    if (access.status !== 'ACTIVE') throw new ForbiddenException('This account is not active. Please contact support.');
    if (audience === 'ADMIN' && !access.isStaff) throw new ForbiddenException('Admin access required.');
    // Signed out (logout, stolen-token alarm, account-wide sign-out): the token stops working at once, not when it
    // expires. Checked after the account status, so a suspended person still sees why.
    if (payload.sid && (await this.redis.client.exists(`revoked-sid:${payload.sid}`)) === 1) {
      if (optional) return true;
      throw new UnauthorizedException('Your session has ended. Please sign in again.');
    }

    const principal: Principal = {
      userId: payload.sub,
      sessionId: payload.sid,
      audience,
      status: access.status,
      roles: access.roles,
      permissions: access.permissions,
      isSuperAdmin: access.roles.includes('SUPER_ADMIN'),
    };
    // Phase 10a: when staff must use two-factor sign-in, someone without it can only set it up.
    if (audience === 'ADMIN' && !this.reflector.getAllAndOverride<boolean>(MFA_SETUP_ALLOWED, targets) && (await this.platform.getSetting<boolean>('security.requireStaffMfa'))) {
      const u = await this.prisma.user.findUnique({ where: { id: payload.sub }, select: { mfaEnabledAt: true } });
      if (!u?.mfaEnabledAt) throw new ForbiddenException({ message: 'Set up two-factor sign-in under Your account to continue.', errors: [{ code: 'MFA_SETUP_REQUIRED', message: 'mfa setup required' }] });
    }

    req.principal = principal;
    setContextUser(principal.userId);
    // Daily active users (spec §55): app sessions only; staff using the dashboard aren't customers.
    if (audience === 'APP') this.activity.touch(principal.userId);
    return true;
  }

  private extract(header?: string): string | undefined {
    if (!header) return undefined;
    const [type, value] = header.split(' ');
    return type?.toLowerCase() === 'bearer' && value ? value : undefined;
  }
}
