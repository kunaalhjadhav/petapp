import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { AppConfig } from '../config/app-config.service';
import { MAINTENANCE_QUEUE, MEDIA_QUEUE, NOTIFY_QUEUE, TRUST_QUEUE, type ModeratableTarget, type NotifyEvent, type ProcessMediaJob, type TrustJob } from './queues';
import { redisTls } from '../prisma/pg-connection';

/** Producer side. Jobs are retried with backoff; finished jobs are trimmed to keep Redis small. */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly connection: IORedis;
  readonly media: Queue<ProcessMediaJob>;
  readonly maintenance: Queue;
  readonly notifications: Queue<NotifyEvent>;
  readonly trust: Queue<TrustJob>;
  private readonly logger = new Logger(QueueService.name);

  constructor(config: AppConfig) {
    this.connection = new IORedis(config.get('REDIS_URL'), { maxRetriesPerRequest: null, ...redisTls(config.get('REDIS_CA_CERT')) });
    const defaults = { removeOnComplete: { count: 1000 }, removeOnFail: { count: 5000 } };
    this.media = new Queue(MEDIA_QUEUE, {
      connection: this.connection,
      defaultJobOptions: { ...defaults, attempts: 3, backoff: { type: 'exponential', delay: 10_000 } },
    });
    this.maintenance = new Queue(MAINTENANCE_QUEUE, { connection: this.connection, defaultJobOptions: defaults });
    this.notifications = new Queue(NOTIFY_QUEUE, {
      connection: this.connection,
      defaultJobOptions: { ...defaults, attempts: 3, backoff: { type: 'exponential', delay: 5_000 } },
    });
    this.trust = new Queue(TRUST_QUEUE, {
      connection: this.connection,
      defaultJobOptions: { ...defaults, attempts: 4, backoff: { type: 'exponential', delay: 15_000 } },
    });
  }

  /**
   * Check content with AI moderation (fire-and-forget). Waits a few seconds so quick edits are checked once:
   * the job id is per target and per 10 seconds.
   */
  assess(targetType: ModeratableTarget, targetId: string): void {
    // Job ids use "-": BullMQ refuses ids containing ":".
    const slot = Math.floor(Date.now() / 10_000);
    this.trust
      .add('assess', { kind: 'assess', targetType, targetId }, { jobId: `assess-${targetType}-${targetId}-${slot}`, delay: 3_000 })
      .catch((e) => this.logger.error(`could not queue AI check for ${targetType} ${targetId}: ${(e as Error).message}`));
  }

  /** Recompute an account's risk score (fire-and-forget; at most once a minute per account). */
  scoreRisk(userId: string): void {
    const slot = Math.floor(Date.now() / 60_000);
    this.trust
      .add('risk', { kind: 'risk', userId }, { jobId: `risk-${userId}-${slot}`, delay: 2_000 })
      .catch((e) => this.logger.error(`could not queue risk score for ${userId}: ${(e as Error).message}`));
  }

  /** Fire-and-forget: a notification problem must never fail the user's action. */
  notify(event: NotifyEvent): void {
    this.notifications.add(event.type, event).catch((e) => this.logger.error(`could not queue ${event.type}: ${(e as Error).message}`));
  }

  /**
   * Fire-and-forget, sent once per job id after a delay: several events within the delay become one notification
   * (new votes on an entry, at most one an hour). Job ids use "-": BullMQ refuses ids containing ":".
   */
  notifyOnce(event: NotifyEvent, jobId: string, delayMs: number): void {
    this.notifications.add(event.type, event, { jobId, delay: delayMs }).catch((e) => this.logger.error(`could not queue ${event.type}: ${(e as Error).message}`));
  }

  /** Job id = media id, so a double "complete" call can't process the same file twice. */
  processMedia(mediaId: string) {
    return this.media.add('process', { mediaId }, { jobId: `media-${mediaId}` });
  }

  /** Build a copy of someone's data (job id = export id, so it runs once; retried twice if it fails). */
  buildExport(exportId: string) {
    return this.maintenance.add('build-export', { exportId }, { jobId: `export-${exportId}`, attempts: 3, backoff: { type: 'exponential', delay: 30_000 } });
  }

  async onModuleDestroy() {
    await Promise.all([this.media.close(), this.maintenance.close(), this.notifications.close(), this.trust.close()]);
    await this.connection.quit().catch(() => undefined);
  }
}
