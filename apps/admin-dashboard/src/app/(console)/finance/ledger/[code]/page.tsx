import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PERMISSIONS } from '@petapp/types';
import { ApiError, api } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatDateTime } from '@/lib/format';
import {
  ACCOUNT_TYPE,
  PAYEE_TYPE,
  TX_KIND,
  label,
  type AccountEntries,
  type PayeeType,
} from '@/lib/finance';
import { Empty, NoAccess, PageHeader, Panel } from '@/components/ui';
import { Amount } from '@/components/finance';
import { Pagination, Table, Td } from '@/components/table';

export const metadata: Metadata = { title: 'Ledger account' };

const ownerHref = (type: string | null, id: string | null) =>
  !type || !id
    ? null
    : type === 'VENDOR'
      ? `/shop/vendors/${id}`
      : type === 'PARTNER'
        ? `/partners/${id}`
        : `/users/${id}`;

export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { code: raw } = await params;
  const sp = await searchParams;
  const code = decodeURIComponent(raw);
  if (!/^[A-Z_]+(:[0-9a-f-]{36})?$/.test(code)) notFound();
  const me = await getMe();
  if (!can(me, PERMISSIONS.FINANCE_READ)) return <NoAccess what="the ledger" />;
  let r: AccountEntries;
  try {
    r = await api<AccountEntries>(`/admin/finance/accounts/${encodeURIComponent(code)}/entries`, {
      query: { page: sp.page, limit: 50 },
    });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const a = r.account;
  const owner = ownerHref(a.ownerType, a.ownerId);

  return (
    <>
      <PageHeader
        back={{ href: '/finance/ledger', label: '← Ledger' }}
        title={a.name}
        description={
          <>
            <span className="font-mono">{a.code}</span> · {ACCOUNT_TYPE[a.type]}
            {a.ownerType && <> · {PAYEE_TYPE[a.ownerType as PayeeType] ?? a.ownerType}</>}
            {owner && (
              <>
                {' '}
                ·{' '}
                <Link href={owner} className="text-teal hover:underline">
                  Open profile
                </Link>
              </>
            )}
          </>
        }
        actions={
          <span className="text-right">
            <span className="block text-xs text-muted">Balance now</span>
            <span className="text-xl">
              <Amount paise={a.balancePaise} strong />
            </span>
          </span>
        }
      />
      <Panel>
        {r.items.length === 0 ? (
          <Empty title="No postings yet" />
        ) : (
          <Table head={['When', 'What', 'Debit', 'Credit']} numeric={[2, 3]}>
            {r.items.map((e) => (
              <tr key={e.id} className="align-top">
                <Td className="whitespace-nowrap text-muted">
                  {formatDateTime(e.transaction.occurredAt)}
                </Td>
                <Td>
                  <Link
                    href={`/finance/transactions/${e.transaction.id}`}
                    className="font-medium hover:underline"
                  >
                    {label(TX_KIND, e.transaction.kind)}
                  </Link>
                  <p className="text-xs text-muted">{e.transaction.memo}</p>
                </Td>
                <Td className="text-right">
                  {e.debitPaise ? <Amount paise={e.debitPaise} /> : ''}
                </Td>
                <Td className="text-right">
                  {e.creditPaise ? <Amount paise={e.creditPaise} /> : ''}
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <Pagination
          meta={r.meta}
          basePath={`/finance/ledger/${encodeURIComponent(code)}`}
          params={{ ...sp }}
        />
      </Panel>
    </>
  );
}
