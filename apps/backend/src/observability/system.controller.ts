import { BadRequestException, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@petapp/types';
import { AdminOnly, CurrentUser, RequestMeta, RequirePermissions, type RequestMetaInfo } from '../common/decorators/auth.decorators';
import type { Principal } from '../common/principal';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { StorageService } from '../providers/storage/storage.service';
import { QueueService } from '../queue/queue.service';
import { AuditService } from '../modules/audit/audit.service';

const timed = async (fn: () => Promise<unknown>) => {
  const t = Date.now();
  try {
    await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('timed out after 2 s')), 2000))]);
    return { ok: true, ms: Date.now() - t };
  } catch (e) {
    return { ok: false, ms: Date.now() - t, error: (e as Error).message.slice(0, 200) };
  }
};

/** The dashboard's System page: dependencies, background jobs, providers in use, and money needing attention. */
@ApiTags('Admin · System')
@ApiBearerAuth()
@AdminOnly()
@Controller('admin/system')
export class SystemController {
  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
    private readonly queues: QueueService,
    private readonly audit: AuditService,
  ) {}

  private get all() {
    return [this.queues.media, this.queues.maintenance, this.queues.notifications, this.queues.trust];
  }

  @Get() @RequirePermissions(PERMISSIONS.SETTINGS_READ) async status() {
    const c = (k: Parameters<AppConfig['get']>[0]) => this.config.get(k);
    const [database, redis, storage] = await Promise.all([
      timed(() => this.prisma.$queryRaw`SELECT 1`),
      timed(() => this.redis.client.ping()),
      this.storage.configured ? timed(() => this.storage.ping()) : Promise.resolve({ ok: false, ms: 0, error: 'not configured' }),
    ]);
    const queues = await Promise.all(
      this.all.map(async (q) => {
        const counts = await q.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed');
        const failed = await q.getFailed(0, 9);
        return {
          name: q.name,
          counts,
          recentFailures: failed.map((j) => ({ id: j.id, job: j.name, error: (j.failedReason ?? '').slice(0, 300), attempts: j.attemptsMade, at: j.finishedOn ? new Date(j.finishedOn) : null })),
        };
      }),
    );
    const week = new Date(Date.now() - 7 * 86_400_000);
    const [refundsFailed, payoutsFailed, refundsOverdue, webhooksUnprocessed] = await Promise.all([
      this.prisma.refund.count({ where: { status: 'FAILED', createdAt: { gte: week } } }),
      this.prisma.payout.count({ where: { status: 'FAILED', createdAt: { gte: week } } }),
      this.prisma.refund.count({ where: { status: { in: ['PENDING', 'PROCESSING'] }, createdAt: { lt: new Date(Date.now() - 86_400_000) } } }),
      this.prisma.paymentWebhookEvent.count({ where: { processedAt: null, createdAt: { lt: new Date(Date.now() - 300_000) } } }),
    ]);
    return {
      environment: c('NODE_ENV'),
      release: c('APP_RELEASE') ?? null,
      uptimeSeconds: Math.round(process.uptime()),
      checks: { database, redis, storage },
      queues,
      providers: {
        payments: c('PAYMENT_PROVIDER'),
        payouts: c('PAYOUT_PROVIDER'),
        sms: c('SMS_PROVIDER'),
        push: c('PUSH_PROVIDER'),
        ai: c('AI_PROVIDER'),
        errorTracking: c('ERROR_TRACKER'),
        metrics: c('METRICS_TOKEN') ? 'token set' : 'no token',
        mediaCdn: c('MEDIA_PUBLIC_BASE_URL') ? 'set' : 'not set',
      },
      money: { refundsFailed, payoutsFailed, refundsOverdue, webhooksUnprocessed },
    };
  }

  /** Puts a queue's failed jobs back to run again (after fixing what made them fail). */
  @Post('queues/:name/retry') @HttpCode(200) @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  async retry(@CurrentUser() me: Principal, @Param('name') name: string, @RequestMeta() meta: RequestMetaInfo) {
    const q = this.all.find((x) => x.name === name);
    if (!q) throw new BadRequestException('Unknown queue.');
    const failed = await q.getFailed(0, 999);
    await Promise.all(failed.map((j) => j.retry().catch(() => undefined)));
    await this.audit.log({ actorId: me.userId, action: 'system.queue_retry', entityType: 'Queue', after: { queue: name, jobs: failed.length }, meta });
    return { retried: failed.length };
  }
}
