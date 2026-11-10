import { Injectable, OnModuleInit } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';

/**
 * Prometheus metrics for the API: HTTP traffic, plus gauges read when scraped (queues, database, payments).
 * Scrape GET /metrics with `Authorization: Bearer $METRICS_TOKEN`.
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  readonly registry = new Registry();
  readonly requests = new Counter({ name: 'petapp_http_requests_total', help: 'HTTP requests', labelNames: ['method', 'route', 'status'], registers: [this.registry] });
  readonly duration = new Histogram({
    name: 'petapp_http_request_duration_seconds',
    help: 'HTTP request duration',
    labelNames: ['method', 'route', 'status_class'],
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
  ) {}

  onModuleInit() {
    collectDefaultMetrics({ register: this.registry, prefix: 'petapp_api_' });
    const prisma = this.prisma;
    const queues = this.queues;
    new Gauge({
      name: 'petapp_queue_jobs',
      help: 'Background jobs by queue and state',
      labelNames: ['queue', 'state'],
      registers: [this.registry],
      async collect() {
        for (const q of [queues.media, queues.maintenance, queues.notifications, queues.trust]) {
          const c = await q.getJobCounts('waiting', 'active', 'delayed', 'failed').catch(() => null);
          if (c) for (const [state, n] of Object.entries(c)) this.set({ queue: q.name, state }, n);
        }
      },
    });
    const dbPing = new Gauge({ name: 'petapp_db_ping_seconds', help: 'Time for the database to answer SELECT 1', registers: [this.registry] });
    new Gauge({
      name: 'petapp_db_up',
      help: '1 when the database answers within 2 seconds',
      registers: [this.registry],
      async collect() {
        const t = Date.now();
        const ok = await Promise.race([prisma.$queryRaw`SELECT 1`.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 2000))]).catch(() => false);
        this.set(ok ? 1 : 0);
        dbPing.set((Date.now() - t) / 1000);
      },
    });
    new Gauge({
      name: 'petapp_payments_last_hour',
      help: 'Payments created in the last hour, by status',
      labelNames: ['status'],
      registers: [this.registry],
      async collect() {
        this.reset();
        const rows = await prisma.payment.groupBy({ by: ['status'], where: { createdAt: { gte: new Date(Date.now() - 3_600_000) } }, _count: { _all: true } }).catch(() => []);
        for (const r of rows) this.set({ status: r.status }, r._count._all);
      },
    });
    new Gauge({
      name: 'petapp_payment_webhooks_unprocessed',
      help: 'Payment webhook events received more than 5 minutes ago and not yet processed',
      registers: [this.registry],
      async collect() {
        this.set(await prisma.paymentWebhookEvent.count({ where: { processedAt: null, createdAt: { lt: new Date(Date.now() - 300_000) } } }).catch(() => 0));
      },
    });
    new Gauge({
      name: 'petapp_money_attention',
      help: 'Money that needs staff attention: failed refunds and payouts (last 7 days), refunds owed for over a day',
      labelNames: ['kind'],
      registers: [this.registry],
      async collect() {
        const week = new Date(Date.now() - 7 * 86_400_000);
        const [refundsFailed, payoutsFailed, refundsStuck] = await Promise.all([
          prisma.refund.count({ where: { status: 'FAILED', createdAt: { gte: week } } }),
          prisma.payout.count({ where: { status: 'FAILED', createdAt: { gte: week } } }),
          prisma.refund.count({ where: { status: { in: ['PENDING', 'PROCESSING'] }, createdAt: { lt: new Date(Date.now() - 86_400_000) } } }),
        ]).catch(() => [0, 0, 0]);
        this.set({ kind: 'refunds_failed' }, refundsFailed);
        this.set({ kind: 'payouts_failed' }, payoutsFailed);
        this.set({ kind: 'refunds_overdue' }, refundsStuck);
      },
    });
  }

  /** Express middleware: counts and times every request by its route pattern (never the raw URL, which holds ids). */
  middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      const end = this.duration.startTimer();
      res.on('finish', () => {
        const route = routeOf(req);
        const status = String(res.statusCode);
        this.requests.inc({ method: req.method, route, status });
        end({ method: req.method, route, status_class: `${status[0]}xx` });
      });
      next();
    };
  }
}

/** "/api/v1/posts/:id" for a matched route; "unmatched" otherwise, so random URLs can't explode the label count. */
export function routeOf(req: Request): string {
  const r = (req as Request & { route?: { path?: string } }).route?.path;
  return r ? `${req.baseUrl ?? ''}${r}` : 'unmatched';
}
