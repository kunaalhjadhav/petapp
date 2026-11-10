import Link from 'next/link';
import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { api, apiPage } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatNumber } from '@/lib/format';
import type { CityRow, StateRow } from '@/lib/types';
import { Empty, Input, NoAccess, PageHeader, Panel, Select, Tag, buttonClass, inputClass } from '@/components/ui';
import { ActionDialog, ToggleForm } from '@/components/forms';
import { Pagination, Table, Td } from '@/components/table';
import { createCity, setCityFlag } from '../actions';

export const metadata: Metadata = { title: 'Cities' };
export const dynamic = 'force-dynamic';

/** The cities PetApp knows (spec §44–45): their areas and PIN codes, and where services are live. */
export default async function CitiesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const me = await getMe();
  if (!can(me, PERMISSIONS.LOCATIONS_READ)) return <NoAccess what="locations" />;
  const manage = can(me, PERMISSIONS.LOCATIONS_MANAGE);
  const [states, { items, meta }] = await Promise.all([
    api<StateRow[]>('/admin/locations/states'),
    apiPage<CityRow>('/admin/locations/cities', { q: sp.q, stateCode: sp.stateCode, show: sp.show, page: sp.page, limit: 50 }),
  ]);
  return (
    <>
      <PageHeader
        title="Cities"
        description="Cities, their areas and PIN codes. Apps use them to fill in addresses from a PIN code and to name where someone is. Switch on Services live where the services marketplace operates."
        actions={
          manage && (
            <ActionDialog label="Add a city" title="Add a city" action={createCity} submitLabel="Add city" variant="primary">
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Name
                <input name="name" required minLength={2} maxLength={60} className={inputClass} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                State
                <Select name="stateCode" required defaultValue="">
                  <option value="" disabled>
                    Choose…
                  </option>
                  {states.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Latitude
                  <input name="lat" type="number" step="any" min={-90} max={90} required className={inputClass} placeholder="18.5204" />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Longitude
                  <input name="lng" type="number" step="any" min={-180} max={180} required className={inputClass} placeholder="73.8567" />
                </label>
              </div>
              <p className="text-xs text-muted">The city centre. Coverage and “nearest city” are measured from it.</p>
            </ActionDialog>
          )
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Link href="/locations/zones" className={buttonClass('secondary')}>
          Delivery zones
        </Link>
        <Link href="/locations/coverage" className={buttonClass('secondary')}>
          Service coverage
        </Link>
        <Link href="/locations/partners" className={buttonClass('secondary')}>
          Partner locations
        </Link>
      </div>
      <Panel>
        <form className="flex flex-wrap items-end gap-3 border-b border-line-soft px-4 py-3" role="search">
          <div className="min-w-56 flex-1">
            <label htmlFor="q" className="sr-only">
              Search cities
            </label>
            <Input id="q" name="q" defaultValue={sp.q ?? ''} placeholder="City name" />
          </div>
          <div>
            <label htmlFor="stateCode" className="sr-only">
              State
            </label>
            <Select id="stateCode" name="stateCode" defaultValue={sp.stateCode ?? ''}>
              <option value="">Every state</option>
              {states.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="show" className="sr-only">
              Show
            </label>
            <Select id="show" name="show" defaultValue={sp.show ?? ''}>
              <option value="">All cities</option>
              <option value="live">Services live</option>
              <option value="active">Switched on</option>
              <option value="inactive">Switched off</option>
            </Select>
          </div>
          <button className={buttonClass('secondary')}>Filter</button>
        </form>
        {items.length === 0 ? (
          <Empty title="No cities match" />
        ) : (
          <>
            <Table head={['City', 'State', 'Areas', 'PIN codes', 'Services live', 'On']} numeric={[2, 3]}>
              {items.map((c) => (
                <tr key={c.id} className="hover:bg-paper">
                  <Td>
                    <Link href={`/locations/cities/${c.id}`} className="font-medium text-teal hover:underline">
                      {c.name}
                    </Link>
                    {!c.isActive && (
                      <span className="ml-2">
                        <Tag>Off</Tag>
                      </span>
                    )}
                  </Td>
                  <Td className="text-sm text-muted">{c.state.name}</Td>
                  <Td className="text-right tabular-nums">{formatNumber(c.localities)}</Td>
                  <Td className="text-right tabular-nums">{formatNumber(c.pincodes)}</Td>
                  <Td>
                    {manage ? (
                      <ToggleForm action={setCityFlag.bind(null, c.id, 'servicesLive')} checked={c.servicesLive} label={`Services live in ${c.name}`} />
                    ) : c.servicesLive ? (
                      <Tag tone="good">Live</Tag>
                    ) : (
                      <span className="text-sm text-muted">No</span>
                    )}
                  </Td>
                  <Td>
                    {manage ? (
                      <ToggleForm action={setCityFlag.bind(null, c.id, 'isActive')} checked={c.isActive} label={`${c.name} switched on`} />
                    ) : c.isActive ? (
                      'Yes'
                    ) : (
                      'No'
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
            <Pagination meta={meta} basePath="/locations/cities" params={{ q: sp.q, stateCode: sp.stateCode, show: sp.show }} />
          </>
        )}
      </Panel>
    </>
  );
}
