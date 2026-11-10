import type { CityRow, DeliveryZoneRow } from '@/lib/types';
import { Select, inputClass } from '@/components/ui';

const rupees = (p: number | null | undefined) => (p === null || p === undefined ? '' : String(p / 100));

/** The fields of a delivery zone, for the add and edit dialogs. */
export function ZoneFields({ zone, cities }: { zone?: DeliveryZoneRow; cities: CityRow[] }) {
  return (
    <>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Name
        <input name="name" defaultValue={zone?.name} required minLength={2} maxLength={80} className={inputClass} placeholder="e.g. Pune city" />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        PIN codes
        <textarea name="pincodes" rows={2} defaultValue={zone?.pincodes.join(', ')} className={`${inputClass} h-auto py-2 font-mono text-xs`} placeholder="411001, 4110*" />
        <span className="text-xs font-normal text-muted">Full PIN codes, or prefixes ending in * (4110* is every PIN starting 4110).</span>
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Cities
        <select name="cityIds" multiple defaultValue={zone?.cityIds} className={`${inputClass} h-28 py-1`}>
          {cities.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}, {c.state.code}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        States
        <input name="stateCodes" defaultValue={zone?.stateCodes.join(', ')} className={`${inputClass} font-mono`} placeholder="MH, GA" />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Deliver here?
        <Select name="deliverable" defaultValue={zone && !zone.deliverable ? 'no' : 'yes'}>
          <option value="yes">Yes</option>
          <option value="no">No: the shop doesn’t deliver here</option>
        </Select>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Shipping per parcel (₹)
          <input name="shipping" inputMode="decimal" defaultValue={rupees(zone?.shippingFlatPaise)} className={inputClass} placeholder="Standard" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Free above (₹)
          <input name="freeAbove" inputMode="decimal" defaultValue={rupees(zone?.freeAbovePaise)} className={inputClass} placeholder="Standard" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Earliest (days)
          <input name="minDays" type="number" min={0} max={60} defaultValue={zone?.minDays ?? 2} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Latest (days)
          <input name="maxDays" type="number" min={0} max={60} defaultValue={zone?.maxDays ?? 5} className={inputClass} />
        </label>
      </div>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Note for customers (optional)
        <input name="note" defaultValue={zone?.note ?? ''} maxLength={300} className={inputClass} placeholder="Shown when delivery isn’t possible" />
      </label>
    </>
  );
}
