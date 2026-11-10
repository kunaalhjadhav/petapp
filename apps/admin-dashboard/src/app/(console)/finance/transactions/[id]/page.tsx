import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PERMISSIONS } from '@petapp/types';
import { ApiError, api } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatDateTime } from '@/lib/format';
import { TX_KIND, accountHref, label, referenceHref, type LedgerTxDetail } from '@/lib/finance';
import { Facts, NoAccess, PageHeader, Panel } from '@/components/ui';
import { Amount } from '@/components/finance';
import { Table, Td } from '@/components/table';

export const metadata: Metadata = { title: 'Ledger posting' };

export default async function TransactionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  if (!can(me, PERMISSIONS.FINANCE_READ)) return <NoAccess what="the ledger" />;
  let t: LedgerTxDetail;
  try {
    t = await api<LedgerTxDetail>(`/admin/finance/transactions/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
  const dr = t.entries.reduce((a, e) => a + e.debitPaise, 0);
  const cr = t.entries.reduce((a, e) => a + e.creditPaise, 0);
  const source = t.sourceType && t.sourceId ? `${t.sourceType}:${t.sourceId}` : null;
  const sourceHref = referenceHref(source);

  return (
    <>
      <PageHeader
        back={{ href: '/finance/ledger', label: '← Ledger' }}
        title={label(TX_KIND, t.kind)}
        description={t.memo}
      />
      <Panel className="mb-6">
        <Facts
          items={[
            ['When', formatDateTime(t.occurredAt)],
            ['Posted', formatDateTime(t.createdAt)],
            [
              'Reference',
              <span key="r" className="font-mono text-xs">
                {t.reference}
              </span>,
            ],
            [
              'About',
              source ? (
                sourceHref ? (
                  <Link href={sourceHref} className="font-mono text-xs text-teal hover:underline">
                    {source}
                  </Link>
                ) : (
                  <span className="font-mono text-xs">{source}</span>
                )
              ) : (
                '—'
              ),
            ],
          ]}
        />
      </Panel>
      <Panel title="Lines">
        <Table head={['Account', 'Debit', 'Credit']} numeric={[1, 2]}>
          {t.entries.map((e) => (
            <tr key={e.id}>
              <Td>
                <Link href={accountHref(e.account.code)} className="font-medium hover:underline">
                  {e.account.name}
                </Link>
                <p className="font-mono text-xs text-muted">{e.account.code}</p>
              </Td>
              <Td className="text-right">{e.debitPaise ? <Amount paise={e.debitPaise} /> : ''}</Td>
              <Td className="text-right">
                {e.creditPaise ? <Amount paise={e.creditPaise} /> : ''}
              </Td>
            </tr>
          ))}
          <tr>
            <Td className="font-medium">Total</Td>
            <Td className="text-right">
              <Amount paise={dr} strong />
            </Td>
            <Td className="text-right">
              <Amount paise={cr} strong />
            </Td>
          </tr>
        </Table>
      </Panel>
    </>
  );
}
