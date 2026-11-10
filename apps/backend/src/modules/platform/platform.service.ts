import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FEATURE_FLAGS, type FeatureFlagKey } from '@petapp/types';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AuditService } from '../audit/audit.service';
import type { Prisma } from '../../generated/prisma/client';
import type { RequestMetaInfo } from '../../common/decorators/auth.decorators';
import { DEFAULT_SETTINGS } from './platform.defaults';

const FLAGS_KEY = 'platform:flags';



@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  async flags(): Promise<Record<FeatureFlagKey, boolean>> {
    const cached = await this.redis.getJson<Record<FeatureFlagKey, boolean>>(FLAGS_KEY);
    if (cached) return cached;
    const rows = await this.prisma.featureFlag.findMany();
    const map = Object.fromEntries(FEATURE_FLAGS.map((k) => [k, false])) as Record<FeatureFlagKey, boolean>;
    for (const r of rows) if (r.key in map) map[r.key as FeatureFlagKey] = r.enabled;
    await this.redis.setJson(FLAGS_KEY, map, 30);
    return map;
  }

  async isEnabled(flag: FeatureFlagKey): Promise<boolean> {
    return (await this.flags())[flag] ?? false;
  }

  listFlags() {
    return this.prisma.featureFlag.findMany({ orderBy: { key: 'asc' } });
  }

  async setFlag(key: string, enabled: boolean, actorId: string, meta: RequestMetaInfo) {
    if (!(FEATURE_FLAGS as readonly string[]).includes(key)) throw new NotFoundException('Unknown feature flag.');
    const before = await this.prisma.featureFlag.findUnique({ where: { key } });
    const flag = await this.prisma.$transaction(async (tx) => {
      const f = await tx.featureFlag.upsert({
        where: { key },
        update: { enabled, updatedById: actorId },
        create: { key, enabled, updatedById: actorId },
      });
      await this.audit.log({ actorId, action: 'flag.update', entityType: 'FeatureFlag', entityId: key, before: before?.enabled ?? null, after: enabled, meta }, tx);
      return f;
    });
    await this.redis.client.del(FLAGS_KEY);
    return flag;
  }

  async getSetting<T>(key: string): Promise<T> {
    const row = await this.prisma.appSetting.findUnique({ where: { key } });
    return (row?.value ?? DEFAULT_SETTINGS[key]?.value) as T;
  }

  listSettings() {
    return this.prisma.appSetting.findMany({ orderBy: { key: 'asc' } });
  }

  async setSetting(key: string, value: Prisma.InputJsonValue, actorId: string, meta: RequestMetaInfo) {
    if (!(key in DEFAULT_SETTINGS)) throw new NotFoundException('Unknown setting.');
    const expected = typeof DEFAULT_SETTINGS[key].value;
    if (typeof value !== expected) throw new BadRequestException(`Setting ${key} expects a ${expected}.`);
    // Money and limit settings are whole, non-negative numbers; rates have a ceiling. A bad value here would
    // otherwise fail every order or booking that uses it.
    if (typeof value === 'number') {
      const def = DEFAULT_SETTINGS[key].value as number;
      if (!Number.isFinite(value) || value < 0) throw new BadRequestException(`Setting ${key} must be zero or more.`);
      if (Number.isInteger(def) && !Number.isInteger(value)) throw new BadRequestException(`Setting ${key} must be a whole number.`);
      if (key.endsWith('Bps') && value > 10_000) throw new BadRequestException(`Setting ${key} is in basis points: at most 10000 (100%).`);
      if (key.endsWith('Pct') && value > 100) throw new BadRequestException(`Setting ${key} is a percentage: at most 100.`);
      if (key.endsWith('historyDays') && (value < 1 || value > 365)) throw new BadRequestException('History can be kept for 1 to 365 days.');
      if (key === 'assistant.dailyMessages' && (value < 1 || value > 500)) throw new BadRequestException('Allow 1 to 500 questions a day.');
      if (key === 'privacy.deletionGraceDays' && (value < 1 || value > 90)) throw new BadRequestException('The grace period can be 1 to 90 days.');
      if (key === 'privacy.exportDays' && (value < 1 || value > 30)) throw new BadRequestException('Downloads can be kept for 1 to 30 days.');
      if (key.endsWith('Score') && value > 100) throw new BadRequestException(`Setting ${key} is a score from 0 to 100.`);
    }
    const before = await this.prisma.appSetting.findUnique({ where: { key } });
    return this.prisma.$transaction(async (tx) => {
      const s = await tx.appSetting.upsert({
        where: { key },
        update: { value, updatedById: actorId },
        create: { key, value, description: DEFAULT_SETTINGS[key].description, updatedById: actorId },
      });
      await this.audit.log({ actorId, action: 'setting.update', entityType: 'AppSetting', entityId: key, before: before?.value ?? null, after: value, meta }, tx);
      return s;
    });
  }
}
