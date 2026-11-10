import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import type { AuthTokens } from '@petapp/types';
import { AppConfig } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { hmac, randomToken } from '../../common/utils/crypto';
import { AUDIENCE } from '../../common/guards/auth.guard';
import type { TokenAudience } from '../../generated/prisma/client';
import type { RequestMetaInfo } from '../../common/decorators/auth.decorators';

@Injectable()
export class TokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    private readonly redis: RedisService,
  ) {}

  private hashRefresh(token: string): string {
    return hmac(this.config.get('JWT_REFRESH_SECRET'), token);
  }

  private refreshTtlMs(audience: TokenAudience): number {
    return audience === 'ADMIN'
      ? this.config.get('REFRESH_TTL_HOURS_ADMIN') * 3600_000
      : this.config.get('REFRESH_TTL_DAYS_APP') * 86_400_000;
  }

  private async signAccess(userId: string, sessionId: string, audience: TokenAudience): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, sid: sessionId },
      {
        secret: this.config.get('JWT_ACCESS_SECRET'),
        issuer: this.config.get('JWT_ISSUER'),
        audience: audience === 'ADMIN' ? AUDIENCE.ADMIN : AUDIENCE.APP,
        expiresIn: this.config.get('JWT_ACCESS_TTL_SECONDS'),
        algorithm: 'HS256',
      },
    );
  }

  /** Starts a new session family. */
  async issue(userId: string, audience: TokenAudience, meta: RequestMetaInfo): Promise<AuthTokens> {
    // Return only the public token contract — the session id stays server-side.
    return this.strip(await this.createSession(userId, audience, randomUUID(), meta));
  }

  private async createSession(userId: string, audience: TokenAudience, familyId: string, meta: RequestMetaInfo): Promise<AuthTokens & { sessionId: string }> {
    const refreshToken = randomToken(48);
    const expiresAt = new Date(Date.now() + this.refreshTtlMs(audience));
    const session = await this.prisma.session.create({
      data: {
        userId,
        familyId,
        audience,
        tokenHash: this.hashRefresh(refreshToken),
        expiresAt,
        ipAddress: meta.ip,
        userAgent: meta.userAgent?.slice(0, 500),
      },
    });
    return {
      sessionId: session.id,
      accessToken: await this.signAccess(userId, session.id, audience),
      refreshToken,
      accessTokenExpiresIn: this.config.get('JWT_ACCESS_TTL_SECONDS'),
      refreshTokenExpiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Rotates a refresh token. Re-use of an already-rotated token revokes the entire family
   * (the token was likely stolen) and forces a fresh sign-in — except within a short grace
   * window after rotation, where it is a concurrent refresh from the same client and gets a
   * fresh session in the same family.
   */
  async rotate(refreshToken: string, meta: RequestMetaInfo): Promise<AuthTokens> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: this.hashRefresh(refreshToken) },
      include: { user: { select: { status: true } } },
    });
    const invalid = new UnauthorizedException('Your session has expired. Please sign in again.');
    if (!session) throw invalid;

    if (session.revokedAt) {
      if (this.withinGrace(session.revokedAt, session.revokeReason) && session.user.status === 'ACTIVE' && session.expiresAt > new Date()) {
        return this.strip(await this.createSession(session.userId, session.audience, session.familyId, meta));
      }
      if (session.replacedById) await this.revokeFamily(session.familyId, 'refresh_token_reuse');
      throw invalid;
    }
    if (session.expiresAt <= new Date() || session.user.status !== 'ACTIVE') {
      await this.prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date(), revokeReason: 'expired_or_inactive' } });
      throw invalid;
    }

    const next = await this.createSession(session.userId, session.audience, session.familyId, meta);
    const updated = await this.prisma.session.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: 'rotated', replacedById: next.sessionId },
    });
    if (updated.count !== 1) {
      // Another request rotated the same token at the same moment.
      const now = await this.prisma.session.findUnique({ where: { id: session.id }, select: { revokedAt: true, revokeReason: true } });
      if (!now?.revokedAt || !this.withinGrace(now.revokedAt, now.revokeReason)) {
        await this.revokeFamily(session.familyId, 'refresh_token_race');
        throw invalid;
      }
    }
    return this.strip(next);
  }

  private withinGrace(revokedAt: Date, reason: string | null): boolean {
    const grace = this.config.get('REFRESH_REUSE_GRACE_SECONDS');
    return reason === 'rotated' && grace > 0 && Date.now() - revokedAt.getTime() <= grace * 1000;
  }

  private strip(t: AuthTokens & { sessionId: string }): AuthTokens {
    return { accessToken: t.accessToken, refreshToken: t.refreshToken, accessTokenExpiresIn: t.accessTokenExpiresIn, refreshTokenExpiresAt: t.refreshTokenExpiresAt };
  }

  async revokeSession(sessionId: string, reason = 'logout'): Promise<void> {
    await this.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: reason } });
    await this.denyAccess([sessionId]);
  }

  async revokeFamily(familyId: string, reason: string): Promise<void> {
    const ids = await this.prisma.session.findMany({ where: { familyId }, select: { id: true } });
    await this.prisma.session.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: reason } });
    await this.denyAccess(ids.map((s) => s.id));
  }

  /** Ends every session of an account, except `keepSessionId` (the one changing its password). */
  async revokeAllForUser(userId: string, reason: string, keepSessionId?: string): Promise<void> {
    const keep = keepSessionId ? { id: { not: keepSessionId } } : {};
    const ids = await this.prisma.session.findMany({ where: { userId, ...keep, OR: [{ revokedAt: null }, { revokedAt: { gt: new Date(Date.now() - this.config.get('JWT_ACCESS_TTL_SECONDS') * 1000) } }] }, select: { id: true } });
    await this.prisma.session.updateMany({ where: { userId, ...keep, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: reason } });
    await this.denyAccess(ids.map((s) => s.id));
  }

  /**
   * Access tokens are short-lived and not looked up on every request, so after a logout, a stolen-token alarm or
   * an account-wide sign-out, their session ids are listed in Redis until the tokens would have expired anyway.
   * (A refresh rotation doesn't do this: the old access token simply runs out.)
   */
  private async denyAccess(sessionIds: string[]) {
    if (!sessionIds.length) return;
    const ttl = this.config.get('JWT_ACCESS_TTL_SECONDS') + 60;
    const m = this.redis.client.multi();
    for (const id of sessionIds) m.set(`revoked-sid:${id}`, '1', 'EX', ttl);
    await m.exec();
  }
}
