import Link from 'next/link';
import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { api, apiPage } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatNumber, initials } from '@/lib/format';
import type { PetRow, Species } from '@/lib/types';
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

export const metadata: Metadata = { title: 'Pets' };

const visibilityLabel = { PUBLIC: 'Public', FOLLOWERS: 'Followers', PRIVATE: 'Private' } as const;

export default async function PetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!can(me, PERMISSIONS.PETS_READ_ANY)) return <NoAccess what="pets" />;
  const [species, { items, meta }] = await Promise.all([
    api<Species[]>('/species'),
    apiPage<PetRow>('/admin/pets', {
      search: sp.search,
      speciesId: sp.speciesId,
      status: sp.status,
      verified: sp.verified === '1' ? 'true' : sp.verified === '0' ? 'false' : undefined,
      ownerId: sp.ownerId,
      page: sp.page,
      limit: 25,
    }),
  ]);
  const filtered = Boolean(sp.search || sp.speciesId || sp.status || sp.verified || sp.ownerId);

  return (
    <>
      <PageHeader
        title="Pets"
        description="Every pet profile, including hidden and removed ones. Open a pet to verify it or change its status."
      />
      <Panel>
        <form
          className="flex flex-wrap items-end gap-3 border-b border-line-soft px-4 py-3"
          role="search"
        >
          <div className="min-w-56 flex-1">
            <label htmlFor="search" className="sr-only">
              Name or handle
            </label>
            <input
              id="search"
              name="search"
              defaultValue={sp.search}
              placeholder="Pet name or handle"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="speciesId" className="sr-only">
              Species
            </label>
            <Select id="speciesId" name="speciesId" defaultValue={sp.speciesId ?? ''}>
              <option value="">All species</option>
              {species.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="status" className="sr-only">
              Status
            </label>
            <Select id="status" name="status" defaultValue={sp.status ?? ''}>
              <option value="">Any status</option>
              <option value="ACTIVE">Active</option>
              <option value="HIDDEN">Hidden</option>
              <option value="REMOVED">Removed</option>
            </Select>
          </div>
          <div>
            <label htmlFor="verified" className="sr-only">
              Verification
            </label>
            <Select id="verified" name="verified" defaultValue={sp.verified ?? ''}>
              <option value="">Verified or not</option>
              <option value="1">Verified</option>
              <option value="0">Not verified</option>
            </Select>
          </div>
          <button className={buttonClass('secondary')}>Apply</button>
          {filtered && (
            <Link href="/pets" className={buttonClass('quiet')}>
              Clear
            </Link>
          )}
        </form>

        {items.length === 0 ? (
          <Empty title={filtered ? 'No pets match these filters' : 'No pet profiles yet'}>
            {filtered
              ? 'Try another name or handle, or clear the filters.'
              : 'Pets appear here when owners add them in the app.'}
          </Empty>
        ) : (
          <Table head={['Pet', 'Species', 'Owner', 'City', 'Followers', 'Visible to', 'Status']}>
            {items.map((p) => (
              <tr key={p.id} className="hover:bg-paper">
                <Td>
                  <Link href={`/pets/${p.id}`} className="flex items-center gap-3">
                    <Monogram text={initials(p.name)} tone="warm" />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 font-medium">
                        {p.name}
                        {p.isVerified && <Tag tone="teal">Verified</Tag>}
                      </span>
                      <span className="block truncate text-xs text-muted">@{p.handle}</span>
                    </span>
                  </Link>
                </Td>
                <Td className="text-muted">
                  {p.species.name}
                  {p.breed ? `, ${p.breed.name}` : ''}
                </Td>
                <Td>
                  <Link href={`/users/${p.owner.id}`} className="hover:underline">
                    {p.owner.name ?? 'No name'}
                  </Link>
                </Td>
                <Td className="text-muted">{p.city ?? '—'}</Td>
                <Td>{formatNumber(p.followerCount)}</Td>
                <Td className="text-muted">{visibilityLabel[p.visibility]}</Td>
                <Td>
                  {p.deletedAt ? <Tag>Deleted by owner</Tag> : <StatusTag status={p.status} />}
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <Pagination meta={meta} basePath="/pets" params={sp} />
      </Panel>
    </>
  );
}
