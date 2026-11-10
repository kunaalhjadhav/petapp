import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PERMISSIONS } from '@petapp/types';
import { ApiError, api } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatDateTime, timeAgo } from '@/lib/format';
import { DOC_KIND, PARTNER_STATUS } from '@/lib/labels';
import type { VendorDetail } from '@/lib/types';
import { Facts, NoAccess, PageHeader, Panel, Tag, inputClass } from '@/components/ui';
import { ActionDialog } from '@/components/forms';
import { Trail } from '@/components/trail';
import { reviewVendor, setVendorCommission } from '../../actions';

export const metadata: Metadata = { title: 'Vendor' };
const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 2 : 0).replace(/0$/, '')}%`;
const DOC_STATUS: Record<string, { label: string; tone: 'neutral' | 'good' | 'danger' }> = {
  PENDING: { label: 'Waiting', tone: 'neutral' },
  ACCEPTED: { label: 'Accepted', tone: 'good' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
};

function Reason({ label = 'Reason (the vendor sees this)' }: { label?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="reason" className="text-sm font-medium">
        {label}
      </label>
      <textarea
        id="reason"
        name="reason"
        required
        minLength={3}
        maxLength={500}
        rows={3}
        className={`${inputClass} h-auto py-2`}
      />
    </div>
  );
}

export default async function VendorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  if (!can(me, PERMISSIONS.MARKETPLACE_READ)) return <NoAccess what="vendors" />;
  let v: VendorDetail;
  try {
    v = await api<VendorDetail>(`/admin/vendors/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
  const manage = can(me, PERMISSIONS.MARKETPLACE_MANAGE);
  const st = PARTNER_STATUS[v.status];
  const count = (o: Partial<Record<string, number>>) =>
    Object.values(o).reduce((a: number, b) => a + (b ?? 0), 0);

  return (
    <>
      <PageHeader
        back={{ href: '/shop/vendors', label: 'Vendors' }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {v.businessName} <Tag tone={st.tone}>{st.label}</Tag>
          </span>
        }
        description={`${v.city}, ${v.state}${v.submittedAt ? ` · submitted ${timeAgo(v.submittedAt)}` : ''}`}
        actions={
          manage && (
            <>
              {v.status === 'SUBMITTED' && (
                <ActionDialog
                  label="Approve"
                  variant="primary"
                  title={`Approve ${v.businessName}?`}
                  description={`Decide on each document. Approval needs an accepted ID proof${v.gstin ? ' and GST certificate (they gave a GSTIN)' : ''}. They can then list and sell products.`}
                  action={reviewVendor.bind(null, id, 'APPROVE')}
                  submitLabel="Approve"
                >
                  {v.documents.length === 0 && (
                    <p className="text-sm text-danger">No documents uploaded.</p>
                  )}
                  {v.documents.map((d) => (
                    <fieldset
                      key={d.id}
                      className="flex flex-col gap-1.5 rounded-md border border-line-soft p-3 text-sm"
                    >
                      <legend className="px-1 font-medium">{DOC_KIND[d.kind] ?? d.kind}</legend>
                      <a
                        href={d.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-teal hover:underline"
                      >
                        Open document
                      </a>
                      <span className="flex gap-4">
                        <label className="inline-flex items-center gap-1.5">
                          <input
                            type="radio"
                            name={`doc:${d.id}`}
                            value="ACCEPTED"
                            defaultChecked={d.status === 'ACCEPTED'}
                            required
                          />{' '}
                          Accept
                        </label>
                        <label className="inline-flex items-center gap-1.5">
                          <input
                            type="radio"
                            name={`doc:${d.id}`}
                            value="REJECTED"
                            defaultChecked={d.status === 'REJECTED'}
                          />{' '}
                          Reject
                        </label>
                      </span>
                      <input
                        name={`note:${d.id}`}
                        aria-label={`Note on ${DOC_KIND[d.kind] ?? d.kind}`}
                        placeholder="Note for the vendor (optional)"
                        className={inputClass}
                        maxLength={300}
                      />
                    </fieldset>
                  ))}
                </ActionDialog>
              )}
              {v.status === 'SUBMITTED' && (
                <ActionDialog
                  label="Ask for changes"
                  variant="secondary"
                  title="Ask for changes"
                  description="The store goes back to the vendor with your reason."
                  action={reviewVendor.bind(null, id, 'REJECT')}
                  submitLabel="Send back"
                >
                  <Reason />
                </ActionDialog>
              )}
              {v.status === 'APPROVED' && (
                <ActionDialog
                  label="Suspend"
                  variant="quiet"
                  danger
                  title={`Suspend ${v.businessName}?`}
                  description="Their products leave the shop at once. Orders already placed stay with them to fulfil or cancel."
                  action={reviewVendor.bind(null, id, 'SUSPEND')}
                  submitLabel="Suspend"
                >
                  <Reason />
                </ActionDialog>
              )}
              {v.status === 'SUSPENDED' && (
                <ActionDialog
                  label="Reinstate"
                  variant="primary"
                  title={`Reinstate ${v.businessName}?`}
                  description="Their active products return to the shop."
                  action={reviewVendor.bind(null, id, 'REINSTATE')}
                  submitLabel="Reinstate"
                />
              )}
            </>
          )
        }
      />
      <div className="grid gap-8 lg:grid-cols-[1fr_18rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {v.statusReason && (v.status === 'REJECTED' || v.status === 'SUSPENDED') && (
            <p className="rounded-md border border-danger/30 bg-danger-wash px-4 py-3 text-sm text-danger">
              {v.statusReason}
            </p>
          )}
          {v.checklist.length > 0 && v.status !== 'APPROVED' && (
            <Panel title="Still missing">
              <ul className="list-disc space-y-1 py-3 pl-9 pr-4 text-sm">
                {v.checklist.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </Panel>
          )}
          <Panel title="Documents">
            {v.documents.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted">No documents yet.</p>
            ) : (
              <ul className="divide-y divide-line-soft">
                {v.documents.map((d) => (
                  <li
                    key={d.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm"
                  >
                    <span>
                      <span className="font-medium">{DOC_KIND[d.kind] ?? d.kind}</span>{' '}
                      <span className="text-muted">
                        · {d.mimeType === 'application/pdf' ? 'PDF' : 'image'} ·{' '}
                        {timeAgo(d.createdAt)}
                      </span>
                      {d.note && <span className="block text-xs text-muted">“{d.note}”</span>}
                    </span>
                    <span className="flex items-center gap-3">
                      <Tag tone={DOC_STATUS[d.status]?.tone ?? 'neutral'}>
                        {DOC_STATUS[d.status]?.label ?? d.status}
                      </Tag>
                      <a
                        href={d.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-teal hover:underline"
                      >
                        Open
                      </a>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="border-t border-line-soft px-4 py-2 text-xs text-muted">
              Links are private and expire after a few minutes. Reload the page for fresh ones.
            </p>
          </Panel>
          <Panel title="Store">
            <Facts
              items={[
                ['Legal name', v.legalName ?? '—'],
                ['GSTIN', v.gstin ?? 'Not registered'],
                ['Phone', v.phone],
                ['Email', v.email ?? '—'],
                [
                  'Pickup and returns address',
                  `${v.addressLine}, ${v.city}, ${v.state} ${v.pincode}`,
                ],
                [
                  'Owner account',
                  <Link key="u" href={`/users/${v.user.id}`} className="text-teal hover:underline">
                    {v.user.name ?? v.user.phone ?? 'View'}
                  </Link>,
                ],
                ['Reviewed', v.reviewedAt ? formatDateTime(v.reviewedAt) : '—'],
              ]}
            />
          </Panel>
          <Panel
            title="Commission"
            actions={
              manage && (
                <ActionDialog
                  label="Change"
                  size="sm"
                  variant="quiet"
                  title="Commission for this store"
                  description="Leave empty to use each category’s standard rate. Applies to new orders only."
                  action={setVendorCommission.bind(null, id)}
                  submitLabel="Save"
                >
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="pct" className="text-sm font-medium">
                      Agreed rate (%)
                    </label>
                    <input
                      id="pct"
                      name="pct"
                      inputMode="decimal"
                      defaultValue={v.commissionBps === null ? '' : String(v.commissionBps / 100)}
                      className={inputClass}
                    />
                  </div>
                </ActionDialog>
              )
            }
          >
            <p className="px-4 py-3 text-sm">
              {v.commissionBps === null
                ? 'Each category’s standard rate'
                : `${pct(v.commissionBps)} on every product (agreed rate)`}
            </p>
          </Panel>
          <Panel title="Activity">
            <Facts
              items={[
                [
                  'Products',
                  `${count(v.products)} (${
                    Object.entries(v.products)
                      .map(([k, n]) => `${n} ${k.toLowerCase()}`)
                      .join(', ') || 'none'
                  })`,
                ],
                [
                  'Orders',
                  `${count(v.orders)} (${
                    Object.entries(v.orders)
                      .map(([k, n]) => `${n} ${k.toLowerCase().replace(/_/g, ' ')}`)
                      .join(', ') || 'none'
                  })`,
                ],
              ]}
            />
            <p className="border-t border-line-soft px-4 py-2 text-sm">
              <Link href={`/shop/products?vendorId=${v.id}`} className="text-teal hover:underline">
                Products
              </Link>{' '}
              ·{' '}
              <Link href={`/shop/orders?vendorId=${v.id}`} className="text-teal hover:underline">
                Orders
              </Link>
            </p>
          </Panel>
        </div>
        <Trail entityId={v.id} />
      </div>
    </>
  );
}
