import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../../providers/payments/payment.provider';
import { PlatformService } from '../platform/platform.service';
import { FinanceService } from './finance.service';

interface Found {
  kind: string;
  severity: 'ERROR' | 'WARNING';
  reference: string;
  detail: string;
  repaired?: boolean;
}

const PAID = `('CAPTURED','REFUND_PENDING','PARTIALLY_REFUNDED','REFUNDED')`;

/**
 * Checks that our records, the ledger and the payment gateway agree, and repairs what is safe to repair.
 *
 * Repaired automatically (postings are idempotent, so this only fills gaps): business events with no ledger posting.
 * Reported for people: totals that don't add up, refunds that failed or are stuck, and payments the gateway
 * sees differently from us — e.g. a capture whose webhook never arrived (recover it from the dashboard).
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly finance: FinanceService,
    private readonly platform: PlatformService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  async run(trigger: 'SCHEDULE' | 'MANUAL', startedById?: string) {
    const run = await this.prisma.reconciliationRun.create({ data: { trigger, startedById } });
    const found: Found[] = [];
    const summary: Record<string, number> = {};
    try {
      summary.repaired = await this.repairPostings(found);
      await this.checkLedger(found);
      await this.checkRefunds(found);
      summary.gatewayChecked = await this.checkGateway(found);
      // Not raised again: an issue still open, or the same finding that staff already looked at and resolved.
      const known = await this.prisma.reconciliationIssue.findMany({
        where: { OR: [{ resolvedAt: null }, { resolvedById: { not: null } }] },
        select: { kind: true, reference: true, detail: true, resolvedAt: true },
      });
      const open = new Set(known.filter((i) => !i.resolvedAt).map((i) => `${i.kind}|${i.reference}`));
      const handled = new Set(known.filter((i) => i.resolvedAt).map((i) => `${i.kind}|${i.reference}|${i.detail}`));
      const fresh = found.filter((f) => f.repaired || (!open.has(`${f.kind}|${f.reference}`) && !handled.has(`${f.kind}|${f.reference}|${f.detail.slice(0, 1000)}`)));
      const now = new Date();
      if (fresh.length) {
        await this.prisma.reconciliationIssue.createMany({
          data: fresh.map((f) => ({
            runId: run.id, kind: f.kind, severity: f.severity, reference: f.reference, detail: f.detail.slice(0, 1000),
            repaired: !!f.repaired, resolvedAt: f.repaired ? now : null, resolution: f.repaired ? 'Repaired automatically by reconciliation' : null,
          })),
        });
      }
      for (const f of found) summary[f.kind] = (summary[f.kind] ?? 0) + 1;
      summary.newIssues = fresh.filter((f) => !f.repaired).length;
      const problems = found.filter((f) => !f.repaired).length;
      return await this.prisma.reconciliationRun.update({
        where: { id: run.id },
        data: { status: problems ? 'ISSUES' : 'OK', summary: summary as Prisma.InputJsonValue, finishedAt: new Date() },
      });
    } catch (e) {
      this.logger.error(`reconciliation failed: ${(e as Error).stack ?? e}`);
      return this.prisma.reconciliationRun.update({ where: { id: run.id }, data: { status: 'FAILED', error: (e as Error).message.slice(0, 1000), finishedAt: new Date() } });
    }
  }

  /** Business events that should have a posting but don't. Returns how many were posted. */
  private async repairPostings(found: Found[]): Promise<number> {
    let n = 0;
    const missing = async (sql: Prisma.Sql) => this.prisma.$queryRaw<Array<{ id: string }>>(sql);
    const fix = async (reference: string, what: string, post: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      await this.prisma.$transaction(async (tx) => post(tx));
      found.push({ kind: 'MISSING_POSTING', severity: 'WARNING', reference, detail: `${what} had no ledger posting; it was posted now.`, repaired: true });
      n++;
    };
    const P = Prisma;

    for (const { id } of await missing(P.sql`
      SELECT p.id FROM "Payment" p LEFT JOIN "LedgerTransaction" t ON t.reference = 'capture:Payment:' || p.id::text
      WHERE p.status::text IN ${P.raw(PAID)} AND t.id IS NULL LIMIT 1000`)) {
      const p = await this.prisma.payment.findUniqueOrThrow({ where: { id } });
      await fix(`Payment:${id}`, 'A captured payment', (tx) => this.finance.capture(tx, p));
    }
    for (const { id } of await missing(P.sql`
      SELECT s.id FROM "SubOrder" s LEFT JOIN "LedgerTransaction" t ON t.reference = 'earn:SubOrder:' || s.id::text
      WHERE s."deliveredAt" IS NOT NULL AND t.id IS NULL LIMIT 1000`)) {
      await fix(`SubOrder:${id}`, 'A delivered parcel', (tx) => this.finance.parcelDelivered(tx, id));
    }
    for (const { id } of await missing(P.sql`
      SELECT s.id FROM "SubOrder" s LEFT JOIN "LedgerTransaction" t ON t.reference = 'earn-reversal:SubOrder:' || s.id::text
      WHERE s.status = 'RETURNED' AND t.id IS NULL LIMIT 1000`)) {
      const r = await this.prisma.returnRequest.findFirst({ where: { subOrderId: id, status: 'RECEIVED' } });
      if (r) await fix(`SubOrder:${id}`, 'A returned parcel', (tx) => this.finance.parcelReturned(tx, id, r.refundPaise));
    }
    for (const { id } of await missing(P.sql`
      SELECT b.id FROM "Booking" b JOIN "Payment" p ON p.id = b."paymentId"
      LEFT JOIN "LedgerTransaction" t ON t.reference = 'earn:Booking:' || b.id::text
      WHERE t.id IS NULL AND p.status::text IN ${P.raw(PAID)}
        AND (b.status IN ('COMPLETED','NO_SHOW') OR (b.status = 'CANCELLED' AND b."refundPaise" < b."pricePaise")) LIMIT 1000`)) {
      const posted = await this.prisma.$transaction((tx) => this.finance.bookingEarned(tx, id));
      if (posted) {
        found.push({ kind: 'MISSING_POSTING', severity: 'WARNING', reference: `Booking:${id}`, detail: 'A booking’s earnings had no ledger posting; it was posted now.', repaired: true });
        n++;
      }
    }
    for (const { id } of await missing(P.sql`
      SELECT r.id FROM "Refund" r LEFT JOIN "LedgerTransaction" t ON t.reference = 'refund-owed:Refund:' || r.id::text
      WHERE t.id IS NULL LIMIT 1000`)) {
      const r = await this.prisma.refund.findUniqueOrThrow({ where: { id } });
      await fix(`Refund:${id}`, 'A refund owed', (tx) => this.finance.refundOwed(tx, r));
    }
    for (const { id } of await missing(P.sql`
      SELECT r.id FROM "Refund" r LEFT JOIN "LedgerTransaction" t ON t.reference = 'refund-paid:Refund:' || r.id::text
      WHERE r.status = 'PROCESSED' AND t.id IS NULL LIMIT 1000`)) {
      const r = await this.prisma.refund.findUniqueOrThrow({ where: { id } });
      await fix(`Refund:${id}`, 'A completed refund', (tx) => this.finance.refundPaid(tx, r));
    }
    return n;
  }

  /**
   * The ledger balances, and its control accounts match the records they summarise. Read in one
   * repeatable-read snapshot, so payments and refunds arriving during the check can't cause false alarms.
   */
  private async checkLedger(found: Found[]) {
    await this.prisma.$transaction(
      async (tx) => {
        const unbalanced = await tx.$queryRaw<Array<{ reference: string; dr: bigint; cr: bigint }>>`
          SELECT t.reference, SUM(e."debitPaise") AS dr, SUM(e."creditPaise") AS cr
          FROM "LedgerTransaction" t JOIN "LedgerEntry" e ON e."transactionId" = t.id
          GROUP BY t.id HAVING SUM(e."debitPaise") <> SUM(e."creditPaise") LIMIT 100`;
        for (const u of unbalanced) found.push({ kind: 'UNBALANCED', severity: 'ERROR', reference: u.reference, detail: `Debits ${u.dr} ≠ credits ${u.cr}.` });

        const [totals] = await tx.$queryRaw<Array<{ captured: bigint; refunded: bigint; unpaid: bigint; settled: bigint; transit: bigint }>>`
          SELECT
            (SELECT COALESCE(SUM("amountPaise"), 0) FROM "Payment" WHERE status::text IN ('CAPTURED','REFUND_PENDING','PARTIALLY_REFUNDED','REFUNDED'))::bigint AS captured,
            (SELECT COALESCE(SUM("amountPaise"), 0) FROM "Refund" WHERE status = 'PROCESSED')::bigint AS refunded,
            (SELECT COALESCE(SUM("amountPaise"), 0) FROM "Refund" WHERE status::text NOT IN ('PROCESSED','SETTLED_MANUALLY'))::bigint AS unpaid,
            (SELECT COALESCE(SUM("amountPaise" + "feesPaise"), 0) FROM "GatewaySettlement")::bigint AS settled,
            (SELECT COALESCE(SUM("amountPaise"), 0) FROM "Payout" WHERE status::text IN ('QUEUED','PROCESSING'))::bigint AS transit`;
        const balances = await tx.$queryRaw<Array<{ code: string; dr: bigint; cr: bigint }>>`
          SELECT a.code, COALESCE(SUM(e."debitPaise"), 0)::bigint AS dr, COALESCE(SUM(e."creditPaise"), 0)::bigint AS cr
          FROM "LedgerAccount" a LEFT JOIN "LedgerEntry" e ON e."accountId" = a.id
          WHERE a.code IN ('GATEWAY_CLEARING', 'REFUNDS_DUE', 'CUSTOMER_FUNDS', 'PAYOUTS_IN_TRANSIT') GROUP BY a.code`;
        const bal = (code: string, debitNormal: boolean) => {
          const b = balances.find((x) => x.code === code);
          return b ? Number(debitNormal ? b.dr - b.cr : b.cr - b.dr) : 0;
        };
        const rupees = (p: number) => `₹${(p / 100).toFixed(2)}`;
        // The gateway holds everything captured, minus refunds it sent and what it settled to the bank (with its fees).
        const gateway = bal('GATEWAY_CLEARING', true);
        const expected = Number(totals.captured - totals.refunded - totals.settled);
        if (gateway !== expected) {
          found.push({ kind: 'CONTROL_MISMATCH', severity: 'ERROR', reference: 'Account:GATEWAY_CLEARING', detail: `Ledger says the gateway holds ${rupees(gateway)}; payments minus refunds and settlements say ${rupees(expected)}.` });
        }
        const transit = bal('PAYOUTS_IN_TRANSIT', false);
        if (transit !== Number(totals.transit)) {
          found.push({ kind: 'CONTROL_MISMATCH', severity: 'ERROR', reference: 'Account:PAYOUTS_IN_TRANSIT', detail: `Ledger says ${rupees(transit)} of payouts are in transit; payout records say ${rupees(Number(totals.transit))}.` });
        }
        const due = bal('REFUNDS_DUE', false);
        if (due !== Number(totals.unpaid)) {
          found.push({ kind: 'CONTROL_MISMATCH', severity: 'ERROR', reference: 'Account:REFUNDS_DUE', detail: `Ledger says ${rupees(due)} of refunds are owed; refund records say ${rupees(Number(totals.unpaid))}.` });
        }
        const held = bal('CUSTOMER_FUNDS', false);
        if (held < 0) found.push({ kind: 'CONTROL_MISMATCH', severity: 'ERROR', reference: 'Account:CUSTOMER_FUNDS', detail: `Customer funds are negative (${rupees(held)}): more was earned or refunded than was paid.` });

        const over = await tx.$queryRaw<Array<{ id: string; amount: number; owed: bigint }>>`
          SELECT p.id, p."amountPaise" AS amount, SUM(r."amountPaise") AS owed FROM "Payment" p JOIN "Refund" r ON r."paymentId" = p.id
          GROUP BY p.id HAVING SUM(r."amountPaise") > p."amountPaise" LIMIT 100`;
        for (const o of over) found.push({ kind: 'OVER_REFUNDED', severity: 'ERROR', reference: `Payment:${o.id}`, detail: `Refunds of ${rupees(Number(o.owed))} on a payment of ${rupees(o.amount)}.` });

        const mismatched = await tx.$queryRaw<Array<{ id: string; amount: number; posted: bigint }>>`
          SELECT p.id, p."amountPaise" AS amount, SUM(e."debitPaise") AS posted
          FROM "Payment" p JOIN "LedgerTransaction" t ON t.reference = 'capture:Payment:' || p.id::text JOIN "LedgerEntry" e ON e."transactionId" = t.id
          GROUP BY p.id HAVING SUM(e."debitPaise") <> p."amountPaise" LIMIT 100`;
        for (const m of mismatched) found.push({ kind: 'AMOUNT_MISMATCH', severity: 'ERROR', reference: `Payment:${m.id}`, detail: `Payment of ${rupees(m.amount)} was posted as ${rupees(Number(m.posted))}.` });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60_000 },
    );
  }

  private async checkRefunds(found: Found[]) {
    const failed = await this.prisma.refund.findMany({ where: { status: 'FAILED' }, take: 500 });
    for (const r of failed) found.push({ kind: 'REFUND_FAILED', severity: 'ERROR', reference: `Refund:${r.id}`, detail: `₹${(r.amountPaise / 100).toFixed(2)} couldn’t be refunded after ${r.attempts} attempt(s): ${r.lastError ?? 'no detail'}. Retry it, or refund the customer another way and record why.` });
    const stuck = await this.prisma.refund.findMany({ where: { status: { in: ['PENDING', 'PROCESSING'] }, createdAt: { lt: new Date(Date.now() - 3 * 86_400_000) } }, take: 500 });
    for (const r of stuck) found.push({ kind: 'REFUND_STUCK', severity: 'WARNING', reference: `Refund:${r.id}`, detail: `₹${(r.amountPaise / 100).toFixed(2)} owed since ${r.createdAt.toISOString().slice(0, 10)} is still ${r.status.toLowerCase()}${r.lastError ? `: ${r.lastError}` : ''}.` });
  }

  /** Asks the gateway about recent payments: captures we never heard about, or captures it doesn't know. */
  private async checkGateway(found: Found[]): Promise<number> {
    const days = await this.platform.getSetting<number>('finance.reconcileLookbackDays');
    const since = new Date(Date.now() - days * 86_400_000);
    const recent = await this.prisma.payment.findMany({
      where: { createdAt: { gte: since, lt: new Date(Date.now() - 30 * 60_000) }, provider: this.provider.name },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    let checked = 0;
    for (const p of recent) {
      let attempts;
      try {
        attempts = await this.provider.orderPayments(p.providerOrderId);
      } catch (e) {
        found.push({ kind: 'GATEWAY_UNREACHABLE', severity: 'WARNING', reference: `Payment:${p.id}`, detail: `Couldn’t ask the gateway: ${(e as Error).message}` });
        break; // don't hammer an unavailable gateway
      }
      // The development gateway only remembers payments made in the same process.
      if (this.provider.name === 'fake' && !attempts.length) continue;
      checked++;
      const captured = attempts.filter((a) => a.status === 'captured' || a.status === 'refunded');
      const extra = captured.filter((a) => a.paymentId !== p.providerPaymentId);
      if ((p.status === 'CREATED' || p.status === 'FAILED') && captured.length) {
        const right = captured.find((a) => a.amountPaise === p.amountPaise);
        found.push(right
          ? { kind: 'MISSED_CAPTURE', severity: 'ERROR', reference: `Payment:${p.id}`, detail: `The gateway captured ₹${(right.amountPaise / 100).toFixed(2)} (${right.paymentId}) but we never recorded it. Recover the payment from the dashboard.` }
          : { kind: 'GATEWAY_AMOUNT_MISMATCH', severity: 'ERROR', reference: `Payment:${p.id}`, detail: `The gateway captured ₹${(captured[0].amountPaise / 100).toFixed(2)} (${captured[0].paymentId}) on an order of ₹${(p.amountPaise / 100).toFixed(2)}. It can’t be recovered automatically: refund it from the gateway dashboard.` });
      } else if (extra.length && p.providerPaymentId) {
        found.push({ kind: 'DUPLICATE_CAPTURE', severity: 'ERROR', reference: `Payment:${p.id}`, detail: `The customer was charged more than once on this order (${extra.map((a) => `${a.paymentId} ₹${(a.amountPaise / 100).toFixed(2)}`).join(', ')}). Refund the extra charge from the gateway dashboard.` });
      } else if (['CAPTURED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(p.status)) {
        const ours = attempts.find((a) => a.paymentId === p.providerPaymentId);
        if (!ours || (ours.status !== 'captured' && ours.status !== 'refunded')) {
          found.push({ kind: 'GATEWAY_STATUS', severity: 'ERROR', reference: `Payment:${p.id}`, detail: `We recorded a capture (${p.providerPaymentId}) that the gateway shows as ${ours?.status ?? 'missing'}.` });
        } else if (ours.amountPaise !== p.amountPaise) {
          found.push({ kind: 'AMOUNT_MISMATCH', severity: 'ERROR', reference: `Payment:${p.id}`, detail: `The gateway captured ₹${(ours.amountPaise / 100).toFixed(2)}; we recorded ₹${(p.amountPaise / 100).toFixed(2)}.` });
        } else {
          const processed = await this.prisma.refund.aggregate({ where: { paymentId: p.id, status: 'PROCESSED' }, _sum: { amountPaise: true } });
          if (ours.amountRefundedPaise !== (processed._sum.amountPaise ?? 0)) {
            found.push({ kind: 'GATEWAY_STATUS', severity: 'WARNING', reference: `Payment:${p.id}`, detail: `The gateway has refunded ₹${(ours.amountRefundedPaise / 100).toFixed(2)}; our completed refunds total ₹${((processed._sum.amountPaise ?? 0) / 100).toFixed(2)}.` });
          }
        }
      }
    }
    return checked;
  }
}
