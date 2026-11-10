import Link from 'next/link';
import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { apiPage } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatPhone, initials } from '@/lib/format';
import type { PetRow, UserRow } from '@/lib/types';
import { Empty, Monogram, PageHeader, Panel, StatusTag } from '@/components/ui';

export const metadata: Metadata = { title: 'Search' };

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const q = ((await searchParams).q ?? '').trim();
  const me = await getMe();
  const people = can(me, PERMISSIONS.USERS_READ);
  const pets = can(me, PERMISSIONS.PETS_READ_ANY);
  const [u, p] = q
    ? await Promise.all([
        people ? apiPage<UserRow>('/admin/users', { search: q, limit: 10 }) : null,
        pets ? apiPage<PetRow>('/admin/pets', { search: q.replace(/^@/, ''), limit: 10 }) : null,
      ])
    : [null, null];

  return (
    <>
      <PageHeader
        title={q ? `Results for “${q}”` : 'Search'}
        description={
          q ? undefined : 'Type a name, phone number, email or @handle in the search bar.'
        }
      />
      {q && (
        <div className="grid gap-6 lg:grid-cols-2">
          {u && (
            <Panel
              title="People"
              actions={
                u.meta.total > 10 ? (
                  <Link
                    className="text-sm text-teal hover:underline"
                    href={`/users?search=${encodeURIComponent(q)}`}
                  >
                    All {u.meta.total}
                  </Link>
                ) : undefined
              }
            >
              {u.items.length === 0 ? (
                <Empty title="No people found" />
              ) : (
                <ul className="divide-y divide-line-soft">
                  {u.items.map((x) => (
                    <li key={x.id}>
                      <Link
                        href={`/users/${x.id}`}
                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-paper"
                      >
                        <Monogram text={initials(x.name)} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {x.name ?? 'No name yet'}
                          </span>
                          <span className="block truncate text-xs text-muted">
                            {x.email ?? formatPhone(x.phone)}
                          </span>
                        </span>
                        <StatusTag status={x.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
          {p && (
            <Panel
              title="Pets"
              actions={
                p.meta.total > 10 ? (
                  <Link
                    className="text-sm text-teal hover:underline"
                    href={`/pets?search=${encodeURIComponent(q)}`}
                  >
                    All {p.meta.total}
                  </Link>
                ) : undefined
              }
            >
              {p.items.length === 0 ? (
                <Empty title="No pets found" />
              ) : (
                <ul className="divide-y divide-line-soft">
                  {p.items.map((x) => (
                    <li key={x.id}>
                      <Link
                        href={`/pets/${x.id}`}
                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-paper"
                      >
                        <Monogram text={initials(x.name)} tone="warm" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{x.name}</span>
                          <span className="block truncate text-xs text-muted">
                            @{x.handle}, {x.species.name}, owned by {x.owner.name ?? 'no name'}
                          </span>
                        </span>
                        <StatusTag status={x.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </div>
      )}
    </>
  );
}
