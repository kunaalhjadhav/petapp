import Link from 'next/link';
import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { apiPage } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatDate, formatPhone, humanize, initials, timeAgo } from '@/lib/format';
import type { UserRow } from '@/lib/types';
import {
  Empty,
  Monogram,
  NoAccess,
  PageHeader,
  Panel,
  Select,
  StatusTag,
  Tag,
  buttonClass,
  inputClass,
} from '@/components/ui';
import { Pagination, Table, Td } from '@/components/table';

export const metadata: Metadata = { title: 'People' };

const ROLES = [
  'CUSTOMER',
  'SERVICE_PARTNER',
  'PRODUCT_PARTNER',
  'JUDGE',
  'MODERATOR',
  'SUPPORT_AGENT',
  'FINANCE',
  'ADMIN',
  'SUPER_ADMIN',
];

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!can(me, PERMISSIONS.USERS_READ)) return <NoAccess what="people" />;
  const { items, meta } = await apiPage<UserRow>('/admin/users', {
    search: sp.search,
    status: sp.status,
    role: sp.role,
    page: sp.page,
    limit: 25,
  });
  const filtered = Boolean(sp.search || sp.status || sp.role);

  return (
    <>
      <PageHeader
        title="People"
        description="Customers, partners, judges and staff. Open a person to change their status or roles."
      />
      <Panel>
        <form
          className="flex flex-wrap items-end gap-3 border-b border-line-soft px-4 py-3"
          role="search"
        >
          <div className="min-w-56 flex-1">
            <label htmlFor="search" className="sr-only">
              Name, phone or email
            </label>
            <input
              id="search"
              name="search"
              defaultValue={sp.search}
              placeholder="Name, phone or email"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="status" className="sr-only">
              Status
            </label>
            <Select id="status" name="status" defaultValue={sp.status ?? ''}>
              <option value="">Any status</option>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="BLOCKED">Blocked</option>
              <option value="PENDING_DELETION">Deletion requested</option>
            </Select>
          </div>
          <div>
            <label htmlFor="role" className="sr-only">
              Role
            </label>
            <Select id="role" name="role" defaultValue={sp.role ?? ''}>
              <option value="">Any role</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {humanize(r)}
                </option>
              ))}
            </Select>
          </div>
          <button className={buttonClass('secondary')}>Apply</button>
          {filtered && (
            <Link href="/users" className={buttonClass('quiet')}>
              Clear
            </Link>
          )}
        </form>

        {items.length === 0 ? (
          <Empty title={filtered ? 'No one matches these filters' : 'No accounts yet'}>
            {filtered
              ? 'Try part of a name, the last digits of a phone number, or clear the filters.'
              : 'People appear here when they sign up in the app.'}
          </Empty>
        ) : (
          <Table head={['Person', 'Roles', 'City', 'Pets', 'Joined', 'Last sign-in', 'Status']}>
            {items.map((u) => (
              <tr key={u.id} className="hover:bg-paper">
                <Td>
                  <Link
                    href={`/users/${u.id}`}
                    className="flex items-center gap-3 outline-offset-4"
                  >
                    <Monogram text={initials(u.name)} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">
                        {u.name ?? 'No name yet'}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {u.email ?? formatPhone(u.phone)}
                      </span>
                    </span>
                  </Link>
                </Td>
                <Td>
                  <span className="flex flex-wrap gap-1">
                    {u.roles
                      .filter((r) => r !== 'CUSTOMER')
                      .map((r) => (
                        <Tag key={r} tone="teal">
                          {humanize(r)}
                        </Tag>
                      ))}
                    {u.roles.every((r) => r === 'CUSTOMER') && (
                      <span className="text-muted">Customer</span>
                    )}
                  </span>
                </Td>
                <Td className="text-muted">{u.city ?? '—'}</Td>
                <Td>{u.petCount}</Td>
                <Td className="whitespace-nowrap text-muted">{formatDate(u.createdAt)}</Td>
                <Td className="whitespace-nowrap text-muted">{timeAgo(u.lastLoginAt)}</Td>
                <Td>
                  <StatusTag status={u.status} />
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <Pagination meta={meta} basePath="/users" params={sp} />
      </Panel>
    </>
  );
}
