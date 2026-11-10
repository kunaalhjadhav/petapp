import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { istDay } from './analytics.rules';

/**
 * Records that someone used the app today, and reel views and watch-to-the-end counts per day. Only counts are
 * kept: the day someone was active, never what they did. Fire-and-forget: a failure here never fails a request.
 */
@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Once per person per India-time day: one Redis check per request, one database write per day. */
  touch(userId: string): void {
    const day = istDay();
    void this.redis.client
      .set(`act:${day}:${userId}`, '1', 'EX', 2 * 86_400, 'NX')
      .then((fresh) => (fresh ? this.prisma.$executeRaw`INSERT INTO "UserActivity" ("day", "userId") VALUES (${day}::date, ${userId}::uuid) ON CONFLICT DO NOTHING` : 0))
      .catch((e: Error) => this.logger.warn(`activity not recorded: ${e.message}`));
  }

  /** A counted view (already de-duplicated per viewer per day by the caller). */
  async view(postId: string): Promise<void> {
    await this.bump(postId, 'views');
  }

  /** Someone watched a video to the end; once per viewer per post per day. */
  async completed(postId: string, viewer: string): Promise<boolean> {
    const fresh = await this.redis.client.set(`viewdone:${postId}:${viewer}:${istDay()}`, '1', 'EX', 90_000, 'NX');
    if (fresh) await this.bump(postId, 'completions');
    return fresh === 'OK';
  }

  private async bump(postId: string, column: 'views' | 'completions') {
    const day = istDay();
    try {
      if (column === 'views') {
        await this.prisma.$executeRaw`INSERT INTO "PostDailyStat" ("postId", "day", "views") VALUES (${postId}::uuid, ${day}::date, 1)
          ON CONFLICT ("postId", "day") DO UPDATE SET "views" = "PostDailyStat"."views" + 1`;
      } else {
        await this.prisma.$executeRaw`INSERT INTO "PostDailyStat" ("postId", "day", "completions") VALUES (${postId}::uuid, ${day}::date, 1)
          ON CONFLICT ("postId", "day") DO UPDATE SET "completions" = "PostDailyStat"."completions" + 1`;
      }
    } catch (e) {
      this.logger.warn(`post stats not recorded: ${(e as Error).message}`);
    }
  }
}
