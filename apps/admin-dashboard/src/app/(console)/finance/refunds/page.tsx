import Link from 'next/link';
import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { apiPage } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatDateTime, formatPhone, timeAgo } from '@/lib/format';
import {
  PAYMENT_PURPOSE,
  REFUND_REASON,
  REFUND_STATUS,
  label,
  type RefundRow,
} from '@/lib/finance';
import { Empty, Field, Input, NoAccess, PageHeader, Panel } from '@/components/ui';
import { ActionDialog } from '@/components/forms';
import { Amount, StatusOf, Tabs } from '@/components/finance';
import { Pagination, Table, Td } from '@/components/table';
import { retryRefund, settleRefundManually } from '../actions';

export const metadata: Metadata = { title: 'Refunds' };
const TABS = [
  { key: 'FAILED', label: 'Failed' },
  { key: 'PENDING', label: 'Waiting to send' },
  { key: 'PROCESSING', label: 'With the gateway' },
  { key: 'PROCESSED', label: 'Refunded' },
  { key: 'SETTLED_MANUALLY', label: 'Paid another way' },
  { key: 'ALL', label: 'All' },
];

export default async function RefundsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!can(me, PERMISSIONS.FINANCE_READ)) return <NoAccess what="refunds" />;
  const manage = can(me, PERMISSIONS.FINANCE_MANAGE);
  const status = TABS.some((t) => t.key === sp.status) ? sp.status! : 'FAILED';
  const { items, meta } = await apiPage<RefundRow>('/admin/finance/refunds', {
    status: status === 'ALL' ? undefined : status,
    page: sp.page,
    limit: 25,
  });

  return (
    <>
      <PageHeader
        title="Refunds"
        description="Money owed back to customers. Refunds go to the gateway automatically and are retried after errors. A refund that keeps failing stops here: send it again, or pay the customer another way and record how."
      />
      <Panel>
        <Tabs
          label="Status"
          tabs={TABS}
          current={status}
          href={(k) => `/finance/refunds?status=${k}`}
        />
        {items.length === 0 ? (
          <Empty title={status === 'FAILED' ? 'No failed refunds' : 'No refunds here'} />
        ) : (
          <Table head={['Customer', 'For', 'Amount', 'Status', 'Owed since', '']} numeric={[2]}>
            {items.map((r) => (
              <tr key={r.id} className="align-top">
                <Td>
                  <Link
                    href={`/users/${r.payment.user.id}`}
                    className="font-medium hover:underline"
                  >
                    {r.payment.user.name ?? 'Customer'}
                  </Link>
                  <p className="text-xs text-muted">{formatPhone(r.payment.user.phone)}</p>
                </Td>
                <Td>
                  <p>{label(REFUND_REASON, r.reason)}</p>
                  <p className="text-xs text-muted">
                    {label(PAYMENT_PURPOSE, r.payment.purpose)} payment{' '}
                    <span className="font-mono">
                      {r.payment.providerPaymentId ?? r.payment.id.slice(0, 8)}
                    </span>
                  </p>
                </Td>
                <Td className="text-right">
                  <Amount paise={r.amountPaise} />
                  {r.amountPaise !== r.payment.amountPaise && (
                    <p className="text-xs text-muted">
                      of <Amount paise={r.payment.amountPaise} />
                    </p>
                  )}
                </Td>
                <Td>
                  <StatusOf map={REFUND_STATUS} status={r.status} />
                  {r.status === 'FAILED' && r.lastError && (
                    <p className="mt-1 max-w-[28ch] text-xs text-danger">{r.lastError}</p>
                  )}
                  {r.status === 'PENDING' && r.attempts > 0 && (
                    <p className="mt-1 text-xs text-muted">
                      {r.attempts} attempt{r.attempts === 1 ? '' : 's'} so far
                      {r.nextAttemptAt ? `; next try ${formatDateTime(r.nextAttemptAt)}` : ''}
                    </p>
                  )}
                  {r.status === 'PROCESSED' && r.providerRefundId && (
                    <p className="mt-1 font-mono text-xs text-muted">{r.providerRefundId}</p>
                  )}
                  {r.status === 'SETTLED_MANUALLY' && r.manualReference && (
                    <p className="mt-1 text-xs text-muted">{r.manualReference}</p>
                  )}
                </Td>
                <Td className="whitespace-nowrap text-muted">
                  <span title={formatDateTime(r.createdAt)}>{timeAgo(r.createdAt)}</span>
                </Td>
                <Td>
                  {manage && r.status === 'FAILED' && (
                    <div className="flex flex-wrap justify-end gap-2">
                      <ActionDialog
                        label="Send again"
                        size="sm"
                        title="Send this refund again?"
                        description={
                          <>
                            <Amount paise={r.amountPaise} /> to{' '}
                            {r.payment.user.name ?? 'the customer'}. It goes back in the queue with
                            a fresh set of attempts. The gateway is checked first, so it can’t be
                            paid twice.
                          </>
                        }
                        submitLabel="Send again"
                        action={retryRefund.bind(null, r.id)}
                      />
                      <ActionDialog
                        label="Paid another way"
                        size="sm"
                        title="Record a refund paid outside the gateway"
                        description={
                          <>
                            Only if {r.payment.user.name ?? 'the customer'} has already received{' '}
                            <Amount paise={r.amountPaise} />, e.g. by bank transfer. The refund is
                            then closed and won’t be sent again.
                          </>
                        }
                        submitLabel="Record as paid"
                        action={settleRefundManually.bind(null, r.id)}
                      >
                        <Field
                          label="How it was paid"
                          htmlFor={`ref-${r.id}`}
                          hint="The bank transfer’s UTR, a cheque number or similar"
                        >
                          <Input
                            id={`ref-${r.id}`}
                            name="reference"
                            required
                            minLength={4}
                            maxLength={200}
                          />
                        </Field>
                      </ActionDialog>
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <Pagination meta={meta} basePath="/finance/refunds" params={{ ...sp, status }} />
      </Panel>
    </>
  );
}
