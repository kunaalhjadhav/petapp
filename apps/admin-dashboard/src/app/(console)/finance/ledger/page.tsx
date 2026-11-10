import Link from 'next/link';
import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { api } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatDate, formatNumber } from '@/lib/format';
import {
  ACCOUNT_TYPE,
  PAYEE_TYPE,
  accountHref,
  isDay,
  type LedgerBalance,
  type PayeeType,
  type TrialBalance,
} from '@/lib/finance';
import { ErrorNote, Input, NoAccess, PageHeader, Panel, Tag, buttonClass } from '@/components/ui';
import { Amount } from '@/components/finance';
import { Table, Td } from '@/components/table';

export const metadata: Metadata = { title: 'Ledger' };
const TYPE_ORDER = ['ASSET', 'LIABILITY', 'REVENUE', 'EXPENSE'] as const;

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!can(me, PERMISSIONS.FINANCE_READ)) return <NoAccess what="the ledger" />;
  const asOf = isDay(sp.asOf) ? sp.asOf : undefined;
  const tb = await api<TrialBalance>('/admin/finance/trial-balance', { query: { asOf } });
  const system = tb.accounts.filter((a) => !a.ownerType);
  const payees = (t: PayeeType) => tb.accounts.filter((a) => a.ownerType === t);

  return (
    <>
      <PageHeader
        title="Ledger"
        description="PetApp’s double-entry books. Every payment, refund, fee, tax and payout is posted here, and total debits always equal total credits. Open an account to see each posting."
        actions={
          <>
            <form className="flex items-end gap-2" aria-label="Choose a date">
              <label className="flex flex-col gap-1 text-xs text-muted">
                Balances at the end of
                <Input type="date" name="asOf" defaultValue={asOf} className="w-44" />
              </label>
              <button className={buttonClass('secondary')}>Show</button>
              {asOf && (
                <Link href="/finance/ledger" className={buttonClass('quiet')}>
                  Now
                </Link>
              )}
            </form>
            <a
              href={`/finance/ledger/csv${asOf ? `?asOf=${asOf}` : ''}`}
              className={buttonClass('secondary')}
              download
            >
              Download CSV
            </a>
          </>
        }
      />

      {tb.totals.balanced ? (
        <p className="mb-4 text-sm">
          <Tag tone="good">Balanced</Tag>{' '}
          <span className="text-muted">
            Trial balance {asOf ? `at the end of ${formatDate(`${asOf}T00:00:00+05:30`)}` : 'now'}:
            debits and credits are both <Amount paise={tb.totals.debitPaise} />.
          </span>
        </p>
      ) : (
        <div className="mb-4">
          <ErrorNote>
            The books don’t balance: debits <Amount paise={tb.totals.debitPaise} />, credits{' '}
            <Amount paise={tb.totals.creditPaise} />. Run reconciliation and contact engineering.
          </ErrorNote>
        </div>
      )}

      <Panel title="PetApp’s accounts" className="mb-6">
        <Table head={['Account', 'Type', 'Debits', 'Credits', 'Balance']} numeric={[2, 3, 4]}>
          {TYPE_ORDER.flatMap((t) => system.filter((a) => a.type === t)).map((a) => (
            <AccountRow key={a.code} a={a} />
          ))}
        </Table>
      </Panel>

      {(['VENDOR', 'PARTNER', 'USER'] as const).map((t) => {
        const list = payees(t);
        if (!list.length) return null;
        const owed = list.reduce((s, a) => s + a.balancePaise, 0);
        const dr = list.reduce((s, a) => s + a.debitPaise, 0);
        const cr = list.reduce((s, a) => s + a.creditPaise, 0);
        return (
          <Panel
            key={t}
            className="mb-6"
            title={`Owed to ${PAYEE_TYPE[t].toLowerCase()}s`}
            actions={
              <span className="text-sm text-muted">
                {formatNumber(list.length)} account{list.length === 1 ? '' : 's'} ·{' '}
                <Amount paise={owed} strong />
              </span>
            }
          >
            <details>
              <summary className="cursor-pointer px-4 py-3 text-sm text-muted hover:text-ink">
                Debits <Amount paise={dr} /> · Credits <Amount paise={cr} /> · Show each account
              </summary>
              <Table head={['Account', 'Type', 'Debits', 'Credits', 'Balance']} numeric={[2, 3, 4]}>
                {[...list]
                  .sort((a, b) => b.balancePaise - a.balancePaise)
                  .map((a) => (
                    <AccountRow key={a.code} a={a} />
                  ))}
              </Table>
            </details>
          </Panel>
        );
      })}
    </>
  );
}

function AccountRow({ a }: { a: LedgerBalance }) {
  return (
    <tr>
      <Td>
        <Link href={accountHref(a.code)} className="font-medium hover:underline">
          {a.name}
        </Link>
        <p className="font-mono text-xs text-muted">{a.code}</p>
      </Td>
      <Td className="text-muted">{ACCOUNT_TYPE[a.type]}</Td>
      <Td className="text-right">
        <Amount paise={a.debitPaise} />
      </Td>
      <Td className="text-right">
        <Amount paise={a.creditPaise} />
      </Td>
      <Td className="text-right">
        <Amount paise={a.balancePaise} strong />
      </Td>
    </tr>
  );
}
