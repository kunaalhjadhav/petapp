import Link from 'next/link';
import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { apiPage } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatDateTime, timeAgo } from '@/lib/format';
import { ACCOUNT_STATUS, PAYEE_TYPE, describeAccount, type PayoutAccountRow } from '@/lib/finance';
import { Empty, NoAccess, PageHeader, Panel, Tag, inputClass } from '@/components/ui';
import { ActionDialog } from '@/components/forms';
import { StatusOf, Tabs } from '@/components/finance';
import { Pagination, Table, Td } from '@/components/table';
import { disablePayoutAccount } from '../actions';

export const metadata: Metadata = { title: 'Payout accounts' };
const STATUSES = [
  { key: 'VERIFIED', label: 'Verified' },
  { key: 'PENDING', label: 'Being checked' },
  { key: 'FAILED', label: 'Bank refused' },
  { key: 'DISABLED', label: 'Switched off' },
  { key: 'ALL', label: 'All' },
];
const OWNERS = ['VENDOR', 'PARTNER', 'USER'] as const;

const ownerHref = (a: PayoutAccountRow) =>
  a.ownerType === 'VENDOR'
    ? `/shop/vendors/${a.ownerId}`
    : a.ownerType === 'PARTNER'
      ? `/partners/${a.ownerId}`
      : `/users/${a.ownerId}`;

export default async function PayoutAccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!can(me, PERMISSIONS.FINANCE_READ)) return <NoAccess what="payout accounts" />;
  const manage = can(me, PERMISSIONS.FINANCE_MANAGE);
  const status = STATUSES.some((s) => s.key === sp.status) ? sp.status! : 'VERIFIED';
  const owner = (OWNERS as readonly string[]).includes(sp.owner ?? '') ? sp.owner : undefined;
  const { items, meta } = await apiPage<PayoutAccountRow>('/admin/finance/payout-accounts', {
    status: status === 'ALL' ? undefined : status,
    ownerType: owner,
    page: sp.page,
    limit: 25,
  });
  const q = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ status, owner, ...o })) if (v) p.set(k, v);
    return `/finance/payout-accounts?${p}`;
  };
  const now = Date.now();

  return (
    <>
      <PageHeader
        title="Payout accounts"
        description="Bank accounts and UPI IDs that sellers, partners and prize winners are paid to. Each is checked with the bank, which returns the holder’s name. Full account numbers are encrypted and never shown."
      />
      <Panel>
        <Tabs
          label="Status"
          tabs={STATUSES}
          current={status}
          href={(k) => q({ status: k, page: undefined })}
        />
        <div className="flex gap-3 border-b border-line-soft px-4 py-2 text-sm">
          <span className="text-muted">Whose:</span>
          {[undefined, ...OWNERS].map((o) => (
            <Link
              key={o ?? 'any'}
              href={q({ owner: o })}
              aria-current={owner === o ? 'true' : undefined}
              className={owner === o ? 'font-medium text-teal' : 'text-muted hover:text-ink'}
            >
              {o ? PAYEE_TYPE[o] + 's' : 'Everyone'}
            </Link>
          ))}
        </div>
        {items.length === 0 ? (
          <Empty title="No accounts here" />
        ) : (
          <Table head={['Payee', 'Account', 'Name at the bank', 'Status', 'Added', '']}>
            {items.map((a) => {
              const held =
                a.status === 'VERIFIED' && a.payableFrom && Date.parse(a.payableFrom) > now;
              return (
                <tr key={a.id} className="align-top">
                  <Td>
                    <Link href={ownerHref(a)} className="font-medium hover:underline">
                      {a.ownerName ?? 'Unknown'}
                    </Link>
                    <p className="text-xs text-muted">{PAYEE_TYPE[a.ownerType]}</p>
                  </Td>
                  <Td>
                    <p className="whitespace-nowrap">{describeAccount(a)}</p>
                    <p className="text-xs text-muted">Entered as {a.holderName}</p>
                  </Td>
                  <Td>
                    {a.verifiedName ?? <span className="text-muted">—</span>}
                    {a.nameMatches === false && (
                      <p className="mt-1">
                        <Tag tone="warn">Not the payee’s name</Tag>
                      </p>
                    )}
                  </Td>
                  <Td>
                    <StatusOf map={ACCOUNT_STATUS} status={a.status} />
                    {held && (
                      <p className="mt-1 text-xs text-warn">
                        Safety hold until {formatDateTime(a.payableFrom)}
                      </p>
                    )}
                    {a.failureReason && (
                      <p className="mt-1 max-w-[30ch] text-xs text-muted">{a.failureReason}</p>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-muted">
                    <span title={formatDateTime(a.createdAt)}>{timeAgo(a.createdAt)}</span>
                  </Td>
                  <Td>
                    {manage && (a.status === 'VERIFIED' || a.status === 'PENDING') && (
                      <ActionDialog
                        label="Switch off"
                        size="sm"
                        danger
                        title="Switch off this account?"
                        description={
                          <>
                            Nothing more is paid to {describeAccount(a)}, including payouts already
                            approved but not yet sent. {a.ownerName ?? 'The payee'} will need to add
                            an account again. Use this when an account is reported as not theirs.
                          </>
                        }
                        submitLabel="Switch off"
                        action={disablePayoutAccount.bind(null, a.id)}
                      >
                        <label htmlFor={`why-${a.id}`} className="text-sm font-medium">
                          Reason (kept in the audit log)
                        </label>
                        <textarea
                          id={`why-${a.id}`}
                          name="reason"
                          required
                          minLength={3}
                          maxLength={300}
                          rows={3}
                          className={`${inputClass} h-auto py-2`}
                        />
                      </ActionDialog>
                    )}
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
        <Pagination
          meta={meta}
          basePath="/finance/payout-accounts"
          params={{ ...sp, status, owner }}
        />
      </Panel>
    </>
  );
}
