import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PERMISSIONS } from '@petapp/types';
import { ApiError, api } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatDateTime, formatNumber } from '@/lib/format';
import {
  BATCH_STATUS,
  PAYEE_TYPE,
  PAYOUT_STATUS,
  describeAccount,
  type BatchDetail,
} from '@/lib/finance';
import { Facts, NoAccess, PageHeader, Panel, Tag } from '@/components/ui';
import { ActionDialog } from '@/components/forms';
import { Amount, Stat, Stats, StatusOf } from '@/components/finance';
import { Table, Td } from '@/components/table';
import { approveBatch, cancelBatch } from '../../actions';

export const metadata: Metadata = { title: 'Payout batch' };

export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  if (!can(me, PERMISSIONS.FINANCE_READ)) return <NoAccess what="payouts" />;
  let b: BatchDetail;
  try {
    b = await api<BatchDetail>(`/admin/finance/payout-batches/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
  const manage = can(me, PERMISSIONS.FINANCE_MANAGE);
  const mine = b.createdById === me.id;
  const draft = b.status === 'DRAFT';
  const active = b.payouts.filter((p) => p.status !== 'CANCELLED');

  return (
    <>
      <PageHeader
        back={{ href: '/finance/payouts', label: '← Payouts' }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {b.code} <StatusOf map={BATCH_STATUS} status={b.status} />
          </span>
        }
        description={b.note ?? undefined}
        actions={
          manage &&
          draft && (
            <>
              <ActionDialog
                label="Cancel batch"
                title="Cancel this batch?"
                description="Nobody in it is paid. Their balances stay payable and will be in the next batch."
                submitLabel="Cancel batch"
                danger
                action={cancelBatch.bind(null, b.id)}
              />
              {mine ? (
                <span className="text-sm text-muted">
                  You prepared this batch, so someone else must approve it.
                </span>
              ) : (
                <ActionDialog
                  label="Approve and pay"
                  variant="primary"
                  title="Approve this batch?"
                  description={
                    <>
                      <Amount paise={b.totals.totalPaise} strong /> to{' '}
                      {formatNumber(b.totals.count)} payee{b.totals.count === 1 ? '' : 's'} will be
                      sent to their bank accounts. Each balance is checked again first; anyone whose
                      balance or account changed since the batch was prepared is left out. This
                      can’t be undone.
                    </>
                  }
                  submitLabel="Approve and pay"
                  action={approveBatch.bind(null, b.id)}
                />
              )}
            </>
          )
        }
      />

      <Stats>
        <Stat
          label="In this batch"
          paise={b.totals.totalPaise}
          hint={`${formatNumber(active.length)} payees`}
        />
        <Stat label="Paid" paise={b.totals.paidPaise} />
        <Stat label="On its way" paise={b.totals.inFlightPaise} />
        <Stat
          label="Not paid"
          paise={b.totals.failedPaise}
          hint="Back on the payee’s balance for the next batch"
          tone={b.totals.failedPaise ? 'danger' : undefined}
        />
      </Stats>

      <Panel className="my-6">
        <Facts
          items={[
            [
              'Prepared',
              `${formatDateTime(b.createdAt)} by ${mine ? 'you' : (b.createdBy?.name ?? 'a staff member')}`,
            ],
            [
              'Approved',
              b.approvedAt
                ? `${formatDateTime(b.approvedAt)} by ${b.approvedById === me.id ? 'you' : (b.approvedBy?.name ?? 'a staff member')}`
                : draft
                  ? 'Not yet'
                  : '—',
            ],
            [
              b.cancelledAt ? 'Cancelled' : 'Finished',
              formatDateTime(b.completedAt ?? b.cancelledAt),
            ],
          ]}
        />
      </Panel>

      <Panel title="Payouts">
        <Table head={['Payee', 'Paid to', 'Amount', 'Status', 'Bank reference']} numeric={[2]}>
          {b.payouts.map((p) => {
            const href =
              p.payeeType === 'VENDOR'
                ? `/shop/vendors/${p.payeeId}`
                : p.payeeType === 'PARTNER'
                  ? `/partners/${p.payeeId}`
                  : `/users/${p.payeeId}`;
            const bankName = p.account.verifiedName;
            return (
              <tr key={p.id} className="align-top">
                <Td>
                  <Link href={href} className="font-medium hover:underline">
                    {p.payeeName}
                  </Link>
                  <p className="text-xs text-muted">
                    {PAYEE_TYPE[p.payeeType]}
                    {p.purpose === 'PRIZE' ? ' · prize' : ''}
                  </p>
                </Td>
                <Td>
                  <p className="whitespace-nowrap">{describeAccount(p.account)}</p>
                  <p className="text-xs text-muted">{bankName ?? p.account.holderName}</p>
                </Td>
                <Td className="text-right">
                  <Amount paise={p.amountPaise} />
                </Td>
                <Td>
                  <StatusOf map={PAYOUT_STATUS} status={p.status} />
                  {p.failureReason && (
                    <p className="mt-1 max-w-[30ch] text-xs text-muted">{p.failureReason}</p>
                  )}
                  {!p.failureReason && p.lastError && p.status !== 'PROCESSED' && (
                    <p className="mt-1 max-w-[30ch] text-xs text-warn">{p.lastError}</p>
                  )}
                </Td>
                <Td className="font-mono text-xs">
                  {p.utr ?? (p.status === 'PROCESSED' ? <Tag>—</Tag> : '')}
                  {p.processedAt && (
                    <p className="font-sans text-muted">{formatDateTime(p.processedAt)}</p>
                  )}
                </Td>
              </tr>
            );
          })}
        </Table>
      </Panel>
    </>
  );
}
