'use server';

import { revalidatePath } from 'next/cache';
import { act, api, type ActionState } from '@/lib/api';
import type { ImportResult } from '@/lib/types';

const text = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const num = (fd: FormData, k: string) => {
  const v = text(fd, k);
  return v === '' ? undefined : Number(v);
};
/** "₹49" or "49" → 4900 paise; empty → null (the standard setting). */
const paise = (fd: FormData, k: string) => {
  const v = text(fd, k).replace(/[₹,\s]/g, '');
  return v === '' ? null : Math.round(Number(v) * 100);
};
const list = (fd: FormData, k: string) =>
  text(fd, k)
    .split(/[\s,]+/)
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);

// ── cities ──
export async function createCity(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await act(
    () => api('/admin/locations/cities', { method: 'POST', body: { name: text(fd, 'name'), stateCode: text(fd, 'stateCode'), lat: num(fd, 'lat'), lng: num(fd, 'lng') } }),
    'City added.',
  );
  revalidatePath('/locations/cities');
  return r;
}

export async function saveCity(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await act(
    () =>
      api(`/admin/locations/cities/${id}`, {
        method: 'PATCH',
        body: { name: text(fd, 'name'), stateCode: text(fd, 'stateCode'), lat: num(fd, 'lat'), lng: num(fd, 'lng'), sortOrder: num(fd, 'sortOrder') },
      }),
    'Saved.',
  );
  revalidatePath(`/locations/cities/${id}`);
  return r;
}

export async function setCityFlag(id: string, field: 'isActive' | 'servicesLive', _: ActionState, fd: FormData): Promise<ActionState> {
  const on = fd.get('enabled') === 'true';
  const r = await act(
    () => api(`/admin/locations/cities/${id}`, { method: 'PATCH', body: { [field]: on } }),
    field === 'servicesLive' ? (on ? 'Services are live here.' : 'Services switched off here.') : on ? 'City switched on.' : 'City switched off.',
  );
  revalidatePath('/locations/cities');
  revalidatePath(`/locations/cities/${id}`);
  revalidatePath('/locations/coverage');
  return r;
}

// ── areas and PIN codes ──
export async function createLocality(cityId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await act(
    () => api(`/admin/locations/cities/${cityId}/localities`, { method: 'POST', body: { name: text(fd, 'name'), lat: num(fd, 'lat'), lng: num(fd, 'lng') } }),
    'Area added.',
  );
  revalidatePath(`/locations/cities/${cityId}`);
  return r;
}

export async function setLocalityActive(cityId: string, id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const on = fd.get('enabled') === 'true';
  const r = await act(() => api(`/admin/locations/localities/${id}`, { method: 'PATCH', body: { isActive: on } }), on ? 'Area switched on.' : 'Area switched off.');
  revalidatePath(`/locations/cities/${cityId}`);
  return r;
}

export async function createPincode(cityId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await act(
    () =>
      api(`/admin/locations/cities/${cityId}/pincodes`, {
        method: 'POST',
        body: { code: text(fd, 'code'), localityId: text(fd, 'localityId') || null, lat: num(fd, 'lat'), lng: num(fd, 'lng') },
      }),
    'PIN code added.',
  );
  revalidatePath(`/locations/cities/${cityId}`);
  return r;
}

export async function deletePincode(cityId: string, code: string): Promise<ActionState> {
  const r = await act(() => api(`/admin/locations/pincodes/${code}`, { method: 'DELETE' }), `${code} removed.`);
  revalidatePath(`/locations/cities/${cityId}`);
  return r;
}

export type ImportState = (ActionState & { result?: ImportResult }) | null;

/** Checks the file first ("Check"), or imports it ("Import"). */
export async function importPlaces(cityId: string, _: ImportState, fd: FormData): Promise<ImportState> {
  const file = fd.get('file');
  const csv = file instanceof File && file.size ? await file.text() : text(fd, 'csv');
  if (!csv) return { ok: false, message: 'Choose a CSV file, or paste the rows.', at: Date.now() };
  const dryRun = fd.get('mode') !== 'import';
  let result: ImportResult | undefined;
  const r = await act(async () => {
    result = await api<ImportResult>(`/admin/locations/cities/${cityId}/import`, { method: 'POST', body: { csv, dryRun } });
  }, dryRun ? 'Checked. Nothing has changed yet.' : 'Imported.');
  if (!dryRun) revalidatePath(`/locations/cities/${cityId}`);
  return r ? { ...r, result } : r;
}

// ── delivery zones ──
function zoneBody(fd: FormData) {
  return {
    name: text(fd, 'name'),
    pincodes: list(fd, 'pincodes'),
    cityIds: fd.getAll('cityIds').map(String).filter(Boolean),
    stateCodes: list(fd, 'stateCodes'),
    deliverable: fd.get('deliverable') !== 'no',
    shippingFlatPaise: paise(fd, 'shipping'),
    freeAbovePaise: paise(fd, 'freeAbove'),
    minDays: num(fd, 'minDays'),
    maxDays: num(fd, 'maxDays'),
    note: text(fd, 'note') || null,
  };
}

export async function createZone(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await act(() => api('/admin/locations/zones', { method: 'POST', body: zoneBody(fd) }), 'Zone added.');
  revalidatePath('/locations/zones');
  return r;
}

export async function saveZone(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await act(() => api(`/admin/locations/zones/${id}`, { method: 'PATCH', body: zoneBody(fd) }), 'Saved.');
  revalidatePath('/locations/zones');
  return r;
}

export async function setZoneActive(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const on = fd.get('enabled') === 'true';
  const r = await act(() => api(`/admin/locations/zones/${id}`, { method: 'PATCH', body: { isActive: on } }), on ? 'Zone on.' : 'Zone off.');
  revalidatePath('/locations/zones');
  return r;
}

export async function deleteZone(id: string): Promise<ActionState> {
  const r = await act(() => api(`/admin/locations/zones/${id}`, { method: 'DELETE' }), 'Zone deleted.');
  revalidatePath('/locations/zones');
  return r;
}

// ── partner locations ──
export async function savePartnerLocation(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await act(
    () =>
      api(`/admin/locations/partners/${id}`, {
        method: 'PATCH',
        body: {
          area: text(fd, 'area') || null, city: text(fd, 'city'), pincode: text(fd, 'pincode'), lat: num(fd, 'lat'), lng: num(fd, 'lng'),
          homeVisitRadiusKm: num(fd, 'radius'), reason: text(fd, 'reason'),
        },
      }),
    'Location saved.',
  );
  revalidatePath('/locations/partners');
  return r;
}
