import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SYSTEM_ACCOUNTS, normalBalance, type AccountType, type PayeeType, type SystemAccount, payeeAccount } from './finance.rules';

type Tx = Prisma.TransactionClient;

/** An account a posting line refers to: a system account by code, or a payee's account. */
export type AccountRef = SystemAccount | { payee: PayeeType; id: string; name: string };

export interface PostingLine {
  account: AccountRef;
  debit?: number;
  credit?: number;
}

export interface Posting {
  kind: string;
  /** Unique per business event: posting the same reference twice does nothing. */
  reference: string;
  memo: string;
  sourceType?: string;
  sourceId?: string;
  occurredAt?: Date;
  lines: PostingLine[];
}

/**
 * Double-entry ledger. Postings are balanced (checked here and again by the database at commit),
 * idempotent by reference, and append-only: a mistake is corrected by a reversing posting.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  private async accountId(tx: Tx, ref: AccountRef): Promise<string> {
    const a =
      typeof ref === 'string'
        ? { code: ref, name: SYSTEM_ACCOUNTS[ref].name, type: SYSTEM_ACCOUNTS[ref].type as AccountType, ownerType: null, ownerId: null }
        : { code: payeeAccount(ref.payee, ref.id), name: `Owed to ${ref.name}`, type: 'LIABILITY' as AccountType, ownerType: ref.payee as string, ownerId: ref.id };
    // ON CONFLICT DO NOTHING: concurrent first postings for a new payee can't abort each other's transaction.
    await tx.$executeRaw`
      INSERT INTO "LedgerAccount" (id, code, name, type, "ownerType", "ownerId")
      VALUES (gen_random_uuid(), ${a.code}, ${a.name}, ${a.type}::"LedgerAccountType", ${a.ownerType}, ${a.ownerId}::uuid)
      ON CONFLICT (code) DO NOTHING`;
    const row = await tx.ledgerAccount.findUniqueOrThrow({ where: { code: a.code }, select: { id: true } });
    return row.id;
  }

  /** Writes a balanced posting once. Returns false if this reference was already posted (or nothing to post). */
  async post(tx: Tx, p: Posting): Promise<boolean> {
    const lines = p.lines.filter((l) => (l.debit ?? 0) !== 0 || (l.credit ?? 0) !== 0);
    for (const l of lines) {
      const d = l.debit ?? 0;
      const c = l.credit ?? 0;
      if (!Number.isInteger(d) || !Number.isInteger(c) || d < 0 || c < 0 || (d > 0 && c > 0)) {
        throw new Error(`ledger: bad line in ${p.reference}: debit ${d}, credit ${c}`);
      }
    }
    const debits = lines.reduce((s, l) => s + (l.debit ?? 0), 0);
    const credits = lines.reduce((s, l) => s + (l.credit ?? 0), 0);
    if (debits !== credits) throw new Error(`ledger: ${p.reference} is unbalanced (debits ${debits}, credits ${credits})`);
    if (lines.length < 2) return false;

    // Money leaving a payee's balance is serialised per payee, with the same lock payout approval takes,
    // so a return or refund can't slip in between a payout's balance check and its posting.
    for (const l of lines) {
      if (typeof l.account !== 'string' && (l.debit ?? 0) > 0) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${payeeAccount(l.account.payee, l.account.id)}))`;
    }
    const ids = await Promise.all(lines.map((l) => this.accountId(tx, l.account)));
    const inserted = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "LedgerTransaction" (id, kind, reference, memo, "sourceType", "sourceId", "occurredAt")
      VALUES (gen_random_uuid(), ${p.kind}, ${p.reference}, ${p.memo}, ${p.sourceType ?? null}, ${p.sourceId ?? null}::uuid, ${p.occurredAt ?? new Date()})
      ON CONFLICT (reference) DO NOTHING
      RETURNING id`;
    if (!inserted.length) return false;
    await tx.ledgerEntry.createMany({
      data: lines.map((l, i) => ({ transactionId: inserted[0].id, accountId: ids[i], debitPaise: l.debit ?? 0, creditPaise: l.credit ?? 0 })),
    });
    return true;
  }

  /** The exact opposite of an earlier posting (plus any extra lines), so it nets to zero. False if nothing to reverse. */
  async reverse(tx: Tx, originalReference: string, p: Omit<Posting, 'lines'> & { extraLines?: PostingLine[] }): Promise<boolean> {
    const orig = await tx.ledgerTransaction.findUnique({ where: { reference: originalReference }, include: { entries: { include: { account: true } } } });
    if (!orig) return false;
    const lines: PostingLine[] = orig.entries.map((e) => ({ account: this.refOf(e.account), debit: e.creditPaise, credit: e.debitPaise }));
    return this.post(tx, { ...p, lines: [...lines, ...(p.extraLines ?? [])] });
  }

  private refOf(a: { code: string; name: string; ownerType: string | null; ownerId: string | null }): AccountRef {
    if (a.ownerType && a.ownerId) return { payee: a.ownerType as PayeeType, id: a.ownerId, name: a.name.replace(/^Owed to /, '') };
    return a.code as SystemAccount;
  }

  async has(reference: string, tx: Tx | PrismaService = this.prisma) {
    return (await tx.ledgerTransaction.count({ where: { reference } })) > 0;
  }

  /** Balances of all accounts (or those matching a code prefix), in each account's normal direction. */
  async balances(codePrefix?: string, until?: Date) {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; code: string; name: string; type: AccountType; ownerType: string | null; ownerId: string | null; debit: bigint; credit: bigint }>>`
      SELECT a.id, a.code, a.name, a.type::text AS type, a."ownerType", a."ownerId",
             COALESCE(SUM(e."debitPaise"), 0) AS debit, COALESCE(SUM(e."creditPaise"), 0) AS credit
      FROM "LedgerAccount" a
      LEFT JOIN "LedgerEntry" e ON e."accountId" = a.id ${until ? Prisma.sql`AND e."createdAt" < ${until}` : Prisma.empty}
      ${codePrefix ? Prisma.sql`WHERE a.code LIKE ${codePrefix + '%'}` : Prisma.empty}
      GROUP BY a.id ORDER BY a.code`;
    return rows.map((r) => {
      const debit = Number(r.debit);
      const credit = Number(r.credit);
      return { code: r.code, name: r.name, type: r.type, ownerType: r.ownerType, ownerId: r.ownerId, debitPaise: debit, creditPaise: credit, balancePaise: normalBalance(r.type, debit, credit) };
    });
  }

  /** Balance of one account in its normal direction (0 if it doesn't exist yet). */
  async balance(code: string): Promise<number> {
    return (await this.balances(code)).find((b) => b.code === code)?.balancePaise ?? 0;
  }
}
