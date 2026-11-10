import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FakePaymentProvider, PAYMENT_PROVIDER, type PaymentProvider } from '../../providers/payments/payment.provider';
import type { Payment, Prisma } from '../../generated/prisma/client';
import { QueueService } from '../../queue/queue.service';
import { FinanceService } from '../finance/finance.service';
import { RefundExecutor } from '../finance/refund-executor.service';

type Tx = Prisma.TransactionClient;

/** Settles what a payment paid for. 'refund' means it can no longer be honoured. */
export type Settler = (tx: Tx, payment: Payment) => Promise<'ok' | 'refund'>;

/**
 * Payment records and the rules that make them trustworthy:
 * a payment counts only when the server verifies it (checkout signature or signed webhook),
 * every capture is idempotent, and the amount is re-checked.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly settlers = new Map<string, Settler>();

  /** Modules register how to settle their own purposes (avoids circular dependencies). */
  registerSettler(purpose: string, fn: Settler) {
    this.settlers.set(purpose, fn);
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly queue: QueueService,
    private readonly finance: FinanceService,
    private readonly refunds: RefundExecutor,
  ) {}

  get providerName() {
    return this.provider.name;
  }

  /** Creates the gateway order and our record. Call inside the registration transaction. */
  async createOrder(tx: Tx, userId: string, purpose: string, referenceId: string, amountPaise: number, notes: Record<string, string>): Promise<Payment> {
    const { orderId } = await this.provider.createOrder(amountPaise, 'INR', `${purpose.toLowerCase()}:${referenceId.slice(0, 20)}`, notes);
    return tx.payment.create({ data: { userId, purpose, referenceId, amountPaise, provider: this.provider.name, providerOrderId: orderId } });
  }

  /** What the app needs to open the gateway's checkout. */
  checkoutParams(p: Payment) {
    return { paymentId: p.id, provider: p.provider, orderId: p.providerOrderId, amountPaise: p.amountPaise, currency: p.currency, key: this.provider.publicKey, status: p.status };
  }

  /** The app's checkout callback. The signature, not the app's word, proves payment. */
  async verifyCheckout(userId: string, paymentId: string, providerPaymentId: string, signature: string) {
    const p = await this.prisma.payment.findFirst({ where: { id: paymentId, userId } });
    if (!p) throw new NotFoundException('Payment not found.');
    if (p.status === 'CAPTURED') return this.checkoutParams(p);
    if (!this.provider.verifyCheckout(p.providerOrderId, providerPaymentId, signature)) {
      await this.audit.log({ actorId: userId, action: 'payment.signature_invalid', entityType: 'Payment', entityId: p.id });
      throw new BadRequestException('We couldn’t confirm this payment. If money was deducted, it will be refunded automatically.');
    }
    return this.checkoutParams(await this.capture(p, providerPaymentId, 'checkout'));
  }

  /** Signed, idempotent webhook handler. Returns what happened, for logs and tests. */
  async handleWebhook(raw: Buffer | undefined, headers: Record<string, string | string[] | undefined>) {
    if (!raw) throw new BadRequestException('Missing body.');
    const event = this.provider.parseWebhook(raw, headers);
    if (!event) {
      this.logger.warn('rejected a webhook with an invalid signature');
      throw new BadRequestException('Invalid signature.');
    }
    try {
      await this.prisma.paymentWebhookEvent.create({
        data: { provider: this.provider.name, eventId: event.eventId, type: event.kind, payload: JSON.parse(raw.toString('utf8')) as Prisma.InputJsonValue },
      });
    } catch (e) {
      if ((e as { code?: string }).code !== 'P2002') throw e;
      // Seen before. If it was handled, it's a duplicate; if handling failed last time, handle it again
      // (everything below is idempotent), so a gateway retry isn't lost.
      const seen = await this.prisma.paymentWebhookEvent.findUnique({ where: { provider_eventId: { provider: this.provider.name, eventId: event.eventId } } });
      if (seen?.processedAt) return { status: 'duplicate' as const };
    }
    let status: string = event.kind;
    if (event.kind === 'refund_processed' || event.kind === 'refund_failed') {
      status = `${event.kind}:${await this.refunds.fromWebhook(event.refundId, event.paymentId, event.kind === 'refund_processed' ? 'processed' : 'failed')}`;
    } else if (event.kind !== 'ignored') {
      const p = await this.prisma.payment.findUnique({ where: { providerOrderId: event.orderId } });
      if (!p) {
        status = 'unknown_order';
      } else if (event.kind === 'captured') {
        if (event.amountPaise !== p.amountPaise) {
          await this.prisma.payment.updateMany({ where: { id: p.id, status: 'CREATED' }, data: { status: 'FAILED', failureReason: `amount mismatch: expected ${p.amountPaise}, got ${event.amountPaise}` } });
          await this.audit.log({ actorId: null, action: 'payment.amount_mismatch', entityType: 'Payment', entityId: p.id, after: { expected: p.amountPaise, got: event.amountPaise } });
          status = 'amount_mismatch';
        } else {
          await this.capture(p, event.paymentId, 'webhook');
        }
      } else {
        await this.prisma.payment.updateMany({ where: { id: p.id, status: 'CREATED' }, data: { status: 'FAILED', failureReason: event.reason.slice(0, 300), providerPaymentId: event.paymentId } });
      }
    }
    await this.prisma.paymentWebhookEvent.update({ where: { provider_eventId: { provider: this.provider.name, eventId: event.eventId } }, data: { processedAt: new Date() } });
    return { status };
  }

  /** Development only: completes a fake checkout the way a real one would. */
  async simulate(userId: string, paymentId: string) {
    if (!(this.provider instanceof FakePaymentProvider)) throw new NotFoundException();
    const p = await this.prisma.payment.findFirst({ where: { id: paymentId, userId } });
    if (!p) throw new NotFoundException('Payment not found.');
    const { paymentId: pid, signature } = FakePaymentProvider.checkout(p.providerOrderId, p.amountPaise);
    return this.verifyCheckout(userId, paymentId, pid, signature);
  }

  /**
   * Finance staff: a capture the gateway made but we never heard about (reconciliation reports these).
   * The gateway is asked directly — an authenticated server-to-server call — then the payment completes as usual.
   */
  async recover(actorId: string, paymentId: string) {
    const p = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!p) throw new NotFoundException('Payment not found.');
    if (p.status === 'CREATED' || p.status === 'FAILED') {
      const attempts = await this.provider.orderPayments(p.providerOrderId);
      const paid = attempts.find((a) => (a.status === 'captured' || a.status === 'refunded') && a.amountPaise === p.amountPaise);
      if (!paid) throw new BadRequestException('The payment gateway shows no completed payment of this amount for this order.');
      await this.audit.log({ actorId, action: 'payment.recovered', entityType: 'Payment', entityId: p.id, after: { providerPaymentId: paid.paymentId } });
      await this.capture(p, paid.paymentId, 'reconciliation');
    }
    await this.prisma.reconciliationIssue.updateMany({
      where: { reference: `Payment:${p.id}`, kind: 'MISSED_CAPTURE', resolvedAt: null },
      data: { resolvedAt: new Date(), resolvedById: actorId, resolution: 'Payment recovered from the gateway' },
    });
    return this.checkoutParams(await this.prisma.payment.findUniqueOrThrow({ where: { id: p.id } }));
  }

  /** CREATED → CAPTURED exactly once, then settles what was paid for. */
  private async capture(p: Payment, providerPaymentId: string, via: 'checkout' | 'webhook' | 'reconciliation'): Promise<Payment> {
    return this.prisma.$transaction(async (tx) => {
      const capturedAt = new Date();
      const { count } = await tx.payment.updateMany({
        where: { id: p.id, status: { in: ['CREATED', 'FAILED'] } },
        data: { status: 'CAPTURED', providerPaymentId, capturedAt, failureReason: null },
      });
      if (count) {
        await this.finance.capture(tx, { ...p, capturedAt });
        // Contest and challenge entries are settled here. An entry that is no longer waiting for payment
        // (withdrawn, or the contest was cancelled meanwhile) can't be honoured: the money goes back.
        let unhonoured = false;
        if (p.purpose === 'CONTEST_REGISTRATION' || p.purpose === 'CHALLENGE_JOIN') {
          // Lock the contest or challenge: a cancellation running now either finishes first (and we see it
          // cancelled) or waits for this capture (and then finds the payment to refund).
          const parent = p.purpose === 'CONTEST_REGISTRATION'
            ? await tx.$queryRaw<Array<{ status: string }>>`SELECT status::text AS status FROM "Contest" WHERE id = ${p.referenceId}::uuid FOR SHARE`
            : await tx.$queryRaw<Array<{ status: string }>>`SELECT status::text AS status FROM "Challenge" WHERE id = ${p.referenceId}::uuid FOR SHARE`;
          // Cancelled, or already finished (its fees were booked as revenue): the late entry can't be honoured.
          if (!parent.length || ['CANCELLED', 'COMPLETED', 'ENDED'].includes(parent[0].status)) unhonoured = true;
        }
        if (p.purpose === 'CONTEST_REGISTRATION' && !unhonoured) {
          const n = await tx.contestParticipant.updateMany({ where: { paymentId: p.id, status: 'PENDING_PAYMENT' }, data: { status: 'REGISTERED', registeredAt: new Date() } });
          const entry = await tx.contestParticipant.findUnique({ where: { paymentId: p.id }, select: { id: true } });
          if (n.count && entry) this.queue.notify({ type: 'CONTEST_ENTRY_CONFIRMED', participantId: entry.id });
          unhonoured = n.count === 0;
        }
        if (p.purpose === 'CHALLENGE_JOIN' && !unhonoured) {
          const n = await tx.challengeParticipant.updateMany({ where: { paymentId: p.id, status: 'PENDING_PAYMENT' }, data: { status: 'ACTIVE', joinedAt: new Date() } });
          unhonoured = n.count === 0;
        }
        const settler = this.settlers.get(p.purpose);
        if (unhonoured || (settler && (await settler(tx, p)) === 'refund')) {
          await tx.payment.update({ where: { id: p.id }, data: { failureReason: 'Could not be honoured after payment; refund owed' } });
          await this.finance.oweRefund(tx, { paymentId: p.id, amountPaise: p.amountPaise, reason: 'PAYMENT_UNHONOURED', reference: `Payment:${p.id}` });
        }
        await this.audit.log({ actorId: p.userId, action: 'payment.captured', entityType: 'Payment', entityId: p.id, after: { amountPaise: p.amountPaise, via, purpose: p.purpose } }, tx);
      }
      return tx.payment.findUniqueOrThrow({ where: { id: p.id } });
    });
  }
}
