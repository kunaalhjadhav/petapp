import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { api } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatDateTime } from '@/lib/format';
import { formatPaise } from '@/lib/money';
import type { CouponRow } from '@/lib/types';
import { Empty, Field, Input, NoAccess, PageHeader, Panel, Tag } from '@/components/ui';
import { ActionDialog, ToggleForm } from '@/components/forms';
import { Table, Td } from '@/components/table';
import { createCoupon, toggleCoupon } from '../actions';
import { KindAndValue, TzOffset, ValidityWindow } from './form';

export const metadata: Metadata = { title: 'Coupons' };

export default async function CouponsPage() {
  const me = await getMe();
  if (!can(me, PERMISSIONS.MARKETPLACE_READ)) return <NoAccess what="coupons" />;
  const coupons = await api<CouponRow[]>('/admin/coupons');
  const now = Date.now();
  const describe = (c: CouponRow) =>
    `${c.kind === 'PERCENT' ? `${c.value / 100}% off` : `${formatPaise(c.value)} off`}${c.maxDiscountPaise ? `, up to ${formatPaise(c.maxDiscountPaise)}` : ''}${c.minOrderPaise ? `, on ${formatPaise(c.minOrderPaise)}+` : ''}`;
  return (
    <>
      <PageHeader
        title="Coupons"
        description="Platform coupons are PetApp’s cost: vendors still earn on the full price. Vendor coupons apply only to that vendor’s items."
        actions={
          can(me, PERMISSIONS.MARKETPLACE_MANAGE) && (
            <ActionDialog
              label="New coupon"
              variant="primary"
              title="New platform coupon"
              action={createCoupon}
              submitLabel="Create coupon"
            >
              <TzOffset />
              <Field
                label="Code"
                htmlFor="code"
                hint="3–20 letters or numbers; customers type this"
              >
                <Input
                  id="code"
                  name="code"
                  required
                  pattern="[A-Za-z0-9]{3,20}"
                  placeholder="PETS10"
                />
              </Field>
              <Field label="Description (optional)" htmlFor="description">
                <Input id="description" name="description" maxLength={200} />
              </Field>
              <KindAndValue />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Maximum discount (₹)" htmlFor="max" hint="Optional cap">
                  <Input id="max" name="max" inputMode="decimal" />
                </Field>
                <Field label="Minimum order (₹)" htmlFor="min" hint="Optional">
                  <Input id="min" name="min" inputMode="decimal" />
                </Field>
              </div>
              <ValidityWindow />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Total uses" htmlFor="usageLimit" hint="Empty = unlimited">
                  <Input id="usageLimit" name="usageLimit" type="number" min={1} />
                </Field>
                <Field label="Uses per customer" htmlFor="perUserLimit">
                  <Input
                    id="perUserLimit"
                    name="perUserLimit"
                    type="number"
                    min={1}
                    max={100}
                    defaultValue={1}
                  />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="membersOnly" /> Members only (plans with “Member coupons”)
              </label>
            </ActionDialog>
          )
        }
      />
      <Panel>
        {coupons.length === 0 ? (
          <Empty title="No coupons yet" />
        ) : (
          <Table head={['Code', 'Discount', 'Funded by', 'Valid', 'Used', 'Active']}>
            {coupons.map((c) => {
              const live =
                c.isActive &&
                new Date(c.startsAt).getTime() <= now &&
                new Date(c.endsAt).getTime() >= now;
              return (
                <tr key={c.id}>
                  <Td>
                    <span className="font-mono font-medium">{c.code}</span>{' '}
                    {live && <Tag tone="good">Live</Tag>}
                    {c.description && (
                      <span className="block text-xs text-muted">{c.description}</span>
                    )}
                  </Td>
                  <Td className="text-sm">{describe(c)}</Td>
                  <Td>{c.vendor ? c.vendor.businessName : 'PetApp'}</Td>
                  <Td className="whitespace-nowrap text-xs text-muted">
                    {formatDateTime(c.startsAt)} – {formatDateTime(c.endsAt)}
                  </Td>
                  <Td>
                    {c.usedCount}
                    {c.usageLimit ? ` / ${c.usageLimit}` : ''}
                  </Td>
                  <Td>
                    {can(me, PERMISSIONS.MARKETPLACE_MANAGE) ? (
                      <ToggleForm
                        name="isActive"
                        action={toggleCoupon.bind(null, c.id)}
                        checked={c.isActive}
                        label={`Coupon ${c.code} active`}
                      />
                    ) : c.isActive ? (
                      'Yes'
                    ) : (
                      'No'
                    )}
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Panel>
    </>
  );
}
