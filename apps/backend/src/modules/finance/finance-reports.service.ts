import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { Paged } from '../../common/dto/pagination.dto';
import { FinanceService } from './finance.service';
import { LedgerService } from './ledger.service';
import { SYSTEM_ACCOUNTS, payeeAccount, type PayeeType } from './finance.rules';
import type { AccountsQuery, EntriesQuery, IssuesQuery, PeriodQuery, RefundsQuery, StatementQuery, TaxReportQuery } from './finance.dto';

const IST = 330 * 60_000;
/** Midnight India time at the start of a YYYY-MM-DD day (or month). */
const istStart = (ymd: string) => new Date(Date.parse(`${ymd}T00:00:00Z`) - IST);

/** What staff and payees can see of the ledger. Read-only. */
@Injectable()
export class FinanceReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly finance: FinanceService,
  ) {}

  /** A window of India-time days: default the last 30 days including today. */
  private period(q: PeriodQuery) {
    const today = new Date(Date.now() + IST).toISOString().slice(0, 10);
    const to = q.to ?? today;
    const from = q.from ?? new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
    if (from > to) throw new BadRequestException('The start date must be on or before the end date.');
    return { from, to, start: istStart(from), end: new Date(istStart(to).getTime() + 86_400_000) };
  }

  /** Money in a period by account (net, in each account's normal direction). */
  private async flows(start: Date, end: Date) {
    const rows = await this.prisma.$queryRaw<Array<{ code: string; dr: bigint; cr: bigint }>>`
      SELECT a.code, SUM(e."debitPaise") AS dr, SUM(e."creditPaise") AS cr
      FROM "LedgerEntry" e JOIN "LedgerAccount" a ON a.id = e."accountId" JOIN "LedgerTransaction" t ON t.id = e."transactionId"
      WHERE t."occurredAt" >= ${start} AND t."occurredAt" < ${end}
      GROUP BY a.code`;
    const by = new Map(rows.map((r) => [r.code, { dr: Number(r.dr), cr: Number(r.cr) }]));
    const cr = (c: string) => (by.get(c)?.cr ?? 0) - (by.get(c)?.dr ?? 0);
    const payees = rows.filter((r) => r.code.startsWith('VENDOR:') || r.code.startsWith('PARTNER:')).reduce((a, r) => a + Number(r.cr) - Number(r.dr), 0);
    const kinds = await this.prisma.$queryRaw<Array<{ kind: string; n: bigint; amount: bigint }>>`
      SELECT t.kind, COUNT(DISTINCT t.id) AS n, SUM(e."debitPaise") AS amount
      FROM "LedgerTransaction" t JOIN "LedgerEntry" e ON e."transactionId" = t.id
      WHERE t."occurredAt" >= ${start} AND t."occurredAt" < ${end} GROUP BY t.kind`;
    const kind = (k: string) => kinds.find((x) => x.kind === k);
    return {
      collectedPaise: Number(kind('PAYMENT_CAPTURED')?.amount ?? 0),
      payments: Number(kind('PAYMENT_CAPTURED')?.n ?? 0),
      refundsOwedPaise: Number(kind('REFUND_OWED')?.amount ?? 0),
      refundsPaidPaise: Number(kind('REFUND_PAID')?.amount ?? 0),
      feeRevenuePaise: cr('FEE_REVENUE'),
      gstOnFeesPaise: cr('GST_PAYABLE'),
      tcsPaise: cr('TCS_PAYABLE'),
      tdsPaise: cr('TDS_PAYABLE'),
      platformDiscountsPaise: -cr('PLATFORM_DISCOUNTS'),
      earnedByPayeesPaise: payees,
    };
  }

  /** The finance home: where the money is now, what happened in the period, and what needs attention. */
  async overview(q: PeriodQuery) {
    const p = this.period(q);
    const balances = await this.ledger.balances();
    const system = Object.fromEntries(Object.keys(SYSTEM_ACCOUNTS).map((c) => [c, balances.find((b) => b.code === c)?.balancePaise ?? 0]));
    const payees = balances.filter((b) => b.ownerType);
    const [refunds, lastRun, openIssues] = await Promise.all([
      this.prisma.$queryRaw<Array<{ status: string; n: bigint; amount: bigint }>>`
        SELECT status::text AS status, COUNT(*) AS n, COALESCE(SUM("amountPaise"), 0)::bigint AS amount FROM "Refund" GROUP BY status`,
      this.prisma.reconciliationRun.findFirst({ orderBy: { startedAt: 'desc' } }),
      this.prisma.reconciliationIssue.groupBy({ by: ['severity'], where: { resolvedAt: null }, _count: { _all: true } }),
    ]);
    return {
      period: { from: p.from, to: p.to },
      now: {
        heldByGatewayPaise: system.GATEWAY_CLEARING,
        customerFundsPaise: system.CUSTOMER_FUNDS,
        refundsDuePaise: system.REFUNDS_DUE,
        owedToSellersPaise: payees.filter((b) => b.ownerType === 'VENDOR').reduce((a, b) => a + b.balancePaise, 0),
        owedToPartnersPaise: payees.filter((b) => b.ownerType === 'PARTNER').reduce((a, b) => a + b.balancePaise, 0),
        gstPayablePaise: system.GST_PAYABLE,
        tcsPayablePaise: system.TCS_PAYABLE,
        tdsPayablePaise: system.TDS_PAYABLE,
      },
      flows: await this.flows(p.start, p.end),
      refunds: Object.fromEntries(refunds.map((r) => [r.status, { count: Number(r.n), amountPaise: Number(r.amount) }])),
      reconciliation: {
        lastRun: lastRun && { id: lastRun.id, status: lastRun.status, startedAt: lastRun.startedAt, finishedAt: lastRun.finishedAt },
        openIssues: Object.fromEntries(openIssues.map((i) => [i.severity, i._count._all])),
      },
    };
  }

  /** Every account with its debits, credits and balance; total debits always equal total credits. */
  async trialBalance(asOf?: string) {
    const until = asOf ? new Date(istStart(asOf).getTime() + 86_400_000) : undefined;
    const accounts = await this.ledger.balances(undefined, until);
    const debitPaise = accounts.reduce((a, b) => a + b.debitPaise, 0);
    const creditPaise = accounts.reduce((a, b) => a + b.creditPaise, 0);
    return { asOf: asOf ?? null, accounts, totals: { debitPaise, creditPaise, balanced: debitPaise === creditPaise } };
  }

  /** Accounts by kind: SYSTEM, VENDOR or PARTNER (payees owed money, largest first). */
  async accounts(q: AccountsQuery) {
    const all = await this.ledger.balances(q.kind === 'VENDOR' || q.kind === 'PARTNER' ? `${q.kind}:` : undefined);
    const list = q.kind === 'SYSTEM' ? all.filter((a) => !a.ownerType) : all;
    return q.kind === 'VENDOR' || q.kind === 'PARTNER' ? list.sort((a, b) => b.balancePaise - a.balancePaise) : list;
  }

  /** An account's lines, newest first, each with its posting's memo. */
  async entries(code: string, q: EntriesQuery) {
    const account = await this.prisma.ledgerAccount.findUnique({ where: { code } });
    if (!account) throw new NotFoundException('Account not found.');
    const where: Prisma.LedgerEntryWhereInput = { accountId: account.id };
    const [rows, total, balance] = await Promise.all([
      this.prisma.ledgerEntry.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: q.skip, take: q.limit, include: { transaction: true } }),
      this.prisma.ledgerEntry.count({ where }),
      this.ledger.balance(code),
    ]);
    return {
      account: { code: account.code, name: account.name, type: account.type, ownerType: account.ownerType, ownerId: account.ownerId, balancePaise: balance },
      ...Paged.of(rows.map((e) => ({
        id: e.id, debitPaise: e.debitPaise, creditPaise: e.creditPaise,
        transaction: { id: e.transaction.id, kind: e.transaction.kind, memo: e.transaction.memo, reference: e.transaction.reference, sourceType: e.transaction.sourceType, sourceId: e.transaction.sourceId, occurredAt: e.transaction.occurredAt },
      })), total, q),
    };
  }

  async transaction(id: string) {
    const t = await this.prisma.ledgerTransaction.findUnique({ where: { id }, include: { entries: { include: { account: { select: { code: true, name: true, type: true } } } } } });
    if (!t) throw new NotFoundException('Transaction not found.');
    return { ...t, entries: t.entries.map((e) => ({ id: e.id, account: e.account, debitPaise: e.debitPaise, creditPaise: e.creditPaise })) };
  }

  async refunds(q: RefundsQuery) {
    const where: Prisma.RefundWhereInput = { status: q.status };
    const [rows, total] = await Promise.all([
      this.prisma.refund.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: q.skip, take: q.limit,
        include: { payment: { select: { id: true, purpose: true, amountPaise: true, status: true, providerPaymentId: true, user: { select: { id: true, name: true, phone: true } } } } },
      }),
      this.prisma.refund.count({ where }),
    ]);
    return Paged.of(rows, total, q);
  }

  async issues(q: IssuesQuery) {
    const where: Prisma.ReconciliationIssueWhereInput = {
      resolvedAt: q.state === 'resolved' ? { not: null } : q.state === 'all' ? undefined : null,
      severity: q.severity,
    };
    const [rows, total] = await Promise.all([
      this.prisma.reconciliationIssue.findMany({ where, orderBy: [{ createdAt: 'desc' }], skip: q.skip, take: q.limit }),
      this.prisma.reconciliationIssue.count({ where }),
    ]);
    return Paged.of(rows, total, q);
  }

  runs(limit = 20) {
    return this.prisma.reconciliationRun.findMany({ orderBy: { startedAt: 'desc' }, take: limit, include: { _count: { select: { issues: true } } } });
  }

  async resolveIssue(actorId: string, id: string, resolution: string) {
    const n = await this.prisma.reconciliationIssue.updateMany({ where: { id, resolvedAt: null }, data: { resolvedAt: new Date(), resolvedById: actorId, resolution } });
    if (!n.count) throw new NotFoundException('Open issue not found.');
    return this.prisma.reconciliationIssue.findUniqueOrThrow({ where: { id } });
  }

  /**
   * TCS and TDS by payee for one month (India time), for GST (GSTR-8) and income-tax (26Q) filing.
   * Amounts come from the ledger; taxable values are worked out from the orders and bookings behind them.
   */
  async taxReport(q: TaxReportQuery) {
    const start = istStart(`${q.month}-01`);
    const [y, m] = q.month.split('-').map(Number);
    const end = istStart(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`);
    const txs = await this.prisma.ledgerTransaction.findMany({
      where: { occurredAt: { gte: start, lt: end }, kind: { in: ['PARCEL_DELIVERED', 'PARCEL_RETURNED', 'BOOKING_EARNED'] } },
      include: { entries: { include: { account: true } } },
      orderBy: { occurredAt: 'asc' },
    });
    type Row = { payeeType: PayeeType; payeeId: string; name: string; gstin: string | null; pan: string | null; taxableValuePaise: number; tcsPaise: number; tdsPaise: number; feesPaise: number; gstOnFeesPaise: number; netPaidToPayeePaise: number; transactions: number };
    const rows = new Map<string, Row>();
    for (const t of txs) {
      const payeeEntry = t.entries.find((e) => e.account.ownerType);
      if (!payeeEntry) continue;
      const code = payeeEntry.account.code;
      const net = (c: string) => t.entries.filter((e) => e.account.code === c).reduce((a, e) => a + e.creditPaise - e.debitPaise, 0);
      let taxable = 0;
      if (t.sourceType === 'SubOrder' && t.sourceId) taxable = (await this.prisma.$transaction((tx) => this.finance.parcelSplit(tx, t.sourceId!))).taxableBasePaise * (t.kind === 'PARCEL_RETURNED' ? -1 : 1);
      if (t.sourceType === 'Booking' && t.sourceId) taxable = (await this.prisma.$transaction((tx) => this.finance.bookingSplit(tx, t.sourceId!)))?.taxableBasePaise ?? 0;
      const r = rows.get(code) ?? {
        payeeType: payeeEntry.account.ownerType as PayeeType, payeeId: payeeEntry.account.ownerId!, name: payeeEntry.account.name.replace(/^Owed to /, ''),
        gstin: null, pan: null, taxableValuePaise: 0, tcsPaise: 0, tdsPaise: 0, feesPaise: 0, gstOnFeesPaise: 0, netPaidToPayeePaise: 0, transactions: 0,
      };
      r.taxableValuePaise += taxable;
      r.tcsPaise += net('TCS_PAYABLE');
      r.tdsPaise += net('TDS_PAYABLE');
      r.feesPaise += net('FEE_REVENUE') + net('GST_PAYABLE');
      r.gstOnFeesPaise += net('GST_PAYABLE');
      r.netPaidToPayeePaise += net(code);
      r.transactions++;
      rows.set(code, r);
    }
    const list = [...rows.values()];
    const [vendors, partners] = await Promise.all([
      this.prisma.vendor.findMany({ where: { id: { in: list.filter((r) => r.payeeType === 'VENDOR').map((r) => r.payeeId) } }, select: { id: true, gstin: true, pan: true, businessName: true } }),
      this.prisma.servicePartner.findMany({ where: { id: { in: list.filter((r) => r.payeeType === 'PARTNER').map((r) => r.payeeId) } }, select: { id: true, gstin: true, pan: true, businessName: true } }),
    ]);
    for (const p of [...vendors, ...partners]) {
      const r = list.find((x) => x.payeeId === p.id);
      if (r) Object.assign(r, { gstin: p.gstin, pan: p.pan, name: p.businessName });
    }
    const sum = (k: 'taxableValuePaise' | 'tcsPaise' | 'tdsPaise' | 'feesPaise' | 'gstOnFeesPaise') => list.reduce((a, r) => a + r[k], 0);
    return {
      month: q.month,
      payees: list.sort((a, b) => a.name.localeCompare(b.name)),
      totals: { taxableValuePaise: sum('taxableValuePaise'), tcsPaise: sum('tcsPaise'), tdsPaise: sum('tdsPaise'), feesPaise: sum('feesPaise'), gstOnFeesPaise: sum('gstOnFeesPaise') },
      note: 'TCS is collected only from GST-registered payees. TDS uses the higher no-PAN rate where no PAN is on file. Check rates and returns with your tax adviser before filing.',
    };
  }

  /**
   * A customer's refunds, newest first, with what each was for (an order, a booking, a contest or challenge entry)
   * in words they recognise. Gateway references are shown so they can check with their bank.
   */
  async customerRefunds(userId: string, q: StatementQuery) {
    const where: Prisma.RefundWhereInput = { payment: { userId } };
    const [rows, total] = await Promise.all([
      this.prisma.refund.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: q.skip, take: q.limit,
        include: { payment: { select: { id: true, purpose: true, referenceId: true, amountPaise: true, providerPaymentId: true } } },
      }),
      this.prisma.refund.count({ where }),
    ]);
    const ids = (purpose: string) => [...new Set(rows.filter((r) => r.payment.purpose === purpose).map((r) => r.payment.referenceId))];
    const [orders, bookings, contests, challenges, memberships] = await Promise.all([
      this.prisma.order.findMany({ where: { id: { in: ids('PRODUCT_ORDER') } }, select: { id: true, code: true } }),
      this.prisma.booking.findMany({ where: { id: { in: ids('SERVICE_BOOKING') } }, select: { id: true, code: true, service: { select: { name: true } } } }),
      this.prisma.contest.findMany({ where: { id: { in: ids('CONTEST_REGISTRATION') } }, select: { id: true, title: true } }),
      this.prisma.challenge.findMany({ where: { id: { in: ids('CHALLENGE_JOIN') } }, select: { id: true, title: true } }),
      this.prisma.membership.findMany({ where: { id: { in: ids('MEMBERSHIP') } }, select: { id: true, plan: { select: { name: true } } } }),
    ]);
    const about = (purpose: string, id: string): { kind: string; id: string; title: string } => {
      switch (purpose) {
        case 'PRODUCT_ORDER': return { kind: 'ORDER', id, title: `Order ${orders.find((o) => o.id === id)?.code ?? ''}`.trim() };
        case 'SERVICE_BOOKING': {
          const b = bookings.find((x) => x.id === id);
          return { kind: 'BOOKING', id, title: b ? `${b.service.name} (${b.code})` : 'Booking' };
        }
        case 'CONTEST_REGISTRATION': return { kind: 'CONTEST', id, title: contests.find((c) => c.id === id)?.title ?? 'Contest entry' };
        case 'CHALLENGE_JOIN': return { kind: 'CHALLENGE', id, title: challenges.find((c) => c.id === id)?.title ?? 'Challenge entry' };
        case 'MEMBERSHIP': return { kind: 'MEMBERSHIP', id, title: `${memberships.find((m) => m.id === id)?.plan.name ?? ''} membership`.trim() };
        default: return { kind: 'OTHER', id, title: 'Payment' };
      }
    };
    return Paged.of(
      rows.map((r) => ({
        id: r.id,
        amountPaise: r.amountPaise,
        reason: r.reason,
        status: r.status,
        createdAt: r.createdAt,
        processedAt: r.processedAt,
        // The gateway's refund id, or how it was paid when paid another way (a bank transfer reference).
        reference: r.status === 'SETTLED_MANUALLY' ? r.manualReference : r.providerRefundId,
        paidPaise: r.payment.amountPaise,
        paymentReference: r.payment.providerPaymentId,
        about: about(r.payment.purpose, r.payment.referenceId),
      })),
      total,
      q,
    );
  }

  /**
   * A seller's or partner's own statement: what they're owed now, and every line on their account with
   * the sale, PetApp's fee and the taxes behind it.
   */
  async statement(type: PayeeType, ownerId: string, q: StatementQuery) {
    const code = payeeAccount(type, ownerId);
    const account = await this.prisma.ledgerAccount.findUnique({ where: { code } });
    if (!account) return { balancePaise: 0, totals: { earnedPaise: 0, paidOutPaise: 0, tcsPaise: 0, tdsPaise: 0, feesPaise: 0 }, ...Paged.of([], 0, q) };
    const where: Prisma.LedgerEntryWhereInput = { accountId: account.id };
    const [rows, total, balance, totals] = await Promise.all([
      this.prisma.ledgerEntry.findMany({
        where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: q.skip, take: q.limit,
        include: { transaction: { include: { entries: { include: { account: { select: { code: true } } } } } } },
      }),
      this.prisma.ledgerEntry.count({ where }),
      this.ledger.balance(code),
      this.prisma.$queryRaw<Array<{ code: string; payout: boolean; net: bigint }>>`
        SELECT a.code, t.kind LIKE 'PAYOUT%' AS payout, SUM(e."creditPaise" - e."debitPaise") AS net
        FROM "LedgerEntry" e JOIN "LedgerAccount" a ON a.id = e."accountId" JOIN "LedgerTransaction" t ON t.id = e."transactionId"
        WHERE e."transactionId" IN (SELECT "transactionId" FROM "LedgerEntry" WHERE "accountId" = ${account.id}::uuid)
        GROUP BY a.code, payout`,
    ]);
    const tot = (c: string, payout = false) => Number(totals.find((t) => t.code === c && t.payout === payout)?.net ?? 0);
    return {
      balancePaise: balance,
      totals: {
        // Earnings net of returns, fees and taxes; and what has left for the bank (payouts net of any that came back).
        earnedPaise: tot(code),
        paidOutPaise: -tot(code, true),
        tcsPaise: tot('TCS_PAYABLE'),
        tdsPaise: tot('TDS_PAYABLE'),
        feesPaise: tot('FEE_REVENUE') + tot('GST_PAYABLE'),
      },
      ...Paged.of(
        rows.map((e) => {
          const net = (c: string) => e.transaction.entries.filter((x) => x.account.code === c).reduce((a, x) => a + x.creditPaise - x.debitPaise, 0);
          const amountPaise = e.creditPaise - e.debitPaise;
          const tcsPaise = net('TCS_PAYABLE');
          const tdsPaise = net('TDS_PAYABLE');
          const feePaise = net('FEE_REVENUE') + net('GST_PAYABLE');
          return {
            id: e.id,
            occurredAt: e.transaction.occurredAt,
            kind: e.transaction.kind,
            memo: e.transaction.memo,
            sourceType: e.transaction.sourceType,
            sourceId: e.transaction.sourceId,
            amountPaise,
            // The gross amount before PetApp's fee and taxes: the sale, the visit or the prize (reversals are negative).
            // Null for payouts, which move money already earned.
            salePaise: e.transaction.kind.startsWith('PAYOUT_') ? null : amountPaise + feePaise + tcsPaise + tdsPaise,
            feePaise,
            tcsPaise,
            tdsPaise,
          };
        }),
        total,
        q,
      ),
    };
  }
}
