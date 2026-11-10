import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformService } from '../platform/platform.service';
import type { InterestKind } from '../../generated/prisma/client';

/**
 * Records what signed-in people look at (one row per item per day), for recommendations.
 * Skipped when personalisation is off for the platform or for that person. Never fails the request.
 */
@Injectable()
export class InterestService {
  private readonly logger = new Logger(InterestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: PlatformService,
  ) {}

  record(userId: string | undefined, kind: InterestKind, targetId: string, categoryId?: string | null): void {
    if (!userId) return;
    void this.write(userId, kind, targetId, categoryId ?? null).catch((e: Error) => this.logger.warn(`interest not recorded: ${e.message}`));
  }

  private async write(userId: string, kind: InterestKind, targetId: string, categoryId: string | null) {
    if (!(await this.platform.getSetting<boolean>('reco.personalisationEnabled'))) return;
    // One statement: only for people who haven't turned personalisation off.
    await this.prisma.$executeRaw`
      INSERT INTO "InterestEvent" ("userId", "kind", "targetId", "categoryId", "day")
      SELECT u."id", ${kind}::"InterestKind", ${targetId}::uuid, ${categoryId}::uuid, (now() AT TIME ZONE 'Asia/Kolkata')::date
      FROM "User" u
      WHERE u."id" = ${userId}::uuid AND COALESCE((u."preferences"->>'personalised')::boolean, true)
      ON CONFLICT DO NOTHING`;
  }

  /** Deletes viewing history older than the retention period. */
  async purge(): Promise<number> {
    const days = await this.platform.getSetting<number>('reco.historyDays');
    return this.prisma.interestEvent.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - days * 86_400_000) } } }).then((r) => r.count);
  }
}
