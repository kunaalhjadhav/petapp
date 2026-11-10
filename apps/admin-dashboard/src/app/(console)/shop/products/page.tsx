import Link from 'next/link';
import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { apiPage } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { timeAgo } from '@/lib/format';
import { formatPaise } from '@/lib/money';
import type { AdminProductRow } from '@/lib/types';
import {
  Empty,
  Input,
  NoAccess,
  PageHeader,
  Panel,
  Select,
  Tag,
  buttonClass,
  inputClass,
} from '@/components/ui';
import { ActionDialog } from '@/components/forms';
import { Pagination, Table, Td } from '@/components/table';
import { blockProduct } from '../actions';

export const metadata: Metadata = { title: 'Products' };
const STATUS: Record<string, { label: string; tone: 'neutral' | 'good' | 'warn' | 'danger' }> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  ACTIVE: { label: 'In the shop', tone: 'good' },
  INACTIVE: { label: 'Hidden by vendor', tone: 'neutral' },
  BLOCKED: { label: 'Blocked', tone: 'danger' },
};

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!can(me, PERMISSIONS.MARKETPLACE_READ)) return <NoAccess what="products" />;
  const { items, meta } = await apiPage<AdminProductRow>('/admin/products', {
    status: sp.status,
    vendorId: sp.vendorId,
    q: sp.q,
    page: sp.page,
    limit: 25,
  });
  const manage = can(me, PERMISSIONS.MARKETPLACE_MANAGE);
  return (
    <>
      <PageHeader
        title="Products"
        description="Everything vendors list. Block anything unsafe, misleading or against the rules; the vendor sees your reason."
      />
      <Panel>
        <form className="flex flex-wrap items-end gap-3 border-b border-line-soft px-4 py-3">
          {sp.vendorId && <input type="hidden" name="vendorId" value={sp.vendorId} />}
          <div className="min-w-56 flex-1">
            <label htmlFor="q" className="sr-only">
              Search
            </label>
            <Input id="q" name="q" defaultValue={sp.q} placeholder="Search by title" />
          </div>
          <div>
            <label htmlFor="status" className="sr-only">
              Status
            </label>
            <Select id="status" name="status" defaultValue={sp.status ?? ''}>
              <option value="">Any status</option>
              {Object.entries(STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          </div>
          <button className={buttonClass('secondary')}>Apply</button>
          {sp.vendorId && (
            <Link href="/shop/products" className="text-sm text-teal hover:underline">
              All vendors
            </Link>
          )}
        </form>
        {items.length === 0 ? (
          <Empty title="No products match" />
        ) : (
          <Table head={['Product', 'Vendor', 'Price', 'Stock', 'Status', '']}>
            {items.map((p) => {
              const active = p.variants.filter((v) => v.isActive);
              const prices = active.map((v) => v.pricePaise);
              return (
                <tr key={p.id} className="hover:bg-paper">
                  <Td>
                    <span className="font-medium">{p.title}</span>
                    <span className="block text-xs text-muted">
                      {[
                        p.brand,
                        p.category.name,
                        `${active.length} variant${active.length === 1 ? '' : 's'}`,
                        `updated ${timeAgo(p.updatedAt)}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    {p.blockReason && (
                      <span className="block text-xs text-danger">Blocked: {p.blockReason}</span>
                    )}
                  </Td>
                  <Td>
                    <Link href={`/shop/vendors/${p.vendor.id}`} className="hover:underline">
                      {p.vendor.businessName}
                    </Link>
                  </Td>
                  <Td className="whitespace-nowrap">
                    {prices.length
                      ? Math.min(...prices) === Math.max(...prices)
                        ? formatPaise(prices[0])
                        : `${formatPaise(Math.min(...prices))} – ${formatPaise(Math.max(...prices))}`
                      : '—'}
                  </Td>
                  <Td>{active.reduce((a, v) => a + v.stock, 0)}</Td>
                  <Td>
                    <Tag tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Tag>
                  </Td>
                  <Td>
                    {manage && p.status !== 'BLOCKED' && (
                      <ActionDialog
                        label="Block"
                        size="sm"
                        variant="quiet"
                        danger
                        title={`Block “${p.title}”?`}
                        description="It leaves the shop and customers’ carts immediately. Orders already placed aren’t affected."
                        action={blockProduct.bind(null, p.id, true)}
                        submitLabel="Block"
                      >
                        <div className="flex flex-col gap-1.5">
                          <label htmlFor={`r-${p.id}`} className="text-sm font-medium">
                            Reason (the vendor sees this)
                          </label>
                          <textarea
                            id={`r-${p.id}`}
                            name="reason"
                            required
                            minLength={3}
                            maxLength={500}
                            rows={3}
                            className={`${inputClass} h-auto py-2`}
                          />
                        </div>
                      </ActionDialog>
                    )}
                    {manage && p.status === 'BLOCKED' && (
                      <ActionDialog
                        label="Unblock"
                        size="sm"
                        variant="quiet"
                        title={`Unblock “${p.title}”?`}
                        description="It returns to the vendor as hidden; they decide when to put it back in the shop."
                        action={blockProduct.bind(null, p.id, false)}
                        submitLabel="Unblock"
                      />
                    )}
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
        <Pagination meta={meta} basePath="/shop/products" params={sp} />
      </Panel>
    </>
  );
}
