import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PERMISSIONS } from '@petapp/types';
import { ApiError, api, apiPage } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatNumber } from '@/lib/format';
import type { CityDetail, PincodeRow, StateRow } from '@/lib/types';
import { Empty, Facts, Input, NoAccess, PageHeader, Panel, Select, Tag, buttonClass, inputClass } from '@/components/ui';
import { ActionDialog, InlineForm, SubmitButton, ToggleForm } from '@/components/forms';
import { Pagination, Table, Td } from '@/components/table';
import { createLocality, createPincode, deletePincode, importPlaces, saveCity, setCityFlag, setLocalityActive } from '../../actions';
import { ImportForm } from '../../import-form';

export const metadata: Metadata = { title: 'City' };
export const dynamic = 'force-dynamic';

export default async function CityPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await getMe();
  if (!can(me, PERMISSIONS.LOCATIONS_READ)) return <NoAccess what="locations" />;
  const manage = can(me, PERMISSIONS.LOCATIONS_MANAGE);
  let c: CityDetail;
  try {
    c = await api<CityDetail>(`/admin/locations/cities/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
  const [states, pins] = await Promise.all([
    api<StateRow[]>('/admin/locations/states'),
    apiPage<PincodeRow>(`/admin/locations/cities/${id}/pincodes`, { q: sp.q, localityId: sp.localityId, page: sp.page, limit: 50 }),
  ]);
  return (
    <>
      <PageHeader
        back={{ href: '/locations/cities', label: 'Cities' }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {c.name}
            {c.servicesLive && <Tag tone="good">Services live</Tag>}
            {!c.isActive && <Tag>Off</Tag>}
          </span>
        }
        description={`${c.state.name}. ${formatNumber(c.localities.length)} areas, ${formatNumber(c.pincodes)} PIN codes, ${formatNumber(c.partnersNearby)} approved partners within ${c.coverageRadiusKm} km.`}
      />
      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel
            title={`Areas (${c.localities.length})`}
            actions={
              manage && (
                <ActionDialog label="Add an area" title={`Add an area to ${c.name}`} action={createLocality.bind(null, c.id)} submitLabel="Add area" size="sm">
                  <label className="flex flex-col gap-1.5 text-sm font-medium">
                    Name
                    <input name="name" required minLength={2} maxLength={80} className={inputClass} placeholder="e.g. Koregaon Park" />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex flex-col gap-1.5 text-sm font-medium">
                      Latitude (optional)
                      <input name="lat" type="number" step="any" min={-90} max={90} className={inputClass} />
                    </label>
                    <label className="flex flex-col gap-1.5 text-sm font-medium">
                      Longitude (optional)
                      <input name="lng" type="number" step="any" min={-180} max={180} className={inputClass} />
                    </label>
                  </div>
                </ActionDialog>
              )
            }
          >
            {c.localities.length === 0 ? (
              <Empty title="No areas yet">Add them one by one, or import PIN codes with their areas below.</Empty>
            ) : (
              <Table head={['Area', 'Point', 'PIN codes', 'On']} numeric={[2]}>
                {c.localities.map((l) => (
                  <tr key={l.id}>
                    <Td className="font-medium">{l.name}</Td>
                    <Td className="text-sm text-muted">{l.lat !== null ? `${l.lat.toFixed(4)}, ${l.lng?.toFixed(4)}` : 'Not set'}</Td>
                    <Td className="text-right tabular-nums">{l.pincodes}</Td>
                    <Td>{manage ? <ToggleForm action={setLocalityActive.bind(null, c.id, l.id)} checked={l.isActive} label={`${l.name} switched on`} /> : l.isActive ? 'Yes' : 'No'}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Panel>

          <Panel
            title={`PIN codes (${formatNumber(c.pincodes)})`}
            actions={
              manage && (
                <ActionDialog label="Add a PIN code" title={`Add a PIN code to ${c.name}`} action={createPincode.bind(null, c.id)} submitLabel="Add PIN code" size="sm">
                  <label className="flex flex-col gap-1.5 text-sm font-medium">
                    PIN code
                    <input name="code" required pattern="[1-9][0-9]{5}" inputMode="numeric" className={inputClass} />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm font-medium">
                    Area
                    <Select name="localityId" defaultValue="">
                      <option value="">No area</option>
                      {c.localities.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                </ActionDialog>
              )
            }
          >
            <form className="flex flex-wrap items-end gap-3 border-b border-line-soft px-4 py-3" role="search">
              <div className="min-w-48 flex-1">
                <label htmlFor="q" className="sr-only">
                  Search PIN codes
                </label>
                <Input id="q" name="q" defaultValue={sp.q ?? ''} placeholder="Start of a PIN code, or an area" />
              </div>
              <button className={buttonClass('secondary')}>Search</button>
            </form>
            {pins.items.length === 0 ? (
              <Empty title={sp.q ? 'No PIN codes match' : 'No PIN codes yet'} />
            ) : (
              <>
                <Table head={['PIN code', 'Area', 'Point', '']}>
                  {pins.items.map((p) => (
                    <tr key={p.code}>
                      <Td className="font-mono">{p.code}</Td>
                      <Td className="text-sm">{p.locality?.name ?? <span className="text-muted">—</span>}</Td>
                      <Td className="text-sm text-muted">{p.lat !== null ? `${p.lat.toFixed(4)}, ${p.lng?.toFixed(4)}` : 'From the area or city'}</Td>
                      <Td className="text-right">
                        {manage && (
                          <ActionDialog label="Remove" size="sm" variant="quiet" title={`Remove ${p.code}?`} description="Addresses with it are kept; it just stops filling in the city and area." action={deletePincode.bind(null, c.id, p.code)} submitLabel="Remove" danger />
                        )}
                      </Td>
                    </tr>
                  ))}
                </Table>
                <Pagination meta={pins.meta} basePath={`/locations/cities/${c.id}`} params={{ q: sp.q }} />
              </>
            )}
          </Panel>

          {manage && (
            <Panel title="Import PIN codes and areas">
              <ImportForm action={importPlaces.bind(null, c.id)} />
            </Panel>
          )}
        </div>

        <aside className="flex flex-col gap-6">
          <Panel title="City">
            <div className="px-4 py-4">
              {manage ? (
                <InlineForm action={saveCity.bind(null, c.id)} className="flex flex-col gap-3">
                  <label className="flex flex-col gap-1.5 text-sm font-medium">
                    Name
                    <input name="name" defaultValue={c.name} required minLength={2} maxLength={60} className={inputClass} />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm font-medium">
                    State
                    <Select name="stateCode" defaultValue={c.state.code}>
                      {states.map((s) => (
                        <option key={s.code} value={s.code}>
                          {s.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex flex-col gap-1.5 text-sm font-medium">
                      Latitude
                      <input name="lat" type="number" step="any" defaultValue={c.lat} className={inputClass} />
                    </label>
                    <label className="flex flex-col gap-1.5 text-sm font-medium">
                      Longitude
                      <input name="lng" type="number" step="any" defaultValue={c.lng} className={inputClass} />
                    </label>
                  </div>
                  <label className="flex flex-col gap-1.5 text-sm font-medium">
                    Order in lists
                    <input name="sortOrder" type="number" min={0} defaultValue={c.sortOrder} className={inputClass} />
                  </label>
                  <SubmitButton size="sm">Save</SubmitButton>
                </InlineForm>
              ) : (
                <Facts items={[['State', c.state.name], ['Centre', `${c.lat}, ${c.lng}`]]} />
              )}
            </div>
          </Panel>
          {manage && (
            <Panel title="Switches">
              <div className="flex flex-col gap-3 px-4 py-4 text-sm">
                <span className="flex items-center justify-between gap-3">
                  Services live
                  <ToggleForm action={setCityFlag.bind(null, c.id, 'servicesLive')} checked={c.servicesLive} label="Services live" />
                </span>
                <span className="flex items-center justify-between gap-3">
                  City switched on
                  <ToggleForm action={setCityFlag.bind(null, c.id, 'isActive')} checked={c.isActive} label="City switched on" />
                </span>
                <p className="text-xs text-muted">With services live, people within {c.coverageRadiusKm} km see services here; others see that PetApp isn’t in their area yet.</p>
              </div>
            </Panel>
          )}
        </aside>
      </div>
    </>
  );
}
