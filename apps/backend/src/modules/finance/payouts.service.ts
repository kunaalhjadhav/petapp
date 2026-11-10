import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Prisma, type Payout } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PAYOUT_PROVIDER, PayoutError, type PayoutProvider, type ProviderPayout } from '../../providers/payouts/payout.provider';
import { QueueService } from '../../queue/queue.service';
import { AuditService } from '../audit/audit.service';
import { PlatformService } from '../platform/platform.service';
import { LedgerService } from './ledger.service';
import { IMMEDIATE_CREDIT_KINDS, PAYEE_TYPES, payeeAccount, payoutMode, refundBackoffMs, type PayeeType } from './finance.rules';

type Tx = Prisma.TransactionClient;
const FINAL: Payout['status'][] = ['PROCESSED', 'FAILED', 'REVERSED', 'CANCELLED'];

/**
 * Paying sellers, partners and prize winners what they're owed.
 *
 * Money only leaves through a batch that one staff member prepares and a different one approves.
 * Approval moves each amount off the payee's balance into "payouts in transit" (so it can't be paid twice);
 * the bank's confirmation moves it out of PetApp's bank; a failed or reversed payout puts it back on the
 * payee's balance for the next batch. Each payout's id is its idempotency key at the provider.
 */
@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly platform: PlatformService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    @Inject(PAYOUT_PROVIDER) private readonly provider: PayoutProvider,
  ) {}

  // ══════════════ balances ══════════════

  /**
   * What can be paid to a payee now: their balance, counting earnings only once they are older than the holding
   * period (returns may still reverse them), while every deduction counts at once.
   */
  async available(type: PayeeType, id: string, tx: Tx | PrismaService = this.prisma, holdDays?: number): Promise<{ balancePaise: number; availablePaise: number }> {
    holdDays ??= await this.platform.getSetting<number>('finance.payoutHoldDays');
    const cutoff = new Date(Date.now() - holdDays * 86_400_000);
    const [r] = await tx.$queryRaw<Array<{ balance: bigint; available: bigint }>>`
      SELECT COALESCE(SUM(e."creditPaise" - e."debitPaise"), 0)::bigint AS balance,
             (COALESCE(SUM(e."creditPaise") FILTER (WHERE t."occurredAt" < ${cutoff} OR t.kind IN (${Prisma.join(IMMEDIATE_CREDIT_KINDS)})), 0)
              - COALESCE(SUM(e."debitPaise"), 0))::bigint AS available
      FROM "LedgerEntry" e
      JOIN "LedgerAccount" a ON a.id = e."accountId"
      JOIN "LedgerTransaction" t ON t.id = e."transactionId"
      WHERE a.code = ${payeeAccount(type, id)}`;
    const balancePaise = Number(r?.balance ?? 0);
    return { balancePaise, availablePaise: Math.max(0, Math.min(balancePaise, Number(r?.available ?? 0))) };
  }

  /** A payee's payouts, newest first. */
  async history(type: PayeeType, id: string, take = 50) {
    const rows = await this.prisma.payout.findMany({
      where: { payeeType: type, payeeId: id, status: { notIn: ['DRAFT', 'CANCELLED'] } },
      orderBy: { createdAt: 'desc' }, take,
      include: { account: { select: { method: true, accountLast4: true, vpa: true, ifsc: true } } },
    });
    return rows.map((p) => ({ id: p.id, amountPaise: p.amountPaise, purpose: p.purpose, status: p.status, utr: p.utr, failureReason: p.failureReason, processedAt: p.processedAt, createdAt: p.createdAt, account: p.account }));
  }

  /** The payee's side: balance, what's payable, the account, and recent payouts. */
  async summary(type: PayeeType, id: string) {
    const [bal, account, payouts] = await Promise.all([
      this.available(type, id),
      this.prisma.payoutAccount.findFirst({ where: { ownerType: type, ownerId: id, status: 'VERIFIED' }, select: { id: true, method: true, accountLast4: true, vpa: true, payableFrom: true } }),
      this.history(type, id, 20),
    ]);
    const holdDays = await this.platform.getSetting<number>('finance.payoutHoldDays');
    return { ...bal, holdDays, account, payouts };
  }

  // ══════════════ batches ══════════════

  private async eligiblePayees(only?: PayeeType) {
    const min = await this.platform.getSetting<number>('finance.minPayoutPaise');
    const accounts = await this.prisma.ledgerAccount.findMany({ where: { ownerType: { in: only ? [only] : PAYEE_TYPES } } });
    const busy = new Set((await this.prisma.payout.findMany({ where: { status: { in: ['DRAFT', 'QUEUED', 'PROCESSING'] } }, select: { payeeType: true, payeeId: true } })).map((p) => `${p.payeeType}:${p.payeeId}`));
    const out: Array<{ type: PayeeType; id: string; name: string; amountPaise: number; accountId: string }> = [];
    for (const a of accounts) {
      const type = a.ownerType as PayeeType;
      const id = a.ownerId!;
      if (busy.has(`${type}:${id}`)) continue; // already has a payout on the way
      const { availablePaise } = await this.available(type, id);
      if (availablePaise <= 0 || availablePaise < min) continue;
      const pa = await this.prisma.payoutAccount.findFirst({ where: { ownerType: type, ownerId: id, status: 'VERIFIED', payableFrom: { lte: new Date() } } });
      if (!pa) continue;
      // Paused sellers and partners are held until their review is over.
      if (type === 'VENDOR' && (await this.prisma.vendor.count({ where: { id, status: 'SUSPENDED' } }))) continue;
      if (type === 'PARTNER' && (await this.prisma.servicePartner.count({ where: { id, status: 'SUSPENDED' } }))) continue;
      out.push({ type, id, name: a.name.replace(/^Owed to /, ''), amountPaise: availablePaise, accountId: pa.id });
    }
    return out;
  }

  /** What a new batch would contain right now (nothing is reserved). */
  async preview(only?: PayeeType) {
    const list = await this.eligiblePayees(only);
    return { payees: list, count: list.length, totalPaise: list.reduce((a, p) => a + p.amountPaise, 0) };
  }

  async createBatch(actorId: string, only?: PayeeType, note?: string) {
    const list = await this.eligiblePayees(only);
    if (!list.length) throw new BadRequestException('Nobody is due a payout right now: no payee has enough payable balance and a verified account.');
    const code = `PB-${new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(2).toString('hex').toUpperCase()}`;
    const batch = await this.prisma
      .$transaction(async (tx) => {
        const b = await tx.payoutBatch.create({ data: { code, note, createdById: actorId } });
        for (const p of list) {
          const payout = await tx.payout.create({ data: { batchId: b.id, payeeType: p.type, payeeId: p.id, payeeName: p.name, accountId: p.accountId, amountPaise: p.amountPaise, purpose: p.type === 'USER' ? 'PRIZE' : 'EARNINGS' } });
          // Prizes approved so far ride on this payout (marked paid when it is).
          if (p.type === 'USER') {
            await tx.$executeRaw`
              UPDATE "ContestPrize" cp SET "payoutId" = ${payout.id}::uuid
              FROM "ContestParticipant" pt
              WHERE cp."participantId" = pt.id AND pt."userId" = ${p.id}::uuid AND cp."payoutStatus" = 'APPROVED' AND cp."payoutId" IS NULL`;
          }
        }
        return b;
      })
      .catch((e: { code?: string }) => {
        // The database allows one open payout per payee: a batch prepared at the same moment got there first.
        if (e.code === 'P2002') throw new ConflictException('Another payout batch was just prepared for some of these payees. Refresh and try again.');
        throw e;
      });
    await this.audit.log({ actorId, action: 'payout_batch.create', entityType: 'PayoutBatch', entityId: batch.id, after: { code, count: list.length, totalPaise: list.reduce((a, p) => a + p.amountPaise, 0) } });
    return this.batch(batch.id);
  }

  async batch(id: string) {
    const b = await this.prisma.payoutBatch.findUnique({ where: { id }, include: { payouts: { orderBy: { amountPaise: 'desc' }, include: { account: { select: { method: true, ifsc: true, accountLast4: true, vpa: true, verifiedName: true, holderName: true } } } } } });
    if (!b) throw new NotFoundException('Payout batch not found.');
    const sum = (s?: Payout['status'][]) => b.payouts.filter((p) => !s || s.includes(p.status)).reduce((a, p) => a + p.amountPaise, 0);
    const people = await this.staffNames([b.createdById, b.approvedById]);
    return {
      ...b,
      createdBy: people.get(b.createdById) ?? null,
      approvedBy: (b.approvedById && people.get(b.approvedById)) ?? null,
      totals: { count: b.payouts.length, totalPaise: sum(), paidPaise: sum(['PROCESSED']), failedPaise: sum(['FAILED', 'REVERSED']), inFlightPaise: sum(['QUEUED', 'PROCESSING']) },
    };
  }

  async batches(q: { skip: number; limit: number; page: number }) {
    const [items, total] = await Promise.all([
      this.prisma.payoutBatch.findMany({ orderBy: { createdAt: 'desc' }, skip: q.skip, take: q.limit, include: { _count: { select: { payouts: true } } } }),
      this.prisma.payoutBatch.count(),
    ]);
    const sums = await this.prisma.payout.groupBy({ by: ['batchId'], where: { batchId: { in: items.map((b) => b.id) }, status: { not: 'CANCELLED' } }, _sum: { amountPaise: true } });
    const people = await this.staffNames(items.flatMap((b) => [b.createdById, b.approvedById]));
    return {
      items: items.map((b) => ({
        ...b,
        totalPaise: sums.find((s) => s.batchId === b.id)?._sum.amountPaise ?? 0,
        createdBy: people.get(b.createdById) ?? null,
        approvedBy: (b.approvedById && people.get(b.approvedById)) ?? null,
      })),
      total,
    };
  }

  /** Who prepared and approved batches, for the maker-checker record. */
  private async staffNames(ids: Array<string | null>) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    const users = unique.length ? await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, email: true } }) : [];
    return new Map(users.map((u) => [u.id, { id: u.id, name: u.name ?? u.email ?? 'Staff member' }]));
  }

  /**
   * The second person approves. Each payout is checked again against the payee's balance under a lock
   * (it may have dropped since the batch was prepared), then moved to "in transit" and queued.
   */
  async approve(actorId: string, id: string) {
    const b = await this.prisma.payoutBatch.findUnique({ where: { id } });
    if (!b) throw new NotFoundException('Payout batch not found.');
    if (b.createdById === actorId) throw new ForbiddenException('A payout batch must be approved by someone other than the person who prepared it.');
    if (b.status !== 'DRAFT') throw new BadRequestException(`This batch is ${b.status.toLowerCase()}.`);
    const holdDays = await this.platform.getSetting<number>('finance.payoutHoldDays');
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.payoutBatch.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'PROCESSING', approvedById: actorId, approvedAt: new Date() } });
      if (!moved.count) throw new ConflictException('This batch just changed. Refresh and try again.');
      // A fixed order, so two approvals touching the same payees can't deadlock.
      const payouts = await tx.payout.findMany({ where: { batchId: id, status: 'DRAFT' }, orderBy: [{ payeeType: 'asc' }, { payeeId: 'asc' }] });
      let queued = 0;
      for (const p of payouts) {
        const code = payeeAccount(p.payeeType as PayeeType, p.payeeId);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${code}))`;
        const { availablePaise } = await this.available(p.payeeType as PayeeType, p.payeeId, tx, holdDays);
        const account = await tx.payoutAccount.findUnique({ where: { id: p.accountId } });
        if (availablePaise < p.amountPaise || account?.status !== 'VERIFIED') {
          await tx.payout.update({ where: { id: p.id }, data: { status: 'CANCELLED', failureReason: account?.status !== 'VERIFIED' ? 'The payout account changed after the batch was prepared' : 'The balance changed after the batch was prepared' } });
          await tx.contestPrize.updateMany({ where: { payoutId: p.id }, data: { payoutId: null } });
          continue;
        }
        await this.ledger.post(tx, {
          kind: 'PAYOUT_APPROVED', reference: `payout:Payout:${p.id}`, memo: `Payout approved (batch ${b.code})`, sourceType: 'Payout', sourceId: p.id,
          lines: [
            { account: { payee: p.payeeType as PayeeType, id: p.payeeId, name: p.payeeName }, debit: p.amountPaise },
            { account: 'PAYOUTS_IN_TRANSIT', credit: p.amountPaise },
          ],
        });
        await tx.payout.update({ where: { id: p.id }, data: { status: 'QUEUED' } });
        queued++;
      }
      if (!queued) await tx.payoutBatch.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
      await this.audit.log({ actorId, action: 'payout_batch.approve', entityType: 'PayoutBatch', entityId: id, after: { queued, dropped: payouts.length - queued } }, tx);
    }, { timeout: 120_000, maxWait: 10_000 });
    return this.batch(id);
  }

  async cancel(actorId: string, id: string) {
    const n = await this.prisma.$transaction(async (tx) => {
      const r = await tx.payoutBatch.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
      if (r.count) {
        await tx.contestPrize.updateMany({ where: { payoutId: { in: (await tx.payout.findMany({ where: { batchId: id }, select: { id: true } })).map((x) => x.id) } }, data: { payoutId: null } });
        await tx.payout.updateMany({ where: { batchId: id, status: 'DRAFT' }, data: { status: 'CANCELLED', failureReason: 'Batch cancelled' } });
      }
      return r.count;
    });
    if (!n) throw new BadRequestException('Only a batch that hasn’t been approved can be cancelled.');
    await this.audit.log({ actorId, action: 'payout_batch.cancel', entityType: 'PayoutBatch', entityId: id });
    return this.batch(id);
  }

  // ══════════════ sending ══════════════

  /** Worker: send queued payouts and follow ones in progress. */
  async sweep(limit = 50) {
    const now = new Date();
    const due = await this.prisma.payout.findMany({ where: { status: 'QUEUED', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }, orderBy: { createdAt: 'asc' }, take: limit, select: { id: true } });
    const counts: Record<string, number> = {};
    for (const p of due) {
      const r = await this.send(p.id);
      counts[r] = (counts[r] ?? 0) + 1;
    }
    const stale = await this.prisma.payout.findMany({ where: { status: 'PROCESSING', updatedAt: { lt: new Date(now.getTime() - 10 * 60_000) } }, take: limit, select: { id: true } });
    for (const p of stale) {
      const r = await this.check(p.id);
      counts[r] = (counts[r] ?? 0) + 1;
    }
    if (due.length || stale.length) this.logger.log(`payouts: ${JSON.stringify(counts)}`);
    return counts;
  }

  async send(id: string): Promise<string> {
    const claimed = await this.prisma.payout.updateMany({
      where: { id, status: 'QUEUED', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] },
      data: { status: 'PROCESSING', attempts: { increment: 1 }, lastError: null },
    });
    if (!claimed.count) return 'skipped';
    const p = await this.prisma.payout.findUniqueOrThrow({ where: { id }, include: { account: true, batch: { select: { code: true } } } });
    // An account switched off (e.g. reported as fraudulent) after approval gets nothing: the money goes back.
    if (p.account.status !== 'VERIFIED' || !p.account.providerFundAccountId) {
      return this.apply(id, { payoutId: '', status: 'failed', failureReason: 'The payout account was switched off or replaced before the money was sent' });
    }
    let result: ProviderPayout;
    try {
      // An earlier attempt may have reached the provider before failing on our side: never pay twice.
      result = (await this.provider.findPayout(p.id)) ?? (await this.provider.payout({
        fundAccountId: p.account.providerFundAccountId, amountPaise: p.amountPaise, mode: payoutMode(p.account.method as 'BANK' | 'UPI', p.amountPaise),
        referenceId: p.id, narration: `PetApp payout ${p.batch.code}`,
      }));
    } catch (e) {
      return this.retryOrHold(id, p.attempts, e);
    }
    return this.apply(id, result);
  }

  async check(id: string): Promise<string> {
    const p = await this.prisma.payout.findUnique({ where: { id } });
    if (!p || p.status !== 'PROCESSING') return 'skipped';
    try {
      const r = p.providerPayoutId ? await this.provider.getPayout(p.providerPayoutId) : await this.provider.findPayout(p.id);
      if (r) return await this.apply(id, r);
      // Never reached the provider: send again.
      await this.prisma.payout.updateMany({ where: { id, status: 'PROCESSING', providerPayoutId: null }, data: { status: 'QUEUED', nextAttemptAt: new Date() } });
      return 'retrying';
    } catch (e) {
      this.logger.warn(`payout ${id}: status check failed: ${(e as Error).message}`);
      return 'pending';
    }
  }

  /**
   * A refusal (the provider definitely didn't create the payout) fails it and returns the money to the payee.
   * Anything else — timeouts, outages — may have reached the provider, so it is never failed here: it is retried
   * (each retry first looks for the payout by our reference), and after the last retry it waits in PROCESSING for
   * the status check to find out what happened.
   */
  private async retryOrHold(id: string, attempts: number, e: unknown): Promise<string> {
    const message = ((e as Error).message ?? String(e)).slice(0, 500);
    if (e instanceof PayoutError && !e.retryable) return this.apply(id, { payoutId: '', status: 'failed', failureReason: message });
    const max = await this.platform.getSetting<number>('finance.refundMaxAttempts');
    if (attempts >= max) {
      await this.prisma.payout.updateMany({ where: { id, status: 'PROCESSING' }, data: { lastError: `Needs review after ${attempts} attempts: ${message}`.slice(0, 500) } });
      this.logger.error(`payout ${id}: no answer from the provider after ${attempts} attempts; left for the status check`);
      return 'held';
    }
    const base = await this.platform.getSetting<number>('finance.refundRetryBaseMinutes');
    await this.prisma.payout.updateMany({ where: { id, status: 'PROCESSING' }, data: { status: 'QUEUED', lastError: message, nextAttemptAt: new Date(Date.now() + refundBackoffMs(attempts, base)) } });
    return 'retrying';
  }

  /** What the provider says about a payout (send response, webhook or poll). Idempotent. */
  async apply(id: string, r: ProviderPayout): Promise<string> {
    if (r.status === 'pending') {
      const n = await this.prisma.payout.updateMany({ where: { id, status: 'PROCESSING' }, data: { providerPayoutId: r.payoutId || undefined } });
      return n.count ? 'pending' : 'skipped';
    }
    const outcome = await this.prisma.$transaction(async (tx) => {
      const p = await tx.payout.findUniqueOrThrow({ where: { id } });
      const payee = { payee: p.payeeType as PayeeType, id: p.payeeId, name: p.payeeName };
      if (r.status === 'processed') {
        const n = await tx.payout.updateMany({ where: { id, status: { in: ['QUEUED', 'PROCESSING'] } }, data: { status: 'PROCESSED', processedAt: new Date(), utr: r.utr ?? null, providerPayoutId: r.payoutId || undefined, lastError: null } });
        if (!n.count) return null;
        await this.ledger.post(tx, { kind: 'PAYOUT_PAID', reference: `payout-paid:Payout:${id}`, memo: `Paid to ${p.payeeName}${r.utr ? ` (UTR ${r.utr})` : ''}`, sourceType: 'Payout', sourceId: id, lines: [{ account: 'PAYOUTS_IN_TRANSIT', debit: p.amountPaise }, { account: 'BANK', credit: p.amountPaise }] });
        await tx.contestPrize.updateMany({ where: { payoutId: id, payoutStatus: 'APPROVED' }, data: { payoutStatus: 'PAID' } });
        return 'processed';
      }
      // Failed — or reversed before we ever saw it paid: either way it never reached the payee's bank for good.
      if (r.status === 'failed' || (r.status === 'reversed' && p.status !== 'PROCESSED')) {
        const n = await tx.payout.updateMany({
          where: { id, status: { in: ['QUEUED', 'PROCESSING'] } },
          data: { status: r.status === 'failed' ? 'FAILED' : 'REVERSED', failureReason: (r.failureReason ?? 'The bank couldn’t complete this payout').slice(0, 300), providerPayoutId: r.payoutId || undefined },
        });
        if (!n.count) return null;
        await tx.contestPrize.updateMany({ where: { payoutId: id }, data: { payoutId: null } });
        await this.ledger.post(tx, { kind: 'PAYOUT_FAILED', reference: `payout-failed:Payout:${id}`, memo: `Payout to ${p.payeeName} ${r.status === 'failed' ? 'failed' : 'returned by the bank'}; back on their balance`, sourceType: 'Payout', sourceId: id, lines: [{ account: 'PAYOUTS_IN_TRANSIT', debit: p.amountPaise }, { account: payee, credit: p.amountPaise }] });
        return r.status === 'failed' ? 'failed' : 'reversed';
      }
      // reversed: the bank returned money that had been paid.
      const n = await tx.payout.updateMany({ where: { id, status: 'PROCESSED' }, data: { status: 'REVERSED', failureReason: (r.failureReason ?? 'Returned by the bank').slice(0, 300) } });
      if (!n.count) return null;
      await tx.contestPrize.updateMany({ where: { payoutId: id, payoutStatus: 'PAID' }, data: { payoutStatus: 'APPROVED', payoutId: null } });
      await this.ledger.post(tx, { kind: 'PAYOUT_REVERSED', reference: `payout-reversed:Payout:${id}`, memo: `Payout to ${p.payeeName} returned by the bank; back on their balance`, sourceType: 'Payout', sourceId: id, lines: [{ account: 'BANK', debit: p.amountPaise }, { account: payee, credit: p.amountPaise }] });
      return 'reversed';
    });
    if (!outcome) return 'skipped';
    await this.audit.log({ actorId: null, action: `payout.${outcome}`, entityType: 'Payout', entityId: id, after: { utr: r.utr, reason: r.failureReason } });
    this.queue.notify({ type: 'PAYOUT_UPDATE', payoutId: id });
    await this.completeBatchIfDone(id);
    return outcome;
  }

  private async completeBatchIfDone(payoutId: string) {
    const p = await this.prisma.payout.findUnique({ where: { id: payoutId }, select: { batchId: true } });
    if (!p) return;
    const open = await this.prisma.payout.count({ where: { batchId: p.batchId, status: { notIn: FINAL } } });
    if (!open) await this.prisma.payoutBatch.updateMany({ where: { id: p.batchId, status: 'PROCESSING' }, data: { status: 'COMPLETED', completedAt: new Date() } });
  }

  /** Provider webhook about a payout; matched by our reference (the payout id) or the provider's id. */
  async fromWebhook(r: ProviderPayout): Promise<string> {
    const p = await this.prisma.payout.findFirst({ where: { OR: [...(r.referenceId && /^[0-9a-f-]{36}$/.test(r.referenceId) ? [{ id: r.referenceId }] : []), { providerPayoutId: r.payoutId }] } });
    if (!p) return 'unknown_payout';
    return this.apply(p.id, r);
  }
}
