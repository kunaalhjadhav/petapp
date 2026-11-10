import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PERMISSIONS } from '@petapp/types';
import { ApiError, api } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatDateTime, timeAgo } from '@/lib/format';
import { formatPaise } from '@/lib/money';
import {
  BOOKING_STATUS,
  DOC_KIND,
  PARTNER_STATUS,
  WEEKDAYS,
  bpsToPct,
  minutesToTime,
} from '@/lib/labels';
import type { PartnerDetail } from '@/lib/types';
import { Facts, NoAccess, PageHeader, Panel, Tag, inputClass } from '@/components/ui';
import { ActionDialog } from '@/components/forms';
import { Table, Td } from '@/components/table';
import { Trail } from '@/components/trail';
import { reviewPartner, setCommission } from '../actions';

export const metadata: Metadata = { title: 'Service partner' };

const DOC_TONE: Record<string, 'neutral' | 'good' | 'warn' | 'danger'> = {
  PENDING: 'warn',
  ACCEPTED: 'good',
  REJECTED: 'danger',
  UPLOADING: 'neutral',
};

export default async function PartnerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  if (!can(me, PERMISSIONS.PARTNERS_READ)) return <NoAccess what="service partners" />;
  let p: PartnerDetail;
  try {
    p = await api<PartnerDetail>(`/admin/partners/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
  const review = can(me, PERMISSIONS.PARTNERS_REVIEW);
  const st = PARTNER_STATUS[p.status];
  const docs = p.documents.filter((d) => d.status !== 'UPLOADING');
  const hoursByDay = WEEKDAYS.map((name, d) => ({
    name,
    windows: p.hours.filter((h) => h.weekday === d).sort((a, b) => a.opensMin - b.opensMin),
  }));
  const categoryRate = p.services.find((s) => s.category)?.category?.commissionBps;

  return (
    <>
      <PageHeader
        back={{ href: '/partners', label: 'Service partners' }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {p.businessName} <Tag tone={st.tone}>{st.label}</Tag>
          </span>
        }
        description={`${p.kind === 'INDIVIDUAL' ? 'Individual' : 'Business'} · ${[p.area, p.city].filter(Boolean).join(', ')}${p.submittedAt ? ` · submitted ${timeAgo(p.submittedAt)}` : ''}`}
        actions={
          review && (
            <>
              {(p.status === 'SUBMITTED' || p.status === 'REJECTED') && (
                <ActionDialog
                  label="Approve"
                  variant="primary"
                  title={`Approve ${p.businessName}?`}
                  description="Decide on each document. Approval needs an accepted ID proof. The partner can then take bookings and appears in search."
                  action={reviewPartner.bind(null, id, 'APPROVE')}
                  submitLabel="Approve"
                >
                  {docs.length === 0 && (
                    <p className="text-sm text-danger">No documents uploaded.</p>
                  )}
                  {docs.map((d) => (
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
                        placeholder="Note for the partner (optional)"
                        className={inputClass}
                        maxLength={300}
                      />
                    </fieldset>
                  ))}
                </ActionDialog>
              )}
              {p.status === 'SUBMITTED' && (
                <ActionDialog
                  label="Reject"
                  variant="quiet"
                  danger
                  title="Reject this application?"
                  description="The partner sees the reason, can fix it and resubmit."
                  action={reviewPartner.bind(null, id, 'REJECT')}
                  submitLabel="Reject"
                >
                  <label htmlFor="rr" className="text-sm font-medium">
                    Reason
                  </label>
                  <textarea
                    id="rr"
                    name="reason"
                    required
                    minLength={3}
                    rows={3}
                    className={`${inputClass} h-auto py-2`}
                    placeholder="e.g. The ID photo is blurry. Please upload a clearer copy."
                  />
                </ActionDialog>
              )}
              {p.status === 'APPROVED' && (
                <ActionDialog
                  label="Suspend"
                  variant="quiet"
                  danger
                  title="Suspend this partner?"
                  description="They disappear from search and can’t take new bookings. Existing bookings stay."
                  action={reviewPartner.bind(null, id, 'SUSPEND')}
                  submitLabel="Suspend"
                >
                  <label htmlFor="sr" className="text-sm font-medium">
                    Reason
                  </label>
                  <textarea
                    id="sr"
                    name="reason"
                    required
                    minLength={3}
                    rows={3}
                    className={`${inputClass} h-auto py-2`}
                  />
                </ActionDialog>
              )}
              {p.status === 'SUSPENDED' && (
                <ActionDialog
                  label="Reinstate"
                  variant="primary"
                  title="Reinstate this partner?"
                  description="They appear in search again and can take bookings."
                  action={reviewPartner.bind(null, id, 'REINSTATE')}
                  submitLabel="Reinstate"
                />
              )}
            </>
          )
        }
      />
      <div className="grid gap-8 lg:grid-cols-[1fr_18rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {p.statusReason && (p.status === 'REJECTED' || p.status === 'SUSPENDED') && (
            <p className="rounded-md border border-danger/30 bg-danger-wash px-4 py-3 text-sm text-danger">
              {st.label}: {p.statusReason}
            </p>
          )}
          {p.checklist.length > 0 && (
            <Panel title="Still missing">
              <ul className="list-disc space-y-1 py-3 pl-9 pr-4 text-sm">
                {p.checklist.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel title="Documents">
            {docs.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted">Nothing uploaded yet.</p>
            ) : (
              <Table head={['Document', 'Status', 'Uploaded', '']}>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <Td>
                      {DOC_KIND[d.kind] ?? d.kind}
                      {d.note && <span className="block text-xs text-muted">“{d.note}”</span>}
                    </Td>
                    <Td>
                      <Tag tone={DOC_TONE[d.status] ?? 'neutral'}>
                        {d.status.charAt(0) + d.status.slice(1).toLowerCase()}
                      </Tag>
                    </Td>
                    <Td className="text-muted">{timeAgo(d.createdAt)}</Td>
                    <Td>
                      <a
                        href={d.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-teal hover:underline"
                      >
                        Open
                      </a>
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
            <p className="px-4 pb-3 text-xs text-muted">
              Links work for a few minutes and only for staff. Documents are never public.
            </p>
          </Panel>

          <Panel title="Business">
            <Facts
              items={[
                [
                  'Owner',
                  <Link key="o" href={`/users/${p.user.id}`} className="text-teal hover:underline">
                    {p.user.name ?? 'No name'}
                  </Link>,
                ],
                ['Phone', p.phone ?? p.user.phone ?? '—'],
                ['Email', p.email ?? p.user.email ?? '—'],
                [
                  'Address',
                  [p.addressLine, p.area, p.city, p.state, p.pincode].filter(Boolean).join(', ') ||
                    '—',
                ],
                [
                  'On the map',
                  p.lat !== null && p.lng !== null ? (
                    <a
                      key="m"
                      href={`https://www.google.com/maps?q=${p.lat},${p.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-teal hover:underline"
                    >
                      {p.lat.toFixed(5)}, {p.lng.toFixed(5)}
                    </a>
                  ) : (
                    '—'
                  ),
                ],
                ['Home visits', `within ${p.homeVisitRadiusKm} km`],
                ['Bookings at the same time', String(p.concurrency)],
                ['GSTIN', p.gstin ?? '—'],
                ['About', p.about ?? '—'],
              ]}
            />
          </Panel>

          <Panel
            title="Services"
            actions={
              can(me, PERMISSIONS.SERVICES_MANAGE) && (
                <ActionDialog
                  label={`Commission: ${p.commissionBps !== null ? `${bpsToPct(p.commissionBps)} (custom)` : categoryRate !== undefined ? `${bpsToPct(categoryRate)} (category)` : 'category rate'}`}
                  size="sm"
                  variant="quiet"
                  title="Commission for this partner"
                  description="Leave empty to use each service category’s rate. Applies to new bookings."
                  action={setCommission.bind(null, id)}
                  submitLabel="Save"
                >
                  <label htmlFor="pct" className="text-sm font-medium">
                    Commission (%)
                  </label>
                  <input
                    id="pct"
                    name="pct"
                    inputMode="decimal"
                    defaultValue={p.commissionBps !== null ? String(p.commissionBps / 100) : ''}
                    className={inputClass}
                    placeholder="Category rate"
                  />
                </ActionDialog>
              )
            }
          >
            {p.services.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted">No services yet.</p>
            ) : (
              <Table head={['Service', 'Category', 'Length', 'Price', 'Where', '']}>
                {p.services.map((s) => (
                  <tr key={s.id}>
                    <Td className="font-medium">{s.name}</Td>
                    <Td className="text-muted">{s.category?.name ?? '—'}</Td>
                    <Td>{s.durationMin} min</Td>
                    <Td>{formatPaise(s.pricePaise)}</Td>
                    <Td className="text-muted">
                      {s.modes
                        .map((m) => (m === 'AT_HOME' ? 'Home visit' : 'At centre'))
                        .join(', ')}
                    </Td>
                    <Td>{!s.isActive && <Tag tone="neutral">Hidden</Tag>}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Panel>

          <Panel title="Opening hours (India time)">
            <ul className="divide-y divide-line-soft text-sm">
              {hoursByDay.map((d) => (
                <li key={d.name} className="flex justify-between px-4 py-2">
                  <span>{d.name}</span>
                  <span className="text-muted">
                    {d.windows.length
                      ? d.windows
                          .map((w) => `${minutesToTime(w.opensMin)}–${minutesToTime(w.closesMin)}`)
                          .join(', ')
                      : 'Closed'}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Bookings and money">
            <Facts
              items={[
                [
                  'Bookings',
                  Object.entries(p.bookings)
                    .map(([k, n]) => `${n} ${(BOOKING_STATUS[k]?.label ?? k).toLowerCase()}`)
                    .join(', ') || 'none yet',
                ],
                ['Completed bookings', formatPaise(p.completedTotals.pricePaise)],
                ['Platform fees', formatPaise(p.completedTotals.platformFeePaise)],
                ['Partner earnings', formatPaise(p.completedTotals.partnerEarningPaise)],
                [
                  'Rating',
                  p.ratingCount
                    ? `★ ${p.ratingAvg.toFixed(1)} from ${p.ratingCount} review${p.ratingCount === 1 ? '' : 's'}`
                    : 'No reviews yet',
                ],
                ['Reviewed', p.reviewedAt ? formatDateTime(p.reviewedAt) : '—'],
              ]}
            />
            <p className="px-4 pb-3 text-sm">
              <Link href={`/bookings?partnerId=${p.id}`} className="text-teal hover:underline">
                See this partner’s bookings
              </Link>
            </p>
          </Panel>
        </div>
        <Trail entityId={p.id} />
      </div>
    </>
  );
}
