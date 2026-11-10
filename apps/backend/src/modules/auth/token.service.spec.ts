import type { RedisService } from '../../redis/redis.service';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TokenService } from './token.service';
import type { AppConfig } from '../../config/app-config.service';
import type { PrismaService } from '../../prisma/prisma.service';

type S = {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  audience: 'APP' | 'ADMIN';
  expiresAt: Date;
  revokedAt: Date | null;
  revokeReason: string | null;
  replacedById: string | null;
};

function fakePrisma() {
  const sessions: S[] = [];
  let n = 0;
  const pick = (w: Partial<S>) =>
    sessions.filter(
      (s) =>
        (!w.id || s.id === w.id) &&
        (!w.userId || s.userId === w.userId) &&
        (!w.familyId || s.familyId === w.familyId) &&
        (!('revokedAt' in w) || s.revokedAt === null),
    );
  return {
    sessions,
    session: {
      create: async ({ data }: { data: Partial<S> }) => {
        const s = { id: `s${++n}`, revokedAt: null, revokeReason: null, replacedById: null, ...data } as S;
        sessions.push(s);
        return s;
      },
      findUnique: async ({ where }: { where: { tokenHash?: string; id?: string } }) => {
        const s = sessions.find((x) => (where.tokenHash ? x.tokenHash === where.tokenHash : x.id === where.id));
        return s ? { ...s, user: { status: 'ACTIVE' } } : null;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<S> }) => Object.assign(pick(where)[0], data),
      findMany: async ({ where }: { where: Partial<S> }) => pick(where).map((x) => ({ id: x.id })),
      updateMany: async ({ where, data }: { where: Partial<S>; data: Partial<S> }) => {
        const hit = pick(where);
        hit.forEach((s) => Object.assign(s, data));
        return { count: hit.length };
      },
    },
  };
}

function setup(grace: number) {
  const prisma = fakePrisma();
  const cfg: Record<string, unknown> = {
    JWT_REFRESH_SECRET: 'r'.repeat(32),
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_ISSUER: 'petapp',
    JWT_ACCESS_TTL_SECONDS: 900,
    REFRESH_TTL_DAYS_APP: 30,
    REFRESH_TTL_HOURS_ADMIN: 12,
    REFRESH_REUSE_GRACE_SECONDS: grace,
  };
  const denied: string[] = [];
  const fakeRedis = { client: { multi: () => { const m = { set: (k: string) => (denied.push(k), m), exec: async () => [] }; return m; } } };
  const svc = new TokenService(prisma as unknown as PrismaService, new JwtService(), { get: (k: string) => cfg[k] } as unknown as AppConfig, fakeRedis as unknown as RedisService);
  return { svc, prisma };
}

describe('TokenService.rotate', () => {
  const meta = {};

  it('returns only the public token fields', async () => {
    const { svc } = setup(0);
    const t = await svc.issue('u1', 'APP', meta);
    expect(Object.keys(t).sort()).toEqual(['accessToken', 'accessTokenExpiresIn', 'refreshToken', 'refreshTokenExpiresAt']);
    expect(Object.keys(await svc.rotate(t.refreshToken, meta)).sort()).toEqual(Object.keys(t).sort());
  });

  it('rotates and revokes the whole family on reuse when there is no grace window', async () => {
    const { svc, prisma } = setup(0);
    const t0 = await svc.issue('u1', 'APP', meta);
    const t1 = await svc.rotate(t0.refreshToken, meta);
    await expect(svc.rotate(t0.refreshToken, meta)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(svc.rotate(t1.refreshToken, meta)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.sessions.every((s) => s.revokedAt)).toBe(true);
  });

  it('treats reuse within the grace window as a concurrent refresh', async () => {
    const { svc, prisma } = setup(15);
    const t0 = await svc.issue('u1', 'APP', meta);
    const a = await svc.rotate(t0.refreshToken, meta);
    const b = await svc.rotate(t0.refreshToken, meta); // parallel request with the same old token
    expect(a.refreshToken).not.toBe(b.refreshToken);
    await expect(svc.rotate(a.refreshToken, meta)).resolves.toBeDefined();
    await expect(svc.rotate(b.refreshToken, meta)).resolves.toBeDefined();
    expect(new Set(prisma.sessions.map((s) => s.familyId)).size).toBe(1);
  });

  it('still revokes the family when reuse happens after the grace window', async () => {
    const { svc, prisma } = setup(15);
    const t0 = await svc.issue('u1', 'APP', meta);
    const t1 = await svc.rotate(t0.refreshToken, meta);
    prisma.sessions[0].revokedAt = new Date(Date.now() - 16_000);
    await expect(svc.rotate(t0.refreshToken, meta)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(svc.rotate(t1.refreshToken, meta)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('never applies the grace window to logged-out sessions', async () => {
    const { svc, prisma } = setup(15);
    const t0 = await svc.issue('u1', 'APP', meta);
    await svc.revokeSession(prisma.sessions[0].id, 'logout');
    await expect(svc.rotate(t0.refreshToken, meta)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
