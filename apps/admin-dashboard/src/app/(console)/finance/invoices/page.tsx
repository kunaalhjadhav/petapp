import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { apiPage } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatDate } from '@/lib/format';
import { INVOICE_KIND, lastMonth, monthName, type InvoiceRow } from '@/lib/finance';
import { Empty, Field, Input, NoAccess, PageHeader, Panel, Tag } from '@/components/ui';
import { ActionDialog } from '@/components/forms';
import { Amount, Tabs } from '@/components/finance';
import { Pagination, Table, Td } from '@/components/table';
import { issueCommissionInvoices } from '../actions';

export const metadata: Metadata = { title: 'Invoices' };
const TABS = [
  { key: 'ALL', label: 'All' },
  { key: 'CUSTOMER', label: 'To customers' },
  { key: 'CREDIT_NOTE', label: 'Credit notes' },
  { key: 'COMMISSION', label: 'PetApp commission' },
];

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!can(me, PERMISSIONS.FINANCE_READ)) return <NoAccess what="invoices" />;
  const manage = can(me, PERMISSIONS.FINANCE_MANAGE);
  const kind = TABS.some((t) => t.key === sp.kind) ? sp.kind! : 'ALL';
  const { items, meta } = await apiPage<InvoiceRow>('/admin/finance/invoices', {
    kind: kind === 'ALL' ? undefined : kind,
    page: sp.page,
    limit: 25,
  });
  const prev = lastMonth();

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Tax invoices issued on behalf of sellers and partners when a parcel is delivered or a visit is completed, credit notes for refunded returns, and PetApp’s monthly commission invoices to sellers and partners. Numbers are consecutive and issued invoices can’t be changed."
        actions={
          manage && (
            <ActionDialog
              label="Issue commission invoices"
              title="Issue commission invoices"
              description="One invoice from PetApp to each seller and partner for the fees charged in the month. Only for a month that is over. Running it again for the same month issues only what’s missing."
              submitLabel="Issue invoices"
              action={issueCommissionInvoices}
            >
              <Field label="Month" htmlFor="month" hint={`Usually last month: ${monthName(prev)}`}>
                <Input
                  id="month"
                  name="month"
                  type="month"
                  required
                  defaultValue={prev}
                  max={prev}
                />
              </Field>
            </ActionDialog>
          )
        }
      />
      <Panel>
        <Tabs label="Kind" tabs={TABS} current={kind} href={(k) => `/finance/invoices?kind=${k}`} />
        {items.length === 0 ? (
          <Empty title="No invoices here" />
        ) : (
          <Table head={['Number', 'Kind', 'From', 'To', 'Date', 'Total', '']} numeric={[5]}>
            {items.map((i) => (
              <tr key={i.id} className="align-top">
                <Td className="whitespace-nowrap font-mono text-xs">{i.number}</Td>
                <Td>
                  {INVOICE_KIND[i.kind]}
                  {i.title === 'BILL_OF_SUPPLY' && (
                    <p className="mt-1">
                      <Tag>Bill of supply</Tag>
                    </p>
                  )}
                </Td>
                <Td>
                  {i.issuer.name ?? '—'}
                  {i.issuer.gstin && (
                    <p className="font-mono text-xs text-muted">{i.issuer.gstin}</p>
                  )}
                </Td>
                <Td>
                  {i.recipient.name ?? '—'}
                  {i.recipient.gstin && (
                    <p className="font-mono text-xs text-muted">{i.recipient.gstin}</p>
                  )}
                </Td>
                <Td className="whitespace-nowrap text-muted">{formatDate(i.issuedAt)}</Td>
                <Td className="text-right">
                  <Amount paise={i.kind === 'CREDIT_NOTE' ? -i.totalPaise : i.totalPaise} />
                </Td>
                <Td>
                  <a
                    href={`/finance/invoices/${i.id}/pdf`}
                    target="_blank"
                    rel="noopener"
                    className="whitespace-nowrap text-sm text-teal hover:underline"
                    aria-label={`PDF of ${i.number}`}
                  >
                    PDF
                  </a>
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <Pagination meta={meta} basePath="/finance/invoices" params={{ ...sp, kind }} />
      </Panel>
    </>
  );
}
