import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { ApiError, api, apiPage } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatPaise as rupees } from '@/lib/money';
import type { CityRow, DeliveryZoneRow } from '@/lib/types';
import { Empty, Input, NoAccess, PageHeader, Panel, Tag, buttonClass } from '@/components/ui';
import { ActionDialog, ToggleForm } from '@/components/forms';
import { Table, Td } from '@/components/table';
import { createZone, deleteZone, saveZone, setZoneActive } from '../actions';
import { ZoneFields } from './zone-fields';

export const metadata: Metadata = { title: 'Delivery zones' };
export const dynamic = 'force-dynamic';

type Check = { pincode: string; known: boolean; city: { name: string } | null; deliverable: boolean; zone: { name: string } | null; line: string | null; problem: string | null };

/** Where the shop delivers, its shipping charge and delivery time there (spec §45). */
export default async function ZonesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const me = await getMe();
  if (!can(me, PERMISSIONS.LOCATIONS_READ)) return <NoAccess what="delivery zones" />;
  const manage = can(me, PERMISSIONS.LOCATIONS_MANAGE);
  const [zones, cities] = await Promise.all([api<DeliveryZoneRow[]>('/admin/locations/zones'), apiPage<CityRow>('/admin/locations/cities', { show: 'active', limit: 100 })]);
  let check: Check | null = null;
  let checkError: string | null = null;
  if (sp.pincode) {
    try {
      check = await api<Check>('/admin/locations/zones/check', { query: { pincode: sp.pincode } });
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      checkError = e.message;
    }
  }
  const covers = (z: DeliveryZoneRow) => [...z.pincodes, ...z.cities.map((c) => c.name), ...z.stateCodes].join(', ');
  return (
    <>
      <PageHeader
        back={{ href: '/locations/cities', label: 'Cities' }}
        title="Delivery zones"
        description="Shipping and delivery time by place. The most specific zone wins: a PIN code, then a PIN prefix, then a city, then a state. Places outside every zone use the standard shipping settings, unless “Only deliver inside zones” is on in Features & settings."
        actions={
          manage && (
            <ActionDialog label="Add a zone" title="Add a delivery zone" action={createZone} submitLabel="Add zone" variant="primary">
              <ZoneFields cities={cities.items} />
            </ActionDialog>
          )
        }
      />
      <Panel title="Check a PIN code" className="mb-6">
        <form className="flex flex-wrap items-end gap-3 px-4 py-3">
          <label htmlFor="pincode" className="sr-only">
            PIN code
          </label>
          <Input id="pincode" name="pincode" defaultValue={sp.pincode ?? ''} placeholder="411001" inputMode="numeric" className="w-40" />
          <button className={buttonClass('secondary')}>Check</button>
          {check && (
            <p role="status" className="text-sm">
              <span className="font-mono">{check.pincode}</span> {check.known ? `(${check.city?.name})` : '(not in the PIN code list)'}:{' '}
              {check.deliverable ? (check.zone ? `${check.zone.name}. ${check.line}.` : 'no zone; standard shipping.') : <span className="text-danger">{check.problem}</span>}
            </p>
          )}
          {checkError && <p className="text-sm text-danger">{checkError}</p>}
        </form>
      </Panel>
      <Panel>
        {zones.length === 0 ? (
          <Empty title="No delivery zones">Without zones, every address uses the standard shipping settings.</Empty>
        ) : (
          <Table head={['Zone', 'Covers', 'Shipping', 'Delivery', 'On', '']}>
            {zones.map((z) => (
              <tr key={z.id} className="align-top">
                <Td>
                  <span className="font-medium">{z.name}</span>
                  {!z.deliverable && (
                    <span className="ml-2">
                      <Tag tone="danger">No delivery</Tag>
                    </span>
                  )}
                  {z.note && <span className="block text-xs text-muted">{z.note}</span>}
                </Td>
                <Td className="max-w-[28ch] text-sm text-muted">{covers(z)}</Td>
                <Td className="text-sm">
                  {z.shippingFlatPaise === null ? 'Standard' : z.shippingFlatPaise === 0 ? 'Free' : rupees(z.shippingFlatPaise)}
                  {z.freeAbovePaise !== null && <span className="block text-xs text-muted">free above {rupees(z.freeAbovePaise)}</span>}
                </Td>
                <Td className="whitespace-nowrap text-sm">{z.deliverable ? `${z.minDays}–${z.maxDays} days` : '—'}</Td>
                <Td>{manage ? <ToggleForm action={setZoneActive.bind(null, z.id)} checked={z.isActive} label={`${z.name} on`} /> : z.isActive ? 'Yes' : 'No'}</Td>
                <Td className="whitespace-nowrap text-right">
                  {manage && (
                    <span className="inline-flex gap-1">
                      <ActionDialog label="Edit" size="sm" title={`Edit ${z.name}`} action={saveZone.bind(null, z.id)} submitLabel="Save">
                        <ZoneFields zone={z} cities={cities.items} />
                      </ActionDialog>
                      <ActionDialog label="Delete" size="sm" variant="quiet" title={`Delete ${z.name}?`} action={deleteZone.bind(null, z.id)} submitLabel="Delete" danger />
                    </span>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}
