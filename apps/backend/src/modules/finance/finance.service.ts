import { ConflictException, Injectable } from '@nestjs/common';
import type { Payment, Prisma, Refund } from '../../generated/prisma/client';
import { PlatformService } from '../platform/platform.service';
import { LedgerService } from './ledger.service';
import { gstWithin, paymentStatusAfterRefunds, prizeTds, splitEarning, type EarningSplit, type PayeeType } from './finance.rules';

type Tx = Prisma.TransactionClient;

const PURPOSE_LABEL: Record<string, string> = {
  PRODUCT_ORDER: 'Shop order',
  SERVICE_BOOKING: 'Service booking',
  CONTEST_REGISTRATION: 'Contest entry',
  CHALLENGE_JOIN: 'Challenge entry',
  MEMBERSHIP: 'Membership',
};

export interface OweRefund {
  paymentId: string | null;
  amountPaise: number;
  /** SUB_ORDER_CANCELLED | RETURN | ORDER_UNFULFILLABLE | BOOKING_CANCELLED | CONTEST_CANCELLED | CHALLENGE_CANCELLED | PAYMENT_UNHONOURED */
  reason: string;
  /** What it refunds, unique: "SubOrder:<id>", "Booking:<id>", "Payment:<id>" … */
  reference: string;
}

/**
 * Turns business events into ledger postings, and records refunds owed.
 * Every method takes the caller's database transaction, so money moves exactly when the business change commits.
 * Every posting is idempotent (keyed by a reference), so calling twice — or a reconciliation repair — is safe.
 */
@Injectable()
export class FinanceService {
  constructor(
    private readonly ledger: LedgerService,
    private readonly platform: PlatformService,
  ) {}

  private cache?: { at: number; value: Awaited<ReturnType<FinanceService['loadRates']>> };

  /**
   * Fee and tax rates, cached for 30 seconds. Postings run inside the caller's transaction; reading settings there
   * would need a second database connection per posting, which starves the pool under load.
   */
  private async rates() {
    if (!this.cache || Date.now() - this.cache.at > 30_000) this.cache = { at: Date.now(), value: await this.loadRates() };
    return this.cache.value;
  }

  private async loadRates() {
    const [gstOnFeesBps, tcsBps, tdsBps, tdsNoPanBps, servicesGstRateBps, gstOnEntryFeesBps, prizeTdsBps, prizeTdsThresholdPaise] = await Promise.all([
      this.platform.getSetting<number>('finance.gstOnFeesBps'),
      this.platform.getSetting<number>('finance.tcsBps'),
      this.platform.getSetting<number>('finance.tdsBps'),
      this.platform.getSetting<number>('finance.tdsNoPanBps'),
      this.platform.getSetting<number>('finance.servicesGstRateBps'),
      this.platform.getSetting<number>('finance.gstOnEntryFeesBps'),
      this.platform.getSetting<number>('finance.prizeTdsBps'),
      this.platform.getSetting<number>('finance.prizeTdsThresholdPaise'),
    ]);
    return { gstOnFeesBps, tcsBps, tdsBps, tdsNoPanBps, servicesGstRateBps, gstOnEntryFeesBps, prizeTdsBps, prizeTdsThresholdPaise };
  }

  /** Customer money arrives at the gateway; it's held for them until earned or refunded. */
  capture(tx: Tx, p: Pick<Payment, 'id' | 'amountPaise' | 'purpose' | 'capturedAt'>) {
    return this.ledger.post(tx, {
      kind: 'PAYMENT_CAPTURED',
      reference: `capture:Payment:${p.id}`,
      memo: `${PURPOSE_LABEL[p.purpose] ?? p.purpose} paid`,
      sourceType: 'Payment',
      sourceId: p.id,
      occurredAt: p.capturedAt ?? undefined,
      lines: [
        { account: 'GATEWAY_CLEARING', debit: p.amountPaise },
        { account: 'CUSTOMER_FUNDS', credit: p.amountPaise },
      ],
    });
  }

  /**
   * Records a refund owed, once per reference. Refunds on a payment can never add up to more than was paid:
   * the payment row is locked while checking, so two cancellations at once can't both slip through.
   */
  async oweRefund(tx: Tx, r: OweRefund): Promise<Refund | null> {
    if (!r.paymentId || r.amountPaise <= 0) return null;
    const [payment] = await tx.$queryRaw<Array<{ amountPaise: number; status: string }>>`
      SELECT "amountPaise", status::text AS status FROM "Payment" WHERE id = ${r.paymentId}::uuid FOR UPDATE`;
    // Checked after taking the lock, so two requests owing the same refund at once get the same row.
    const existing = await tx.refund.findUnique({ where: { reference: r.reference } });
    if (existing) return existing;
    if (!payment || !['CAPTURED', 'PARTIALLY_REFUNDED', 'REFUND_PENDING', 'REFUNDED'].includes(payment.status)) return null; // nothing was paid
    const owed = await tx.refund.aggregate({ where: { paymentId: r.paymentId }, _sum: { amountPaise: true } });
    const already = owed._sum.amountPaise ?? 0;
    if (already + r.amountPaise > payment.amountPaise) {
      throw new ConflictException(`Refunds on this payment would exceed what was paid (₹${(payment.amountPaise / 100).toFixed(2)}).`);
    }
    const refund = await tx.refund.create({ data: { paymentId: r.paymentId, amountPaise: r.amountPaise, reason: r.reason, reference: r.reference } });
    await this.refundOwed(tx, refund);
    await this.syncPaymentStatus(tx, r.paymentId);
    return refund;
  }

  /** The customer's held money is now owed back to them. */
  refundOwed(tx: Tx, refund: Pick<Refund, 'id' | 'amountPaise' | 'reason' | 'createdAt'>) {
    return this.ledger.post(tx, {
      kind: 'REFUND_OWED',
      reference: `refund-owed:Refund:${refund.id}`,
      memo: `Refund owed (${refund.reason.toLowerCase().replace(/_/g, ' ')})`,
      sourceType: 'Refund',
      sourceId: refund.id,
      occurredAt: refund.createdAt,
      lines: [
        { account: 'CUSTOMER_FUNDS', debit: refund.amountPaise },
        { account: 'REFUNDS_DUE', credit: refund.amountPaise },
      ],
    });
  }

  /** The gateway confirmed the money went back. */
  async refundPaid(tx: Tx, refund: Pick<Refund, 'id' | 'amountPaise' | 'paymentId' | 'processedAt'>) {
    await this.ledger.post(tx, {
      kind: 'REFUND_PAID',
      reference: `refund-paid:Refund:${refund.id}`,
      memo: 'Refund sent to the customer',
      sourceType: 'Refund',
      sourceId: refund.id,
      occurredAt: refund.processedAt ?? undefined,
      lines: [
        { account: 'REFUNDS_DUE', debit: refund.amountPaise },
        { account: 'GATEWAY_CLEARING', credit: refund.amountPaise },
      ],
    });
    await this.syncPaymentStatus(tx, refund.paymentId);
  }

  /** The customer was paid back outside the gateway: the debt is settled from PetApp's bank, not the gateway. */
  async refundSettledManually(tx: Tx, refund: Pick<Refund, 'id' | 'amountPaise' | 'paymentId' | 'processedAt' | 'manualReference'>) {
    await this.ledger.post(tx, {
      kind: 'REFUND_PAID_MANUALLY',
      reference: `refund-paid:Refund:${refund.id}`,
      memo: `Refund paid outside the gateway (${refund.manualReference ?? 'no reference'})`,
      sourceType: 'Refund',
      sourceId: refund.id,
      occurredAt: refund.processedAt ?? undefined,
      lines: [
        { account: 'REFUNDS_DUE', debit: refund.amountPaise },
        { account: 'BANK', credit: refund.amountPaise },
      ],
    });
    await this.syncPaymentStatus(tx, refund.paymentId);
  }

  /** CAPTURED → REFUND_PENDING / PARTIALLY_REFUNDED / REFUNDED, from the refunds on the payment. */
  async syncPaymentStatus(tx: Tx, paymentId: string) {
    // Locked: two refunds completing at once must not each see only their own.
    const [p] = await tx.$queryRaw<Array<{ amountPaise: number; status: string }>>`
      SELECT "amountPaise", status::text AS status FROM "Payment" WHERE id = ${paymentId}::uuid FOR UPDATE`;
    if (!p || !['CAPTURED', 'PARTIALLY_REFUNDED', 'REFUND_PENDING', 'REFUNDED'].includes(p.status)) return;
    const [owed, processed] = await Promise.all([
      tx.refund.aggregate({ where: { paymentId }, _sum: { amountPaise: true } }),
      tx.refund.aggregate({ where: { paymentId, status: { in: ['PROCESSED', 'SETTLED_MANUALLY'] } }, _sum: { amountPaise: true } }),
    ]);
    const status = paymentStatusAfterRefunds(p.amountPaise, owed._sum.amountPaise ?? 0, processed._sum.amountPaise ?? 0);
    if (status !== p.status) await tx.payment.update({ where: { id: paymentId }, data: { status: status as Payment['status'] } });
  }

  private earningLines(payee: { type: PayeeType; id: string; name: string }, customerPaise: number, platformDiscountPaise: number, s: EarningSplit) {
    return [
      { account: 'CUSTOMER_FUNDS' as const, debit: customerPaise },
      { account: 'PLATFORM_DISCOUNTS' as const, debit: platformDiscountPaise },
      { account: 'FEE_REVENUE' as const, credit: s.feeRevenuePaise },
      { account: 'GST_PAYABLE' as const, credit: s.feeGstPaise },
      { account: 'TCS_PAYABLE' as const, credit: s.tcsPaise },
      { account: 'TDS_PAYABLE' as const, credit: s.tdsPaise },
      { account: { payee: payee.type, id: payee.id, name: payee.name }, credit: s.payeeNetPaise },
    ];
  }

  /** What a delivered parcel earns the seller, after PetApp's commission (with its GST), TCS and TDS. */
  async parcelSplit(tx: Tx, subOrderId: string) {
    const s = await tx.subOrder.findUniqueOrThrow({ where: { id: subOrderId }, include: { items: { select: { gstPaise: true } }, vendor: { select: { id: true, businessName: true, gstin: true, pan: true } } } });
    const r = await this.rates();
    const platformDiscountPaise = s.vendorEarningPaise + s.commissionPaise - s.totalPaise;
    if (platformDiscountPaise < 0) throw new Error(`SubOrder ${s.id}: earning + commission is less than the total`);
    const taxableBasePaise = Math.max(0, s.itemsPaise - s.discountPaise - s.items.reduce((a, i) => a + i.gstPaise, 0));
    const split = splitEarning({
      customerPaise: s.totalPaise,
      platformDiscountPaise,
      feePaise: s.commissionPaise,
      taxableBasePaise,
      gstOnFeesBps: r.gstOnFeesBps,
      tcsBps: s.vendor.gstin ? r.tcsBps : 0,
      tdsBps: s.vendor.pan ? r.tdsBps : r.tdsNoPanBps,
    });
    return { s, split, platformDiscountPaise, taxableBasePaise };
  }

  /** A parcel was delivered: the customer's money becomes the seller's (minus fee and taxes) and PetApp's fee. */
  async parcelDelivered(tx: Tx, subOrderId: string) {
    const { s, split, platformDiscountPaise } = await this.parcelSplit(tx, subOrderId);
    return this.ledger.post(tx, {
      kind: 'PARCEL_DELIVERED',
      reference: `earn:SubOrder:${s.id}`,
      memo: `Parcel ${s.code} delivered`,
      sourceType: 'SubOrder',
      sourceId: s.id,
      occurredAt: s.deliveredAt ?? undefined,
      lines: this.earningLines({ type: 'VENDOR', id: s.vendor.id, name: s.vendor.businessName }, s.totalPaise, platformDiscountPaise, split),
    });
  }

  /**
   * A returned parcel came back. The delivery posting is reversed in full; what the customer isn't refunded
   * (the shipping charge) stays with the seller, who shipped the parcel. The refund itself is owed separately.
   */
  async parcelReturned(tx: Tx, subOrderId: string, refundPaise: number) {
    await this.parcelDelivered(tx, subOrderId); // makes sure there is something to reverse (idempotent)
    const s = await tx.subOrder.findUniqueOrThrow({ where: { id: subOrderId }, include: { vendor: { select: { id: true, businessName: true } } } });
    const kept = s.totalPaise - refundPaise;
    if (kept < 0) throw new Error(`SubOrder ${s.id}: return refund is more than the parcel total`);
    return this.ledger.reverse(tx, `earn:SubOrder:${s.id}`, {
      kind: 'PARCEL_RETURNED',
      reference: `earn-reversal:SubOrder:${s.id}`,
      memo: `Parcel ${s.code} returned${kept ? `; seller keeps the ₹${(kept / 100).toFixed(2)} shipping charge` : ''}`,
      sourceType: 'SubOrder',
      sourceId: s.id,
      extraLines: [
        { account: 'CUSTOMER_FUNDS', debit: kept },
        { account: { payee: 'VENDOR', id: s.vendor.id, name: s.vendor.businessName }, credit: kept },
      ],
    });
  }

  /**
   * What a booking earns the partner: a completed visit or a no-show (the full price), or what a late
   * cancellation keeps (price − refund). The fee rate is the one fixed when the booking was made.
   */
  async bookingSplit(tx: Tx, bookingId: string) {
    const b = await tx.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { partner: { select: { id: true, businessName: true, gstin: true, pan: true } }, payment: { select: { status: true } } },
    });
    const paid = b.payment && b.payment.status !== 'CREATED' && b.payment.status !== 'FAILED';
    let grossPaise = 0;
    let feePaise = 0;
    let what = '';
    if (paid && (b.status === 'COMPLETED' || b.status === 'NO_SHOW')) {
      grossPaise = b.pricePaise;
      feePaise = b.platformFeePaise;
      what = b.status === 'COMPLETED' ? 'Visit completed' : 'No-show: the booking is charged';
    } else if (paid && b.status === 'CANCELLED' && b.refundPaise !== null && b.refundPaise < b.pricePaise) {
      grossPaise = b.pricePaise - b.refundPaise;
      feePaise = Math.round((grossPaise * b.commissionBps) / 10_000);
      what = 'Late cancellation: the partner keeps part of the price';
    }
    if (!grossPaise) return null;
    const r = await this.rates();
    const taxableBasePaise = b.partner.gstin ? grossPaise - gstWithin(grossPaise, r.servicesGstRateBps) : grossPaise;
    const split = splitEarning({
      customerPaise: grossPaise,
      platformDiscountPaise: 0,
      feePaise,
      taxableBasePaise,
      gstOnFeesBps: r.gstOnFeesBps,
      tcsBps: b.partner.gstin ? r.tcsBps : 0,
      tdsBps: b.partner.pan ? r.tdsBps : r.tdsNoPanBps,
    });
    return { b, grossPaise, split, what, taxableBasePaise };
  }

  async bookingEarned(tx: Tx, bookingId: string) {
    const x = await this.bookingSplit(tx, bookingId);
    if (!x) return false;
    return this.ledger.post(tx, {
      kind: 'BOOKING_EARNED',
      reference: `earn:Booking:${x.b.id}`,
      memo: `${x.what} (${x.b.code})`,
      sourceType: 'Booking',
      sourceId: x.b.id,
      occurredAt: x.b.completedAt ?? undefined,
      lines: this.earningLines({ type: 'PARTNER', id: x.b.partner.id, name: x.b.partner.businessName }, x.grossPaise, 0, x.split),
    });
  }

  // ══════════════ contests and challenges ══════════════

  /**
   * A contest completed (or a challenge ended): the entry fees still held for it become PetApp's revenue, with the
   * GST inside them split out. Refunded entries were already taken out of the held money. Once per contest.
   */
  async entryFeesEarned(tx: Tx, purpose: 'CONTEST_REGISTRATION' | 'CHALLENGE_JOIN', referenceId: string, title: string) {
    const [row] = await tx.$queryRaw<Array<{ paid: bigint; owed: bigint }>>`
      SELECT COALESCE(SUM(p."amountPaise"), 0)::bigint AS paid,
             COALESCE((SELECT SUM(r."amountPaise") FROM "Refund" r JOIN "Payment" q ON q.id = r."paymentId"
                       WHERE q.purpose = ${purpose} AND q."referenceId" = ${referenceId}::uuid), 0)::bigint AS owed
      FROM "Payment" p
      WHERE p.purpose = ${purpose} AND p."referenceId" = ${referenceId}::uuid
        AND p.status::text IN ('CAPTURED', 'PARTIALLY_REFUNDED', 'REFUND_PENDING', 'REFUNDED')`;
    const held = Number(row.paid - row.owed);
    if (held <= 0) return false;
    const gst = gstWithin(held, (await this.rates()).gstOnEntryFeesBps);
    const kind = purpose === 'CONTEST_REGISTRATION' ? 'Contest' : 'Challenge';
    return this.ledger.post(tx, {
      kind: 'ENTRY_FEES_EARNED',
      reference: `entry-fees:${kind}:${referenceId}`,
      memo: `Entry fees for ${title}`,
      sourceType: kind,
      sourceId: referenceId,
      lines: [
        { account: 'CUSTOMER_FUNDS', debit: held },
        { account: 'ENTRY_FEE_REVENUE', credit: held - gst },
        { account: 'GST_PAYABLE', credit: gst },
      ],
    });
  }

  /**
   * A membership period was paid for and started: the fee is PetApp's revenue at once (memberships aren't refundable
   * once started; an unhonoured payment is refunded instead, without this posting). GST at the fees rate.
   */
  async membershipEarned(tx: Tx, p: Pick<Payment, 'id' | 'amountPaise'>, planName: string) {
    const gst = gstWithin(p.amountPaise, (await this.rates()).gstOnFeesBps);
    return this.ledger.post(tx, {
      kind: 'MEMBERSHIP_EARNED',
      reference: `membership:Payment:${p.id}`,
      memo: `${planName} membership`,
      sourceType: 'Payment',
      sourceId: p.id,
      lines: [
        { account: 'CUSTOMER_FUNDS', debit: p.amountPaise },
        { account: 'MEMBERSHIP_REVENUE', credit: p.amountPaise - gst },
        { account: 'GST_PAYABLE', credit: gst },
      ],
    });
  }

  /**
   * Finance approves a cash prize: it becomes owed to the winner, less income-tax TDS on winnings when the prize is
   * above the threshold. Once per prize.
   */
  async prizeApproved(tx: Tx, prize: { id: string; amountPaise: number; title: string }, winner: { userId: string; name: string }, contestTitle: string) {
    const r = await this.rates();
    const tds = prizeTds(prize.amountPaise, r.prizeTdsBps, r.prizeTdsThresholdPaise);
    await this.ledger.post(tx, {
      kind: 'PRIZE_APPROVED',
      reference: `prize:ContestPrize:${prize.id}`,
      memo: `${prize.title} — ${contestTitle}`,
      sourceType: 'ContestPrize',
      sourceId: prize.id,
      lines: [
        { account: 'PRIZE_EXPENSE', debit: prize.amountPaise },
        { account: 'TDS_PAYABLE', credit: tds },
        { account: { payee: 'USER', id: winner.userId, name: winner.name }, credit: prize.amountPaise - tds },
      ],
    });
    return { grossPaise: prize.amountPaise, tdsPaise: tds, netPaise: prize.amountPaise - tds };
  }
}

