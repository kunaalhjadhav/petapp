import { Logger } from '@nestjs/common';
import { createServer, type Server } from 'http';
import { timingSafeEqual } from 'crypto';
import type { Job, Queue, Worker } from 'bullmq';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import type { ErrorTracker } from '../observability/error-tracker';

/**
 * The worker's metrics (jobs done, failed and how long they took, queue depths) and a tiny HTTP server for
 * GET /health and GET /metrics on WORKER_METRICS_PORT. The worker has no other HTTP endpoints.
 */
export class WorkerMetrics {
  readonly registry = new Registry();
  private readonly done = new Counter({ name: 'petapp_jobs_completed_total', help: 'Background jobs completed', labelNames: ['queue', 'job'], registers: [this.registry] });
  private readonly failed = new Counter({ name: 'petapp_jobs_failed_total', help: 'Background job attempts that failed (final = no retries left)', labelNames: ['queue', 'job', 'final'], registers: [this.registry] });
  private readonly seconds = new Histogram({ name: 'petapp_job_duration_seconds', help: 'Background job run time', labelNames: ['queue'], buckets: [0.05, 0.1, 0.5, 1, 5, 15, 60, 300], registers: [this.registry] });
  private server?: Server;
  private readonly logger = new Logger('WorkerMetrics');

  constructor(
    queues: () => Queue[],
    private readonly tracker: ErrorTracker,
  ) {
    collectDefaultMetrics({ register: this.registry, prefix: 'petapp_worker_' });
    new Gauge({
      name: 'petapp_queue_jobs',
      help: 'Background jobs by queue and state',
      labelNames: ['queue', 'state'],
      registers: [this.registry],
      async collect() {
        for (const q of queues()) {
          const c = await q.getJobCounts('waiting', 'active', 'delayed', 'failed').catch(() => null);
          if (c) for (const [state, n] of Object.entries(c)) this.set({ queue: q.name, state }, n);
        }
      },
    });
  }

  /** Counts every job a worker finishes; reports a job's final failure to error tracking. */
  watch(w: Worker) {
    const name = (job?: Job) => (job?.name && job.name !== '__default__' ? job.name : 'job');
    w.on('completed', (job) => {
      this.done.inc({ queue: w.name, job: name(job) });
      if (job.processedOn && job.finishedOn) this.seconds.observe({ queue: w.name }, (job.finishedOn - job.processedOn) / 1000);
    });
    w.on('failed', (job, err) => {
      const final = !job || job.attemptsMade >= (job.opts.attempts ?? 1);
      this.failed.inc({ queue: w.name, job: name(job), final: String(final) });
      this.logger.warn({ message: `${w.name} job failed: ${err.message}`, queue: w.name, job: name(job), jobId: job?.id, attempt: job?.attemptsMade, final });
      if (final) this.tracker.capture(err, { tags: { queue: w.name, job: name(job) }, context: { jobId: job?.id, attempts: job?.attemptsMade } });
    });
  }

  listen(port: number, token: string | undefined, live: boolean) {
    const expected = token ? Buffer.from(`Bearer ${token}`) : null;
    this.server = createServer(async (req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) }));
        return;
      }
      if (req.url === '/metrics') {
        const got = Buffer.from(req.headers.authorization ?? '');
        if ((!expected && live) || (expected && (got.length !== expected.length || !timingSafeEqual(got, expected)))) {
          res.writeHead(expected ? 403 : 404).end();
          return;
        }
        res.writeHead(200, { 'content-type': this.registry.contentType }).end(await this.registry.metrics());
        return;
      }
      res.writeHead(404).end();
    });
    this.server.listen(port, '0.0.0.0', () => this.logger.log(`worker health and metrics on :${port}`));
    this.server.on('error', (e) => this.logger.error(`metrics server: ${e.message}`));
  }

  close() {
    return new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
  }
}
