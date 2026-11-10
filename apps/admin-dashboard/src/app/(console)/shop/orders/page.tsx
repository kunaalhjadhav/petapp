import Link from 'next/link';
import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { apiPage } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { timeAgo } from '@/lib/format';
import { formatPaise } from '@/lib/money';
import type { AdminSubOrderRow } from '@/lib/types';
import { Empty, NoAccess, PageHeader, Panel, Select, Tag, buttonClass } from '@/components/ui';
import { Pagination, Table, Td } from '@/components/table';
import { PARCEL } from '../labels';

export const metadata: Metadata = { title: 'Shop orders' };

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!can(me, PERMISSIONS.MARKETPLACE_READ)) return <NoAccess what="orders" />;
  const { items, meta } = await apiPage<AdminSubOrderRow>('/admin/orders', {
    status: sp.status,
    vendorId: sp.vendorId,
    page: sp.page,
    limit: 25,
  });
  return (
    <>
      <PageHeader
        title="Shop orders"
        description="Every parcel, across all vendors. One customer order can have a parcel from each vendor."
      />
      <Panel>
        <form className="flex flex-wrap items-end gap-3 border-b border-line-soft px-4 py-3">
          {sp.vendorId && <input type="hidden" name="vendorId" value={sp.vendorId} />}
          <div>
            <label htmlFor="status" className="sr-only">
              Status
            </label>
            <Select id="status" name="status" defaultValue={sp.status ?? ''}>
              <option value="">Any status</option>
              {Object.entries(PARCEL)
                .filter(([k]) => k !== 'PENDING_PAYMENT')
                .map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
            </Select>
          </div>
          <button className={buttonClass('secondary')}>Apply</button>
          {sp.vendorId && (
            <Link href="/shop/orders" className="text-sm text-teal hover:underline">
              All vendors
            </Link>
          )}
        </form>
        {items.length === 0 ? (
          <Empty title="No orders match" />
        ) : (
          <Table head={['Parcel', 'Customer', 'Vendor', 'Items', 'Total', 'PetApp fee', 'Status']}>
            {items.map((s) => (
              <tr key={s.id}>
                <Td>
                  <span className="font-mono text-xs">{s.code}</span>
                  <span className="block text-xs text-muted">
                    order {s.order.code} · {timeAgo(s.createdAt)}
                  </span>
                  {s.trackingNumber && (
                    <span className="block text-xs text-muted">
                      {s.courier} {s.trackingNumber}
                    </span>
                  )}
                </Td>
                <Td>
                  <Link href={`/users/${s.order.user.id}`} className="hover:underline">
                    {s.order.user.name ?? 'Customer'}
                  </Link>
                </Td>
                <Td>
                  <Link href={`/shop/vendors/${s.vendor.id}`} className="hover:underline">
                    {s.vendor.businessName}
                  </Link>
                </Td>
                <Td className="text-sm">
                  {s.items
                    .map((i) => `${i.qty} × ${i.productTitle} (${i.variantTitle})`)
                    .join(', ')}
                </Td>
                <Td className="whitespace-nowrap">{formatPaise(s.totalPaise)}</Td>
                <Td className="whitespace-nowrap text-muted">{formatPaise(s.commissionPaise)}</Td>
                <Td>
                  <Tag tone={PARCEL[s.status]?.tone ?? 'neutral'}>
                    {PARCEL[s.status]?.label ?? s.status}
                  </Tag>
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <Pagination meta={meta} basePath="/shop/orders" params={sp} />
      </Panel>
    </>
  );
}
