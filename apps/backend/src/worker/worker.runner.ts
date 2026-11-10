import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { WorkerMetrics } from './worker-metrics';
import { ERROR_TRACKER, type ErrorTracker } from '../observability/error-tracker';
import { QueueService } from '../queue/queue.service';
import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { AppConfig } from '../config/app-config.service';
import { MAINTENANCE_QUEUE, MEDIA_QUEUE, NOTIFY_QUEUE, TRUST_QUEUE, type BuildExportJob, type MaintenanceJobName, type NotifyEvent, type ProcessMediaJob, type TrustJob } from '../queue/queues';
import { AiModerationService } from '../modules/trust/ai-moderation.service';
import { RiskService } from '../modules/trust/risk.service';
import { MediaProcessor } from './media.processor';
import { MaintenanceProcessor } from './maintenance.processor';
import { InterestService } from '../modules/recommendations/interest.service';
import { AssistantRetention } from '../modules/assistant/assistant-retention';
import { DataExportService } from '../modules/privacy/data-export.service';
import { AccountEraser } from '../modules/privacy/account-eraser';
import { NotificationProcessor } from './notification.processor';
import { RefundExecutor } from '../modules/finance/refund-executor.service';
import { ReconciliationService } from '../modules/finance/reconciliation.service';
import { PayoutsService } from '../modules/finance/payouts.service';
import { PayoutAccountsService } from '../modules/finance/payout-accounts.service';
import { SettlementsService } from '../modules/finance/settlements.service';
import { SupportAutoClose } from '../modules/chat/support-autoclose';
import { ReminderSweeper } from '../modules/reminders/reminder-sweeper';
import { PromotionSender } from '../modules/reminders/promotion.sender';
import { redisTls } from '../prisma/pg-connection';

@Injectable()
export class WorkerRunner implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Worker');
  private readonly connection: IORedis;
  private workers: Worker[] = [];
  private scheduler?: Queue;
  private metrics?: WorkerMetrics;

  constructor(
    private readonly config: AppConfig,
    private readonly media: MediaProcessor,
    private readonly maintenance: MaintenanceProcessor,
    private readonly interest: InterestService,
    private readonly assistantRetention: AssistantRetention,
    private readonly dataExports: DataExportService,
    private readonly eraser: AccountEraser,
    private readonly notifications: NotificationProcessor,
    private readonly refunds: RefundExecutor,
    private readonly reconciliation: ReconciliationService,
    private readonly payouts: PayoutsService,
    private readonly payoutAccounts: PayoutAccountsService,
    private readonly settlements: SettlementsService,
    private readonly aiModeration: AiModerationService,
    private readonly risk: RiskService,
    private readonly supportAutoClose: SupportAutoClose,
    private readonly reminders: ReminderSweeper,
    private readonly promotions: PromotionSender,
    private readonly queues: QueueService,
    @Inject(ERROR_TRACKER) private readonly tracker: ErrorTracker,
  ) {
    this.connection = new IORedis(config.get('REDIS_URL'), { maxRetriesPerRequest: null, ...redisTls(config.get('REDIS_CA_CERT')) });
  }

  async onApplicationBootstrap() {
    const concurrency = Number(process.env.MEDIA_CONCURRENCY ?? 2);
    this.workers.push(
      new Worker<ProcessMediaJob>(
        MEDIA_QUEUE,
        (job) => this.media.process(job.data.mediaId, job.attemptsMade + 1 >= (job.opts.attempts ?? 1)),
        { connection: this.connection, concurrency },
      ),
      new Worker(
        MAINTENANCE_QUEUE,
        async (job: Job) => {
          const name = job.name as MaintenanceJobName;
          if (name === 'recompute-scores') return this.maintenance.recomputeScores();
          if (name === 'cleanup-stale-uploads') return this.maintenance.cleanupStaleUploads();
          if (name === 'process-refunds') return this.refunds.sweep();
          if (name === 'process-payouts') return { accounts: await this.payoutAccounts.sweepPending(), payouts: await this.payouts.sweep() };
          if (name === 'sync-settlements') return this.settlements.sync();
          if (name === 'reconcile') return (await this.reconciliation.run('SCHEDULE')).status;
          if (name === 'recompute-risk') return this.risk.sweep();
          if (name === 'purge-interest') return this.interest.purge();
          if (name === 'purge-assistant') return this.assistantRetention.purge();
          if (name === 'build-export') return this.dataExports.build((job.data as BuildExportJob).exportId, job.attemptsMade + 1 >= (job.opts.attempts ?? 1));
          if (name === 'purge-exports') return this.dataExports.purgeExpired();
          if (name === 'purge-deleted-accounts') return this.eraser.sweep();
          if (name === 'close-resolved-tickets') return this.supportAutoClose.sweep();
          if (name === 'send-reminders') return this.reminders.sweep();
          if (name === 'expire-memberships') return this.reminders.expireMemberships();
          if (name === 'send-promotions') return this.promotions.sendDue();
        },
        { connection: this.connection, concurrency: 2 },
      ),
    );
    this.workers.push(
      new Worker<NotifyEvent>(NOTIFY_QUEUE, (job) => this.notifications.handle(job.data, String(job.id)), {
        connection: this.connection,
        concurrency: Number(process.env.NOTIFY_CONCURRENCY ?? 5),
      }),
    );
    // Trust & safety: AI checks are rate-limited by the provider, so few at a time; a failed check is retried with backoff.
    this.workers.push(
      new Worker<TrustJob>(
        TRUST_QUEUE,
        async (job) => {
          const d = job.data;
          if (d.kind === 'assess') return this.aiModeration.assess(d.targetType, d.targetId, { lastAttempt: job.attemptsMade + 1 >= (job.opts.attempts ?? 1) });
          return (await this.risk.score(d.userId))?.level ?? 'gone';
        },
        { connection: this.connection, concurrency: Number(process.env.TRUST_CONCURRENCY ?? 3) },
      ),
    );
    this.metrics = new WorkerMetrics(() => [this.queues.media, this.queues.maintenance, this.queues.notifications, this.queues.trust], this.tracker);
    for (const w of this.workers) this.metrics.watch(w);
    this.metrics.listen(this.config.get('WORKER_METRICS_PORT'), this.config.get('METRICS_TOKEN'), ['production', 'staging'].includes(this.config.get('NODE_ENV')));

    // Repeatable jobs (idempotent: same scheduler id → one schedule).
    this.scheduler = new Queue(MAINTENANCE_QUEUE, { connection: this.connection });
    await this.scheduler.upsertJobScheduler('recompute-scores', { every: 10 * 60_000 }, { name: 'recompute-scores' });
    await this.scheduler.upsertJobScheduler('cleanup-stale-uploads', { pattern: '15 3 * * *', tz: 'Asia/Kolkata' }, { name: 'cleanup-stale-uploads' });
    // Money: owed refunds go to the gateway every 30 seconds; everything is reconciled nightly.
    await this.scheduler.upsertJobScheduler('process-refunds', { every: 30_000 }, { name: 'process-refunds' });
    await this.scheduler.upsertJobScheduler('process-payouts', { every: 30_000 }, { name: 'process-payouts' });
    // Settlements are booked before the nightly reconciliation checks the gateway balance.
    await this.scheduler.upsertJobScheduler('sync-settlements', { pattern: '0 2 * * *', tz: 'Asia/Kolkata' }, { name: 'sync-settlements' });
    await this.scheduler.upsertJobScheduler('reconcile', { pattern: '30 2 * * *', tz: 'Asia/Kolkata' }, { name: 'reconcile' });
    // Account risk for everyone active in the last two days (votes and AI flags also rescore straight away).
    await this.scheduler.upsertJobScheduler('recompute-risk', { pattern: '45 3 * * *', tz: 'Asia/Kolkata' }, { name: 'recompute-risk' });
    // Privacy: viewing history and assistant chats past their retention period.
    await this.scheduler.upsertJobScheduler('purge-interest', { pattern: '30 4 * * *', tz: 'Asia/Kolkata' }, { name: 'purge-interest' });
    await this.scheduler.upsertJobScheduler('purge-assistant', { pattern: '40 4 * * *', tz: 'Asia/Kolkata' }, { name: 'purge-assistant' });
    // Expired data downloads, then accounts whose deletion grace period has ended.
    await this.scheduler.upsertJobScheduler('purge-exports', { pattern: '50 4 * * *', tz: 'Asia/Kolkata' }, { name: 'purge-exports' });
    await this.scheduler.upsertJobScheduler('purge-deleted-accounts', { pattern: '0 5 * * *', tz: 'Asia/Kolkata' }, { name: 'purge-deleted-accounts' });
    // Support: resolved tickets nobody answered for a week are closed.
    await this.scheduler.upsertJobScheduler('close-resolved-tickets', { pattern: '20 5 * * *', tz: 'Asia/Kolkata' }, { name: 'close-resolved-tickets' });
    // Reminders (spec §36): every 15 minutes; promotions that are due, every minute; memberships that ended, hourly.
    await this.scheduler.upsertJobScheduler('send-reminders', { every: 15 * 60_000 }, { name: 'send-reminders' });
    await this.scheduler.upsertJobScheduler('send-promotions', { every: 60_000 }, { name: 'send-promotions' });
    await this.scheduler.upsertJobScheduler('expire-memberships', { pattern: '5 * * * *', tz: 'Asia/Kolkata' }, { name: 'expire-memberships' });
    this.logger.log(`worker started (media concurrency ${concurrency})`);
  }

  async onApplicationShutdown() {
    await Promise.all(this.workers.map((w) => w.close()));
    await this.scheduler?.close();
    await this.metrics?.close();
    await this.connection.quit().catch(() => undefined);
  }
}
