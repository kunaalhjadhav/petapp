import Link from 'next/link';
import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { apiPage } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { timeAgo } from '@/lib/format';
import { PARTNER_STATUS } from '@/lib/labels';
import type { PartnerRow } from '@/lib/types';
import { Empty, Input, NoAccess, PageHeader, Panel, buttonClass } from '@/components/ui';
import { Pagination, Table, Td } from '@/components/table';

export const metadata: Metadata = { title: 'Service partners' };

const TABS = ['SUBMITTED', 'APPROVED', 'REJECTED', 'SUSPENDED', 'DRAFT'] as const;

export default async function PartnersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!can(me, PERMISSIONS.PARTNERS_READ)) return <NoAccess what="service partners" />;
  const status = (TABS as readonly string[]).includes(sp.status ?? '') ? sp.status! : 'SUBMITTED';
  const { items, meta } = await apiPage<PartnerRow>('/admin/partners', {
    status,
    q: sp.q,
    page: sp.page,
    limit: 25,
  });
  return (
    <>
      <PageHeader
        title="Service partners"
        description="Groomers, vets, trainers and other businesses. Check their documents before they can take bookings."
      />
      <Panel>
        <form className="flex flex-wrap items-end gap-3 border-b border-line-soft px-4 py-3">
          <div
            className="flex flex-wrap rounded-md border border-line bg-panel p-0.5"
            role="group"
            aria-label="Status"
          >
            {TABS.map((s) => (
              <Link
                key={s}
                href={`/partners?status=${s}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ''}`}
                aria-current={status === s ? 'page' : undefined}
                className={`rounded px-3 py-1.5 text-sm ${status === s ? 'bg-teal-wash font-medium text-teal' : 'text-muted hover:text-ink'}`}
              >
                {PARTNER_STATUS[s].label}
              </Link>
            ))}
          </div>
          <input type="hidden" name="status" value={status} />
          <div>
            <label htmlFor="q" className="sr-only">
              Search
            </label>
            <Input id="q" name="q" defaultValue={sp.q} placeholder="Business, city or phone" />
          </div>
          <button className={buttonClass('secondary')}>Search</button>
        </form>
        {items.length === 0 ? (
          <Empty
            title={status === 'SUBMITTED' ? 'No one is waiting for review' : 'No partners here'}
          >
            {status === 'SUBMITTED'
              ? 'New applications from the partner app appear here.'
              : undefined}
          </Empty>
        ) : (
          <Table
            head={[
              'Business',
              'Owner',
              'Where',
              'Services',
              'Documents',
              status === 'SUBMITTED' ? 'Submitted' : 'Rating',
            ]}
          >
            {items.map((p) => (
              <tr key={p.id} className="hover:bg-paper">
                <Td>
                  <Link href={`/partners/${p.id}`} className="font-medium hover:underline">
                    {p.businessName}
                  </Link>
                  <span className="block text-xs text-muted">
                    {p.kind === 'INDIVIDUAL' ? 'Individual' : 'Business'}
                  </span>
                </Td>
                <Td>{p.user.name ?? 'No name'}</Td>
                <Td className="text-muted">{[p.area, p.city].filter(Boolean).join(', ') || '—'}</Td>
                <Td>{p._count.services}</Td>
                <Td>{p._count.documents}</Td>
                <Td className="whitespace-nowrap text-muted">
                  {status === 'SUBMITTED'
                    ? p.submittedAt
                      ? timeAgo(p.submittedAt)
                      : '—'
                    : p.ratingCount
                      ? `★ ${p.ratingAvg.toFixed(1)} (${p.ratingCount})`
                      : 'No reviews'}
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <Pagination meta={meta} basePath="/partners" params={{ ...sp, status }} />
      </Panel>
    </>
  );
}
