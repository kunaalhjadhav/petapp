import Link from 'next/link';
import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { apiPage } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatDate } from '@/lib/format';
import { formatPaise } from '@/lib/money';
import type { ContestRow } from '@/lib/types';
import { Empty, NoAccess, PageHeader, Panel, Select, Tag, buttonClass } from '@/components/ui';
import { Pagination, Table, Td } from '@/components/table';
import { CONTEST_STATUS } from './labels';

export const metadata: Metadata = { title: 'Contests' };

export default async function ContestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!can(me, PERMISSIONS.CONTESTS_READ)) return <NoAccess what="contests" />;
  const { items, meta } = await apiPage<ContestRow>('/admin/contests', {
    status: sp.status,
    page: sp.page,
    limit: 25,
  });
  const manage = can(me, PERMISSIONS.CONTESTS_MANAGE);
  return (
    <>
      <PageHeader
        title="Contests"
        description="Build contests, run them from registration to winners, and keep paid ones on the right side of the rules."
        actions={
          manage && (
            <>
              <Link href="/contests/categories" className={buttonClass('secondary')}>
                Categories
              </Link>
              <Link href="/contests/new" className={buttonClass('primary')}>
                New contest
              </Link>
            </>
          )
        }
      />
      <Panel>
        <form className="flex items-end gap-3 border-b border-line-soft px-4 py-3">
          <div>
            <label htmlFor="status" className="sr-only">
              Status
            </label>
            <Select id="status" name="status" defaultValue={sp.status ?? ''}>
              <option value="">Any status</option>
              {Object.entries(CONTEST_STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          </div>
          <button className={buttonClass('secondary')}>Apply</button>
        </form>
        {items.length === 0 ? (
          <Empty title="No contests yet">
            {manage ? 'Create the first one with New contest.' : undefined}
          </Empty>
        ) : (
          <Table
            head={[
              'Contest',
              'Status',
              'Entry fee',
              'Entries',
              'Registration opens',
              'Voting closes',
            ]}
          >
            {items.map((c) => (
              <tr key={c.id} className="hover:bg-paper">
                <Td>
                  <Link href={`/contests/${c.id}`} className="font-medium hover:underline">
                    {c.title}
                  </Link>
                  {c.category && (
                    <span className="block text-xs text-muted">{c.category.name}</span>
                  )}
                </Td>
                <Td>
                  <Tag tone={CONTEST_STATUS[c.status].tone}>{CONTEST_STATUS[c.status].label}</Tag>
                </Td>
                <Td>{c.feePaise ? formatPaise(c.feePaise) : 'Free'}</Td>
                <Td>
                  {c.entries}
                  {c.maxParticipants ? ` / ${c.maxParticipants}` : ''}
                </Td>
                <Td className="whitespace-nowrap text-muted">
                  {formatDate(c.registrationOpensAt)}
                </Td>
                <Td className="whitespace-nowrap text-muted">{formatDate(c.votingClosesAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
        <Pagination meta={meta} basePath="/contests" params={sp} />
      </Panel>
    </>
  );
}
