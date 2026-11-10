import Link from 'next/link';
import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { api, apiPage } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatDateTime, formatNumber, timeAgo } from '@/lib/format';
import {
  BATCH_STATUS,
  PAYEE_TYPE,
  referenceHref,
  type BatchRow,
  type PayeeType,
  type PayoutPreview,
} from '@/lib/finance';
import { Empty, Field, Input, NoAccess, PageHeader, Panel, Select } from '@/components/ui';
import { ActionDialog } from '@/components/forms';
import { Amount, StatusOf, Tabs } from '@/components/finance';
import { Pagination, Table, Td } from '@/components/table';
import { prepareBatch } from '../actions';

export const metadata: Metadata = { title: 'Payouts' };
const TYPES = [
  { key: 'ALL', label: 'Everyone' },
  { key: 'VENDOR', label: 'Sellers' },
  { key: 'PARTNER', label: 'Service partners' },
  { key: 'USER', label: 'Prize winners' },
];

export default async function PayoutsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!can(me, PERMISSIONS.FINANCE_READ)) return <NoAccess what="payouts" />;
  const manage = can(me, PERMISSIONS.FINANCE_MANAGE);
  const type = TYPES.some((t) => t.key === sp.type) ? sp.type! : 'ALL';
  const payeeType = type === 'ALL' ? undefined : (type as PayeeType);
  const [preview, { items, meta }] = await Promise.all([
    api<PayoutPreview>('/admin/finance/payouts/preview', { query: { payeeType } }),
    apiPage<BatchRow>('/admin/finance/payout-batches', { page: sp.page, limit: 20 }),
  ]);
  const waiting = items.filter((b) => b.status === 'DRAFT');

  return (
    <>
      <PageHeader
        title="Payouts"
        description="Sellers, service partners and prize winners are paid in batches. One finance person prepares a batch; a different person approves it before any money moves."
        actions={
          manage && (
            <ActionDialog
              label="Prepare a batch"
              variant="primary"
              title="Prepare a payout batch"
              description="Everyone due at least the minimum payout, with a verified account, is included at their payable balance now. Nothing is paid until someone else approves the batch."
              submitLabel="Prepare batch"
              action={prepareBatch}
            >
              <Field label="Who to pay" htmlFor="payeeType">
                <Select id="payeeType" name="payeeType" defaultValue={payeeType ?? ''}>
                  <option value="">Everyone due a payout</option>
                  <option value="VENDOR">Sellers only</option>
                  <option value="PARTNER">Service partners only</option>
                  <option value="USER">Prize winners only</option>
                </Select>
              </Field>
              <Field
                label="Note (optional)"
                htmlFor="note"
                hint="For the approver, e.g. “Weekly payout”"
              >
                <Input id="note" name="note" maxLength={200} />
              </Field>
            </ActionDialog>
          )
        }
      />

      {waiting.length > 0 && (
        <Panel title="Waiting for approval" className="mb-6">
          <ul className="divide-y divide-line-soft">
            {waiting.map((b) => (
              <li
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
              >
                <span>
                  <Link href={`/finance/payouts/${b.id}`} className="font-medium hover:underline">
                    {b.code}
                  </Link>{' '}
                  <span className="text-sm text-muted">
                    {formatNumber(b._count.payouts)} payee{b._count.payouts === 1 ? '' : 's'} ·
                    prepared {timeAgo(b.createdAt)}
                    {b.createdById === me.id
                      ? ' by you (someone else must approve it)'
                      : b.createdBy
                        ? ` by ${b.createdBy.name}`
                        : ''}
                  </span>
                </span>
                <Amount paise={b.totalPaise} strong />
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel
        title="Due now"
        className="mb-6"
        actions={
          <span className="text-sm">
            {formatNumber(preview.count)} payee{preview.count === 1 ? '' : 's'} ·{' '}
            <Amount paise={preview.totalPaise} strong />
          </span>
        }
      >
        <Tabs
          label="Payee type"
          tabs={TYPES}
          current={type}
          href={(k) => `/finance/payouts?type=${k}`}
        />
        {preview.payees.length === 0 ? (
          <Empty title="Nobody is due a payout right now">
            Earnings become payable after the return window. Payees also need a verified bank
            account or UPI ID, and can’t already have a payout on its way.
          </Empty>
        ) : (
          <Table head={['Payee', 'Type', 'Payable now']} numeric={[2]}>
            {preview.payees.map((p) => {
              const href =
                referenceHref(`${p.type}:${p.id}`) ?? (p.type === 'USER' ? `/users/${p.id}` : null);
              return (
                <tr key={`${p.type}:${p.id}`}>
                  <Td>
                    {href ? (
                      <Link href={href} className="font-medium hover:underline">
                        {p.name}
                      </Link>
                    ) : (
                      p.name
                    )}
                  </Td>
                  <Td className="text-muted">{PAYEE_TYPE[p.type]}</Td>
                  <Td className="text-right">
                    <Amount paise={p.amountPaise} />
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Panel>

      <Panel title="Batches">
        {items.length === 0 ? (
          <Empty title="No batches yet" />
        ) : (
          <Table
            head={['Batch', 'Status', 'Payees', 'Total', 'Prepared', 'Approved']}
            numeric={[3]}
          >
            {items.map((b) => (
              <tr key={b.id}>
                <Td>
                  <Link href={`/finance/payouts/${b.id}`} className="font-medium hover:underline">
                    {b.code}
                  </Link>
                  {b.note && <p className="text-xs text-muted">{b.note}</p>}
                </Td>
                <Td>
                  <StatusOf map={BATCH_STATUS} status={b.status} />
                </Td>
                <Td className="tabular-nums">{formatNumber(b._count.payouts)}</Td>
                <Td className="text-right">
                  <Amount paise={b.totalPaise} />
                </Td>
                <Td className="whitespace-nowrap text-muted">
                  {formatDateTime(b.createdAt)}
                  {b.createdBy && <p className="text-xs">{b.createdBy.name}</p>}
                </Td>
                <Td className="whitespace-nowrap text-muted">
                  {formatDateTime(b.approvedAt)}
                  {b.approvedBy && <p className="text-xs">{b.approvedBy.name}</p>}
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <Pagination meta={meta} basePath="/finance/payouts" params={{ ...sp }} />
      </Panel>
    </>
  );
}
