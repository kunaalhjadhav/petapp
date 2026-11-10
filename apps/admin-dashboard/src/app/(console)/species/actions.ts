'use server';

import { revalidatePath } from 'next/cache';
import { act, api, type ActionState } from '@/lib/api';

const done = <T>(r: T) => {
  revalidatePath('/species');
  return r;
};

export async function createSpecies(_: ActionState, fd: FormData): Promise<ActionState> {
  const name = String(fd.get('name') ?? '').trim();
  const key =
    String(fd.get('key') ?? '')
      .trim()
      .toLowerCase() ||
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  if (!name) return { ok: false, message: 'Enter a name.' };
  return done(
    await act(
      () => api('/admin/species', { method: 'POST', body: { key, name } }),
      `${name} added`,
    ),
  );
}

export async function setSpeciesActive(
  id: string,
  _: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const isActive = fd.get('enabled') === 'true';
  return done(
    await act(
      () => api(`/admin/species/${id}`, { method: 'PATCH', body: { isActive } }),
      isActive ? 'Shown in the app' : 'Hidden from the app',
    ),
  );
}

export async function addBreed(
  speciesId: string,
  _: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const name = String(fd.get('name') ?? '').trim();
  if (!name) return { ok: false, message: 'Enter a breed name.' };
  return done(
    await act(
      () => api(`/admin/species/${speciesId}/breeds`, { method: 'POST', body: { name } }),
      `${name} added`,
    ),
  );
}

export async function setBreedActive(
  id: string,
  _: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const isActive = fd.get('enabled') === 'true';
  return done(
    await act(
      () => api(`/admin/breeds/${id}`, { method: 'PATCH', body: { isActive } }),
      isActive ? 'Shown' : 'Hidden',
    ),
  );
}

export async function renameBreed(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const name = String(fd.get('name') ?? '').trim();
  if (!name) return { ok: false, message: 'Enter a breed name.' };
  return done(
    await act(() => api(`/admin/breeds/${id}`, { method: 'PATCH', body: { name } }), 'Renamed'),
  );
}
