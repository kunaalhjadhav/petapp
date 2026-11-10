import Link from 'next/link';
import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { apiPage } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { timeAgo } from '@/lib/format';
import { PARTNER_STATUS } from '@/lib/labels';
import type { VendorRow } from '@/lib/types';
import { Empty, NoAccess, PageHeader, Panel, Tag } from '@/components/ui';
import { Pagination, Table, Td } from '@/components/table';

export const metadata: Metadata = { title: 'Vendors' };
const TABS = ['SUBMITTED', 'APPROVED', 'REJECTED', 'SUSPENDED', 'DRAFT'] as const;
const TAB_LABEL: Record<string, string> = {
  SUBMITTED: 'Waiting for review',
  APPROVED: 'Approved',
  REJECTED: 'Changes needed',
  SUSPENDED: 'Suspended',
  DRAFT: 'Not submitted',
};

export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!can(me, PERMISSIONS.MARKETPLACE_READ)) return <NoAccess what="vendors" />;
  const status = (TABS as readonly string[]).includes(sp.status ?? '') ? sp.status! : 'SUBMITTED';
  const { items, meta } = await apiPage<VendorRow>('/admin/vendors', {
    status,
    page: sp.page,
    limit: 25,
  });
  return (
    <>
      <PageHeader
        title="Vendors"
        description="Stores selling on PetApp. Check their documents before they can list products."
      />
      <Panel>
        <nav
          aria-label="Status"
          className="flex flex-wrap gap-1 border-b border-line-soft px-4 py-2"
        >
          {TABS.map((t) => (
            <Link
              key={t}
              href={`/shop/vendors?status=${t}`}
              aria-current={status === t ? 'page' : undefined}
              className={`rounded px-3 py-1.5 text-sm ${status === t ? 'bg-teal-wash font-medium text-teal' : 'text-muted hover:text-ink'}`}
            >
              {TAB_LABEL[t]}
            </Link>
          ))}
        </nav>
        {items.length === 0 ? (
          <Empty title={status === 'SUBMITTED' ? 'No stores waiting for review' : 'None here'} />
        ) : (
          <Table
            head={[
              'Store',
              'City',
              'GSTIN',
              'Products',
              status === 'SUBMITTED' ? 'Submitted' : 'Status',
            ]}
          >
            {items.map((v) => (
              <tr key={v.id} className="hover:bg-paper">
                <Td>
                  <Link href={`/shop/vendors/${v.id}`} className="font-medium hover:underline">
                    {v.businessName}
                  </Link>
                </Td>
                <Td className="text-muted">{v.city}</Td>
                <Td className="font-mono text-xs">{v.gstin ?? '—'}</Td>
                <Td>{v.products}</Td>
                <Td className="whitespace-nowrap text-muted">
                  {status === 'SUBMITTED' && v.submittedAt ? (
                    timeAgo(v.submittedAt)
                  ) : (
                    <Tag tone={PARTNER_STATUS[v.status].tone}>{PARTNER_STATUS[v.status].label}</Tag>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <Pagination meta={meta} basePath="/shop/vendors" params={{ ...sp, status }} />
      </Panel>
    </>
  );
}
