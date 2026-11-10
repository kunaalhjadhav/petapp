import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PAYOUT_PROVIDER, PayoutError, type PayoutProvider, type Validation } from '../../providers/payouts/payout.provider';
import { QueueService } from '../../queue/queue.service';
import { AuditService } from '../audit/audit.service';
import { PlatformService } from '../platform/platform.service';
import { ACCOUNT_NUMBER_PATTERN, IFSC_PATTERN, VPA_PATTERN, namesMatch, type PayeeType } from './finance.rules';
import { SecretBox } from './secret-box';
import type { PayoutAccount } from '../../generated/prisma/client';

export interface NewPayoutAccount {
  method: 'BANK' | 'UPI';
  holderName: string;
  ifsc?: string;
  accountNumber?: string;
  vpa?: string;
}

/**
 * Where sellers, partners and prize winners are paid.
 * - Account numbers are encrypted at rest and never returned; only the last four digits are shown.
 * - Every account is validated with the bank (the provider's ₹1 check reports the holder's name) before use.
 * - A new account replaces the old one only once it's verified, and receives payouts only after a hold, so a
 *   stolen login can't quietly redirect money. The payee is told whenever their account changes.
 */
@Injectable()
export class PayoutAccountsService {
  private readonly logger = new Logger(PayoutAccountsService.name);
  private readonly box: SecretBox;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly platform: PlatformService,
    private readonly queue: QueueService,
    @Inject(PAYOUT_PROVIDER) private readonly provider: PayoutProvider,
    config: AppConfig,
  ) {
    this.box = new SecretBox(config.get('PAYOUT_DATA_KEY'));
    if (this.box.usingDevKey) this.logger.warn('PAYOUT_DATA_KEY is not set: bank details use a development key');
  }

  /** What the payee (or staff) may see: never the full account number. */
  /**
   * What the payee and staff see. `nameMatches`: the bank's name for the account is one of the payee's own names
   * (business, legal or personal) — the same test that decides the safety hold. Without the payee's names it falls
   * back to the name typed in. Null until the bank answers.
   */
  view(a: PayoutAccount, ownerNames: string[] = []) {
    const names = ownerNames.length ? ownerNames : [a.holderName];
    return {
      id: a.id, method: a.method, holderName: a.holderName, ifsc: a.ifsc, accountLast4: a.accountLast4, vpa: a.vpa,
      status: a.status, verifiedName: a.verifiedName,
      nameMatches: a.verifiedName ? names.some((n) => namesMatch(a.verifiedName, n)) : null,
      failureReason: a.failureReason, verifiedAt: a.verifiedAt, payableFrom: a.payableFrom, createdAt: a.createdAt,
    };
  }

  /** The account payouts go to now (verified), and one being checked, if any. */
  async mine(ownerType: PayeeType, ownerId: string) {
    const rows = await this.prisma.payoutAccount.findMany({ where: { ownerType, ownerId, status: { in: ['VERIFIED', 'PENDING', 'FAILED'] } }, orderBy: { createdAt: 'desc' }, take: 5 });
    const active = rows.find((a) => a.status === 'VERIFIED');
    const latest = rows[0];
    const names = await this.ownerNames(ownerType, ownerId).catch(() => [] as string[]);
    return {
      active: active ? this.view(active, names) : null,
      // A newer account still being checked, or one the bank refused (so the payee can see why).
      pending: latest && latest !== active && latest.createdAt > (active?.createdAt ?? new Date(0)) ? this.view(latest, names) : null,
    };
  }

  /** Decrypted account number, for sending money only. */
  accountNumber(a: Pick<PayoutAccount, 'accountNumberEnc'>) {
    return a.accountNumberEnc ? this.box.open(a.accountNumberEnc) : null;
  }

  async add(ownerType: PayeeType, ownerId: string, ownerName: string, actorUserId: string, dto: NewPayoutAccount) {
    const holderName = dto.holderName.trim().replace(/\s+/g, ' ');
    if (holderName.length < 2) throw new BadRequestException('Enter the account holder’s name as the bank has it.');
    let ifsc: string | null = null;
    let accountNumber: string | null = null;
    let vpa: string | null = null;
    if (dto.method === 'BANK') {
      ifsc = (dto.ifsc ?? '').trim().toUpperCase();
      accountNumber = (dto.accountNumber ?? '').replace(/\s/g, '');
      if (!IFSC_PATTERN.test(ifsc)) throw new BadRequestException('IFSC must be 11 characters, like HDFC0001234.');
      if (!ACCOUNT_NUMBER_PATTERN.test(accountNumber)) throw new BadRequestException('Account number must be 9 to 18 digits.');
    } else {
      vpa = (dto.vpa ?? '').trim();
      if (!VPA_PATTERN.test(vpa)) throw new BadRequestException('Enter a UPI ID like name@bank.');
    }
    // A few changes a day at most: rapid changes are a takeover pattern.
    const recent = await this.prisma.payoutAccount.count({ where: { ownerType, ownerId, createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
    if (recent >= 3) throw new BadRequestException('You’ve changed your payout account several times today. Try again tomorrow or contact support.');

    // An older account still being checked is replaced by this one.
    await this.prisma.payoutAccount.updateMany({ where: { ownerType, ownerId, status: 'PENDING' }, data: { status: 'DISABLED', failureReason: 'Replaced by a newer account' } });
    const a = await this.prisma.payoutAccount.create({
      data: {
        ownerType, ownerId, method: dto.method, holderName, ifsc, vpa,
        accountLast4: accountNumber ? accountNumber.slice(-4) : null,
        accountNumberEnc: accountNumber ? this.box.seal(accountNumber) : null,
      },
    });
    await this.audit.log({ actorId: actorUserId, action: 'payout_account.add', entityType: 'PayoutAccount', entityId: a.id, after: { ownerType, ownerId, method: a.method, ifsc, last4: a.accountLast4, vpa } });
    try {
      const b = await this.provider.addBeneficiary({
        referenceId: `${ownerType}:${ownerId}`, name: ownerName, type: 'vendor',
        bank: accountNumber && ifsc ? { holderName, ifsc, accountNumber } : undefined, vpa: vpa ?? undefined,
      });
      await this.prisma.payoutAccount.update({ where: { id: a.id }, data: { providerContactId: b.contactId, providerFundAccountId: b.fundAccountId } });
      const v = await this.provider.validate(b.fundAccountId);
      await this.prisma.payoutAccount.update({ where: { id: a.id }, data: { providerValidationId: v.validationId } });
      await this.applyValidation(a.id, v);
    } catch (e) {
      // Not a lost account: it stays PENDING and the worker tries the provider again.
      this.logger.warn(`payout account ${a.id}: provider step failed: ${(e as Error).message}`);
      if (e instanceof PayoutError && !e.retryable) await this.fail(a.id, (e as Error).message);
    }
    return this.mine(ownerType, ownerId);
  }

  private async fail(id: string, reason: string) {
    const a = await this.prisma.payoutAccount.update({ where: { id }, data: { status: 'FAILED', failureReason: reason.slice(0, 300) } });
    this.queue.notify({ type: 'PAYOUT_ACCOUNT', accountId: a.id });
  }

  /** The bank's answer about an account. Idempotent; only a PENDING account changes. */
  async applyValidation(id: string, v: Validation) {
    if (v.status === 'pending') return 'pending';
    const a = await this.prisma.payoutAccount.findUnique({ where: { id } });
    if (!a || a.status !== 'PENDING') return 'skipped';
    if (v.status === 'failed' || !v.accountActive) {
      const n = await this.prisma.payoutAccount.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'FAILED', failureReason: (v.failureReason ?? 'The bank says this account can’t receive money. Check the details.').slice(0, 300) } });
      if (n.count) this.queue.notify({ type: 'PAYOUT_ACCOUNT', accountId: id });
      return n.count ? 'failed' : 'skipped';
    }
    const holdHours = await this.platform.getSetting<number>('finance.newAccountHoldHours');
    const names = await this.ownerNames(a.ownerType as PayeeType, a.ownerId).catch(() => [] as string[]);
    const ok = await this.prisma.$transaction(async (tx) => {
      // Still pending? (Staff may have switched it off, or a newer account replaced it, while the bank answered.)
      const [locked] = await tx.$queryRaw<Array<{ status: string }>>`SELECT status::text AS status FROM "PayoutAccount" WHERE id = ${id}::uuid FOR UPDATE`;
      if (locked?.status !== 'PENDING') return false;
      const everVerified = await tx.payoutAccount.count({ where: { ownerType: a.ownerType, ownerId: a.ownerId, verifiedAt: { not: null }, id: { not: id } } });
      // The old account steps aside only now, so payouts never pause during a change.
      await tx.payoutAccount.updateMany({ where: { ownerType: a.ownerType, ownerId: a.ownerId, status: 'VERIFIED' }, data: { status: 'DISABLED', failureReason: 'Replaced by a newer account' } });
      // A replacement — or an account in a name that isn't the payee's — is paid only after the safety hold.
      const nameOk = names.some((n) => namesMatch(v.registeredName, n));
      const now = new Date();
      const held = everVerified > 0 || !nameOk;
      await tx.payoutAccount.update({
        where: { id },
        data: { status: 'VERIFIED', verifiedAt: now, verifiedName: v.registeredName ?? null, failureReason: null, payableFrom: held ? new Date(now.getTime() + holdHours * 3_600_000) : now },
      });
      await this.audit.log({ actorId: null, action: 'payout_account.verified', entityType: 'PayoutAccount', entityId: id, after: { verifiedName: v.registeredName, replacesEarlier: everVerified > 0, nameMatchesPayee: nameOk } }, tx);
      return true;
    });
    if (!ok) return 'skipped';
    this.queue.notify({ type: 'PAYOUT_ACCOUNT', accountId: id });
    return 'verified';
  }

  /** Worker: finish accounts whose provider steps were interrupted or whose validation is still running. */
  async sweepPending(limit = 50) {
    const stale = await this.prisma.payoutAccount.findMany({ where: { status: 'PENDING', updatedAt: { lt: new Date(Date.now() - 60_000) } }, take: limit });
    for (const a of stale) {
      try {
        if (!a.providerFundAccountId) {
          const ownerName = await this.ownerName(a.ownerType as PayeeType, a.ownerId);
          const b = await this.provider.addBeneficiary({
            referenceId: `${a.ownerType}:${a.ownerId}`, name: ownerName, type: 'vendor',
            bank: a.accountNumberEnc && a.ifsc ? { holderName: a.holderName, ifsc: a.ifsc, accountNumber: this.accountNumber(a)! } : undefined, vpa: a.vpa ?? undefined,
          });
          await this.prisma.payoutAccount.update({ where: { id: a.id }, data: { providerContactId: b.contactId, providerFundAccountId: b.fundAccountId } });
          const v = await this.provider.validate(b.fundAccountId);
          await this.prisma.payoutAccount.update({ where: { id: a.id }, data: { providerValidationId: v.validationId } });
          await this.applyValidation(a.id, v);
        } else if (!a.providerValidationId) {
          const v = await this.provider.validate(a.providerFundAccountId);
          await this.prisma.payoutAccount.update({ where: { id: a.id }, data: { providerValidationId: v.validationId } });
          await this.applyValidation(a.id, v);
        } else {
          const v = await this.provider.getValidation(a.providerValidationId);
          if (v.status === 'pending') await this.prisma.payoutAccount.update({ where: { id: a.id }, data: { updatedAt: new Date() } });
          else await this.applyValidation(a.id, v);
        }
      } catch (e) {
        if (e instanceof PayoutError && !e.retryable) await this.fail(a.id, e.message);
        else this.logger.warn(`payout account ${a.id}: ${(e as Error).message}`);
      }
    }
    return stale.length;
  }

  /** Staff: switch an account off (e.g. reported as fraudulent). Payouts stop until the payee adds another. */
  async disable(actorId: string, id: string, reason: string) {
    const n = await this.prisma.payoutAccount.updateMany({ where: { id, status: { in: ['PENDING', 'VERIFIED'] } }, data: { status: 'DISABLED', failureReason: reason } });
    if (!n.count) throw new NotFoundException('Active payout account not found.');
    await this.audit.log({ actorId, action: 'payout_account.disable', entityType: 'PayoutAccount', entityId: id, after: { reason } });
    this.queue.notify({ type: 'PAYOUT_ACCOUNT', accountId: id });
    return this.view(await this.prisma.payoutAccount.findUniqueOrThrow({ where: { id } }));
  }

  /** Names an account may legitimately be in: the business's names and its owner's own name. */
  async ownerNames(type: PayeeType, id: string): Promise<string[]> {
    if (type === 'VENDOR') {
      const v = await this.prisma.vendor.findUniqueOrThrow({ where: { id }, select: { businessName: true, legalName: true, user: { select: { name: true } } } });
      return [v.businessName, v.legalName, v.user.name].filter((x): x is string => !!x);
    }
    if (type === 'PARTNER') {
      const p = await this.prisma.servicePartner.findUniqueOrThrow({ where: { id }, select: { businessName: true, user: { select: { name: true } } } });
      return [p.businessName, p.user.name].filter((x): x is string => !!x);
    }
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id }, select: { name: true } });
    return u.name ? [u.name] : [];
  }

  async ownerName(type: PayeeType, id: string): Promise<string> {
    if (type === 'VENDOR') return (await this.prisma.vendor.findUniqueOrThrow({ where: { id }, select: { businessName: true } })).businessName;
    if (type === 'PARTNER') return (await this.prisma.servicePartner.findUniqueOrThrow({ where: { id }, select: { businessName: true } })).businessName;
    return (await this.prisma.user.findUniqueOrThrow({ where: { id }, select: { name: true } })).name ?? 'PetApp user';
  }
}
