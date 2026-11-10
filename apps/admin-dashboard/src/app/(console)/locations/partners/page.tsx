import Link from 'next/link';
import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { apiPage } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { PARTNER_STATUS } from '@/lib/labels';
import type { CityRow, PartnerLocationRow } from '@/lib/types';
import { Empty, Input, NoAccess, PageHeader, Panel, Select, Tag, buttonClass, inputClass } from '@/components/ui';
import { ActionDialog } from '@/components/forms';
import { Pagination, Table, Td } from '@/components/table';
import { savePartnerLocation } from '../actions';

export const metadata: Metadata = { title: 'Partner locations' };
export const dynamic = 'force-dynamic';

/** Where each service partner is, how far they travel, and whether they're inside service coverage (spec §45). */
export default async function PartnerLocationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const me = await getMe();
  if (!can(me, PERMISSIONS.LOCATIONS_READ)) return <NoAccess what="partner locations" />;
  const manage = can(me, PERMISSIONS.LOCATIONS_MANAGE);
  const [cities, { items, meta }] = await Promise.all([
    apiPage<CityRow>('/admin/locations/cities', { show: 'active', limit: 100 }),
    apiPage<PartnerLocationRow>('/admin/locations/partners', { q: sp.q, cityId: sp.cityId, outside: sp.outside, page: sp.page, limit: 50 }),
  ]);
  return (
    <>
      <PageHeader
        back={{ href: '/locations/cities', label: 'Cities' }}
        title="Partner locations"
        description="Each partner’s address, map point and home-visit radius. Partners set these in their app; correct them here when they’re wrong (the reason goes in the audit log)."
      />
      <Panel>
        <form className="flex flex-wrap items-end gap-3 border-b border-line-soft px-4 py-3" role="search">
          <div className="min-w-56 flex-1">
            <label htmlFor="q" className="sr-only">
              Search partners
            </label>
            <Input id="q" name="q" defaultValue={sp.q ?? ''} placeholder="Business, area or PIN code" />
          </div>
          <div>
            <label htmlFor="cityId" className="sr-only">
              Near city
            </label>
            <Select id="cityId" name="cityId" defaultValue={sp.cityId ?? ''}>
              <option value="">Anywhere</option>
              {cities.items.map((c) => (
                <option key={c.id} value={c.id}>
                  Near {c.name}
                </option>
              ))}
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="outside" value="true" defaultChecked={sp.outside === 'true'} />
            Outside coverage only
          </label>
          <button className={buttonClass('secondary')}>Filter</button>
        </form>
        {items.length === 0 ? (
          <Empty title="No partners match" />
        ) : (
          <>
            <Table head={['Partner', 'Address', 'Nearest city', 'Home visits', 'Coverage', '']}>
              {items.map((p) => (
                <tr key={p.id} className="align-top">
                  <Td>
                    <Link href={`/partners/${p.id}`} className="font-medium text-teal hover:underline">
                      {p.businessName}
                    </Link>
                    <span className="mt-0.5 block">
                      <Tag tone={PARTNER_STATUS[p.status]?.tone ?? 'neutral'}>{PARTNER_STATUS[p.status]?.label ?? p.status}</Tag>
                    </span>
                  </Td>
                  <Td className="max-w-[30ch] text-sm">
                    {[p.addressLine, p.area, p.city].filter(Boolean).join(', ')} <span className="font-mono">{p.pincode}</span>
                    <span className="block text-xs text-muted">
                      {p.lat.toFixed(5)}, {p.lng.toFixed(5)}
                    </span>
                  </Td>
                  <Td className="text-sm">{p.nearestCity ? `${p.nearestCity.name}, ${p.nearestCity.distanceKm} km` : '—'}</Td>
                  <Td className="text-sm">{p.homeVisitRadiusKm ? `Up to ${p.homeVisitRadiusKm} km` : 'No'}</Td>
                  <Td>{p.covered ? <Tag tone="good">Covered</Tag> : <Tag tone="warn">Outside</Tag>}</Td>
                  <Td className="text-right">
                    {manage && (
                      <ActionDialog label="Correct" size="sm" title={`Location of ${p.businessName}`} action={savePartnerLocation.bind(null, p.id)} submitLabel="Save">
                        <div className="grid grid-cols-2 gap-3">
                          <label className="flex flex-col gap-1.5 text-sm font-medium">
                            Area
                            <input name="area" defaultValue={p.area ?? ''} maxLength={100} className={inputClass} />
                          </label>
                          <label className="flex flex-col gap-1.5 text-sm font-medium">
                            City
                            <input name="city" defaultValue={p.city} required minLength={2} maxLength={80} className={inputClass} />
                          </label>
                          <label className="flex flex-col gap-1.5 text-sm font-medium">
                            PIN code
                            <input name="pincode" defaultValue={p.pincode} pattern="[1-9][0-9]{5}" required className={inputClass} />
                          </label>
                          <label className="flex flex-col gap-1.5 text-sm font-medium">
                            Home visits up to (km)
                            <input name="radius" type="number" min={0} max={100} defaultValue={p.homeVisitRadiusKm} className={inputClass} />
                          </label>
                          <label className="flex flex-col gap-1.5 text-sm font-medium">
                            Latitude
                            <input name="lat" type="number" step="any" defaultValue={p.lat} required className={inputClass} />
                          </label>
                          <label className="flex flex-col gap-1.5 text-sm font-medium">
                            Longitude
                            <input name="lng" type="number" step="any" defaultValue={p.lng} required className={inputClass} />
                          </label>
                        </div>
                        <label className="flex flex-col gap-1.5 text-sm font-medium">
                          Why
                          <input name="reason" required minLength={3} maxLength={300} className={inputClass} placeholder="For the audit log" />
                        </label>
                      </ActionDialog>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
            <Pagination meta={meta} basePath="/locations/partners" params={{ q: sp.q, cityId: sp.cityId, outside: sp.outside }} />
          </>
        )}
      </Panel>
    </>
  );
}
