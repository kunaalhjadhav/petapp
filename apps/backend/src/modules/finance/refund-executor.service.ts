import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GatewayError, PAYMENT_PROVIDER, type GatewayRefund, type PaymentProvider } from '../../providers/payments/payment.provider';
import { QueueService } from '../../queue/queue.service';
import { AuditService } from '../audit/audit.service';
import { PlatformService } from '../platform/platform.service';
import { FinanceService } from './finance.service';
import { isReceiptFor, refundBackoffMs, refundReceipt } from './finance.rules';

export type AttemptResult = 'processed' | 'pending' | 'retrying' | 'failed' | 'skipped';

/**
 * Sends owed refunds to the payment gateway and follows them to completion.
 *
 * - A refund is claimed (PENDING → PROCESSING) by one worker at a time.
 * - Each attempt has its own receipt and idempotency key (refund id + attempt number). Before a new attempt, every
 *   earlier attempt is looked up at the gateway: one that is pending or went through is followed instead, so a
 *   timeout and a retry can never refund twice, while one the gateway failed can be tried again.
 * - Errors back off exponentially; refusals and exhausted attempts end FAILED for finance staff, who can retry it
 *   or record that they paid it another way.
 * - Completion arrives by the create response, a webhook, or polling — whichever comes first; applying it is idempotent.
 */
@Injectable()
export class RefundExecutor {
  private readonly logger = new Logger(RefundExecutor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly finance: FinanceService,
    private readonly platform: PlatformService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  /** One sweep: due refunds are attempted, and refunds the gateway is still working on are checked. */
  async sweep(limit = 50) {
    const now = new Date();
    const due = await this.prisma.refund.findMany({
      where: { status: 'PENDING', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    const counts: Record<AttemptResult, number> = { processed: 0, pending: 0, retrying: 0, failed: 0, skipped: 0 };
    for (const r of due) counts[await this.attempt(r.id)]++;
    // Still in progress at the gateway after 10 minutes (or interrupted mid-call): ask the gateway.
    const stale = await this.prisma.refund.findMany({
      where: { status: 'PROCESSING', updatedAt: { lt: new Date(now.getTime() - 10 * 60_000) } },
      take: limit,
      select: { id: true },
    });
    for (const r of stale) counts[await this.check(r.id)]++;
    if (due.length || stale.length) this.logger.log(`refunds: ${JSON.stringify(counts)}`);
    return counts;
  }

  /** Earlier attempts at this refund that the gateway accepted (pending or done), newest first. */
  private async earlier(gatewayPaymentId: string, refundId: string) {
    return (await this.provider.listRefunds(gatewayPaymentId)).filter((g) => isReceiptFor(g.receipt, refundId) && g.status !== 'failed').reverse();
  }

  /** Attempts one refund if it's due. */
  async attempt(id: string): Promise<AttemptResult> {
    const now = new Date();
    const claimed = await this.prisma.refund.updateMany({
      where: { id, status: 'PENDING', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
      data: { status: 'PROCESSING', attempts: { increment: 1 }, lastError: null, providerRefundId: null },
    });
    if (!claimed.count) return 'skipped';
    const r = await this.prisma.refund.findUniqueOrThrow({ where: { id }, include: { payment: { select: { providerPaymentId: true } } } });
    const gatewayPaymentId = r.payment.providerPaymentId;
    if (!gatewayPaymentId) return this.fail(id, r.attempts, r.retries, new GatewayError('the payment has no gateway payment id', false));
    try {
      const [prior] = await this.earlier(gatewayPaymentId, r.id);
      const g = prior ?? (await this.provider.refund(gatewayPaymentId, r.amountPaise, refundReceipt(r.id, r.attempts), { refundId: r.id, reference: r.reference, reason: r.reason }));
      return await this.apply(id, g);
    } catch (e) {
      return this.fail(id, r.attempts, r.retries, e);
    }
  }

  /** Asks the gateway about a refund that's been in progress for a while. */
  async check(id: string): Promise<AttemptResult> {
    const r = await this.prisma.refund.findUnique({ where: { id }, include: { payment: { select: { providerPaymentId: true } } } });
    if (!r || r.status !== 'PROCESSING' || !r.payment.providerPaymentId) return 'skipped';
    try {
      const all = (await this.provider.listRefunds(r.payment.providerPaymentId)).filter((x) => isReceiptFor(x.receipt, r.id));
      const g = (r.providerRefundId ? all.find((x) => x.refundId === r.providerRefundId) : undefined) ?? all.filter((x) => x.status !== 'failed').pop();
      if (g) return await this.apply(id, g);
      if (!r.providerRefundId) {
        // The gateway never got it (we were interrupted before the call finished): it's due again.
        await this.prisma.refund.updateMany({ where: { id, status: 'PROCESSING', providerRefundId: null }, data: { status: 'PENDING', nextAttemptAt: new Date() } });
        return 'retrying';
      }
      await this.prisma.refund.updateMany({ where: { id, status: 'PROCESSING' }, data: { updatedAt: new Date() } });
      return 'pending';
    } catch (e) {
      this.logger.warn(`refund ${id}: status check failed: ${(e as Error).message}`);
      return 'pending';
    }
  }

  /** What the gateway says about one attempt (create response, webhook or poll). Idempotent. */
  async apply(id: string, g: Pick<GatewayRefund, 'refundId' | 'status'>): Promise<AttemptResult> {
    if (g.status === 'pending') {
      const n = await this.prisma.refund.updateMany({ where: { id, status: 'PROCESSING', OR: [{ providerRefundId: null }, { providerRefundId: g.refundId }] }, data: { providerRefundId: g.refundId } });
      return n.count ? 'pending' : 'skipped';
    }
    if (g.status === 'failed') {
      // Only the attempt in flight can fail the refund: a stale report about an older attempt changes nothing.
      const r = await this.prisma.refund.findFirst({ where: { id, status: 'PROCESSING', OR: [{ providerRefundId: null }, { providerRefundId: g.refundId }] } });
      if (!r) return 'skipped';
      return this.fail(id, r.attempts, r.retries, new GatewayError(`the gateway reported refund ${g.refundId} as failed`, true));
    }
    const done = await this.prisma.$transaction(async (tx) => {
      const processedAt = new Date();
      const n = await tx.refund.updateMany({
        where: { id, status: { in: ['PENDING', 'PROCESSING', 'FAILED'] } },
        data: { status: 'PROCESSED', processedAt, providerRefundId: g.refundId, lastError: null, nextAttemptAt: null },
      });
      if (!n.count) return false;
      const r = await tx.refund.findUniqueOrThrow({ where: { id } });
      await this.finance.refundPaid(tx, r);
      await this.audit.log({ actorId: null, action: 'refund.processed', entityType: 'Refund', entityId: id, after: { amountPaise: r.amountPaise, providerRefundId: g.refundId } }, tx);
      return true;
    });
    if (!done) return 'skipped';
    this.queue.notify({ type: 'REFUND_PROCESSED', refundId: id });
    return 'processed';
  }

  /** A webhook about a refund. Matched by the gateway's refund id, or — if it beat us to storing that id — by asking the gateway. */
  async fromWebhook(providerRefundId: string, gatewayPaymentId: string, status: 'processed' | 'failed'): Promise<string> {
    const r = await this.prisma.refund.findUnique({ where: { providerRefundId } });
    if (r) return this.apply(r.id, { refundId: providerRefundId, status });
    const inFlight = await this.prisma.refund.findMany({ where: { status: 'PROCESSING', payment: { providerPaymentId: gatewayPaymentId } }, select: { id: true } });
    for (const x of inFlight) await this.check(x.id);
    return inFlight.length ? 'checked' : 'unknown_refund';
  }

  private async fail(id: string, attempts: number, retries: number, e: unknown): Promise<AttemptResult> {
    const retryable = e instanceof GatewayError ? e.retryable : true;
    const message = (e as Error).message?.slice(0, 500) ?? String(e);
    const max = await this.platform.getSetting<number>('finance.refundMaxAttempts');
    // Each staff retry allows another full round of attempts.
    if (!retryable || attempts >= max * (retries + 1)) {
      await this.prisma.refund.updateMany({ where: { id, status: 'PROCESSING' }, data: { status: 'FAILED', lastError: message, nextAttemptAt: null } });
      await this.audit.log({ actorId: null, action: 'refund.failed', entityType: 'Refund', entityId: id, after: { attempts, error: message } });
      this.logger.error(`refund ${id} failed after ${attempts} attempt(s): ${message}`);
      return 'failed';
    }
    const base = await this.platform.getSetting<number>('finance.refundRetryBaseMinutes');
    const inRound = attempts - max * retries;
    await this.prisma.refund.updateMany({
      where: { id, status: 'PROCESSING' },
      data: { status: 'PENDING', lastError: message, nextAttemptAt: new Date(Date.now() + refundBackoffMs(inRound, base)) },
    });
    this.logger.warn(`refund ${id}: attempt ${attempts} failed, will retry: ${message}`);
    return 'retrying';
  }

  /** Finance staff: send a FAILED refund back to the queue for another round of attempts. */
  async retry(actorId: string, id: string) {
    const n = await this.prisma.refund.updateMany({ where: { id, status: 'FAILED' }, data: { status: 'PENDING', retries: { increment: 1 }, nextAttemptAt: null } });
    if (n.count) await this.audit.log({ actorId, action: 'refund.retry', entityType: 'Refund', entityId: id });
    return n.count > 0;
  }

  /**
   * Finance staff: the customer was paid back outside the gateway (e.g. a bank transfer). Allowed only for a
   * FAILED refund — one that isn't in flight at the gateway — and recorded with the transfer's reference.
   */
  async settleManually(actorId: string, id: string, reference: string) {
    const ok = await this.prisma.$transaction(async (tx) => {
      const n = await tx.refund.updateMany({ where: { id, status: 'FAILED' }, data: { status: 'SETTLED_MANUALLY', manualReference: reference, settledById: actorId, processedAt: new Date(), nextAttemptAt: null } });
      if (!n.count) return false;
      const r = await tx.refund.findUniqueOrThrow({ where: { id } });
      await this.finance.refundSettledManually(tx, r);
      await this.audit.log({ actorId, action: 'refund.settled_manually', entityType: 'Refund', entityId: id, after: { amountPaise: r.amountPaise, reference } }, tx);
      return true;
    });
    if (!ok) throw new NotFoundException('Only a failed refund can be recorded as paid another way.');
    await this.prisma.reconciliationIssue.updateMany({
      where: { reference: `Refund:${id}`, kind: 'REFUND_FAILED', resolvedAt: null },
      data: { resolvedAt: new Date(), resolvedById: actorId, resolution: `Paid outside the gateway: ${reference}` },
    });
    this.queue.notify({ type: 'REFUND_PROCESSED', refundId: id });
    return this.prisma.refund.findUniqueOrThrow({ where: { id } });
  }
}
