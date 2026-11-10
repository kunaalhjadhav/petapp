import Link from 'next/link';
import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { apiPage } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatDateTime } from '@/lib/format';
import { formatPaise } from '@/lib/money';
import { BOOKING_STATUS } from '@/lib/labels';
import type { BookingRow } from '@/lib/types';
import {
  Empty,
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
import { cancelBooking } from '../partners/actions';

export const metadata: Metadata = { title: 'Bookings' };

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!can(me, PERMISSIONS.PARTNERS_READ)) return <NoAccess what="bookings" />;
  const { items, meta } = await apiPage<BookingRow>('/admin/bookings', {
    status: sp.status,
    when: sp.when,
    partnerId: sp.partnerId,
    page: sp.page,
    limit: 25,
  });
  const manage = can(me, PERMISSIONS.SERVICES_MANAGE);
  return (
    <>
      <PageHeader
        title="Bookings"
        description="Every service booking. Times are India time. Cancelling here gives the customer a full refund."
      />
      <Panel>
        <form className="flex flex-wrap items-end gap-3 border-b border-line-soft px-4 py-3">
          {sp.partnerId && <input type="hidden" name="partnerId" value={sp.partnerId} />}
          <div>
            <label htmlFor="when" className="sr-only">
              When
            </label>
            <Select id="when" name="when" defaultValue={sp.when ?? ''}>
              <option value="">Any time</option>
              <option value="upcoming">Upcoming</option>
              <option value="past">Past</option>
            </Select>
          </div>
          <div>
            <label htmlFor="status" className="sr-only">
              Status
            </label>
            <Select id="status" name="status" defaultValue={sp.status ?? ''}>
              <option value="">Any status</option>
              {Object.entries(BOOKING_STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          </div>
          <button className={buttonClass('secondary')}>Apply</button>
          {sp.partnerId && (
            <Link href="/bookings" className="text-sm text-teal hover:underline">
              Show all partners
            </Link>
          )}
        </form>
        {items.length === 0 ? (
          <Empty title="No bookings match" />
        ) : (
          <Table head={['Code', 'When', 'Service', 'Partner', 'Customer', 'Status', 'Price', '']}>
            {items.map((b) => {
              const st = BOOKING_STATUS[b.status] ?? { label: b.status, tone: 'neutral' as const };
              return (
                <tr key={b.id}>
                  <Td className="font-mono text-xs">{b.code}</Td>
                  <Td className="whitespace-nowrap">{formatDateTime(b.startsAt)}</Td>
                  <Td>
                    {b.service.name}
                    <span className="block text-xs text-muted">
                      {b.pet.name} · {b.mode === 'AT_HOME' ? 'home visit' : 'at centre'}
                    </span>
                  </Td>
                  <Td>
                    <Link href={`/partners/${b.partner.id}`} className="hover:underline">
                      {b.partner.businessName}
                    </Link>
                  </Td>
                  <Td>
                    {b.customer ? (
                      <Link href={`/users/${b.customer.id}`} className="hover:underline">
                        {b.customer.name ?? 'No name'}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td>
                    <Tag tone={st.tone}>{st.label}</Tag>
                    {b.cancelReason && (
                      <span className="block text-xs text-muted">
                        {b.cancelledBy?.toLowerCase()}: {b.cancelReason}
                      </span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">
                    {formatPaise(b.pricePaise)}
                    {b.refundPaise ? (
                      <span className="block text-xs text-muted">
                        refund {formatPaise(b.refundPaise)}
                      </span>
                    ) : null}
                  </Td>
                  <Td>
                    {manage && ['PENDING_PAYMENT', 'CONFIRMED'].includes(b.status) && (
                      <ActionDialog
                        label="Cancel"
                        size="sm"
                        variant="quiet"
                        danger
                        title={`Cancel ${b.code}?`}
                        description="The customer gets a full refund and both sides are notified."
                        action={cancelBooking.bind(null, b.id)}
                        submitLabel="Cancel booking"
                      >
                        <label htmlFor={`r-${b.id}`} className="text-sm font-medium">
                          Reason
                        </label>
                        <textarea
                          id={`r-${b.id}`}
                          name="reason"
                          required
                          minLength={3}
                          rows={2}
                          className={`${inputClass} h-auto py-2`}
                        />
                      </ActionDialog>
                    )}
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
        <Pagination meta={meta} basePath="/bookings" params={sp} />
      </Panel>
    </>
  );
}
