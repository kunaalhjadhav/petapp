'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { act, api, type ActionState } from '@/lib/api';

const bad = (message: string): ActionState => ({ ok: false, message, at: Date.now() });
const done = (id?: string) => {
  revalidatePath('/home-screen');
  if (id) revalidatePath(`/home-screen/${id}`);
};

export async function createSection(_: ActionState, fd: FormData): Promise<ActionState> {
  const kind = String(fd.get('kind') ?? '');
  const title = String(fd.get('title') ?? '').trim();
  const subtitle = String(fd.get('subtitle') ?? '').trim();
  if (!kind) return bad('Choose what the section shows.');
  if (title.length < 2) return bad('Give the section a title.');
  const r = await act(
    () =>
      api('/admin/home-sections', {
        method: 'POST',
        body: { kind, title, ...(subtitle ? { subtitle } : {}) },
      }),
    'Section added at the end. It is live now.',
  );
  done();
  return r;
}

/** Moves a section one place up or down. `order` is every section id in the current order. */
export async function moveSection(order: string[], id: string, by: -1 | 1): Promise<ActionState> {
  const i = order.indexOf(id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= order.length) return bad('It is already at the end.');
  const next = [...order];
  [next[i], next[j]] = [next[j], next[i]];
  const r = await act(
    () => api('/admin/home-sections/order', { method: 'PUT', body: { ids: next } }),
    '',
  );
  done();
  return r;
}

export async function setSectionActive(
  id: string,
  _: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const isActive = fd.get('isActive') === 'true';
  const r = await act(
    () => api(`/admin/home-sections/${id}`, { method: 'PATCH', body: { isActive } }),
    isActive ? 'Shown in the app' : 'Hidden from the app',
  );
  done(id);
  return r;
}

export async function saveSection(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const s = (k: string) => String(fd.get(k) ?? '').trim();
  const offset = Number(s('tzOffset') || '0');
  // datetime-local values carry no zone; the browser sends its offset alongside.
  const when = (v: string) =>
    v ? new Date(new Date(`${v}:00Z`).getTime() + offset * 60_000).toISOString() : null;
  const limit = Number(s('itemLimit'));
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) return bad('Show 1 to 20 items.');
  const startsAt = when(s('startsAt'));
  const endsAt = when(s('endsAt'));
  if (startsAt && endsAt && startsAt >= endsAt) return bad('The end must be after the start.');
  const cities = s('cities')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  const r = await act(
    () =>
      api(`/admin/home-sections/${id}`, {
        method: 'PATCH',
        body: {
          title: s('title'),
          subtitle: s('subtitle') || null,
          itemLimit: limit,
          startsAt,
          endsAt,
          cities,
          speciesIds: fd.getAll('speciesIds').map(String),
        },
      }),
    'Saved. Recorded in the audit log.',
  );
  done(id);
  return r;
}

export async function deleteSection(id: string): Promise<ActionState> {
  const r = await act(() => api(`/admin/home-sections/${id}`, { method: 'DELETE' }), 'Deleted');
  if (!r?.ok) return r;
  done();
  redirect('/home-screen');
}

export async function addPin(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const ref = String(fd.get('ref') ?? '').trim();
  if (!ref) return bad('Paste a link, or enter a slug, @handle, code or id.');
  const r = await act(
    () => api(`/admin/home-sections/${id}/pins`, { method: 'POST', body: { ref } }),
    'Pinned',
  );
  done(id);
  return r;
}

export async function removePin(id: string, itemId: string): Promise<ActionState> {
  const r = await act(
    () => api(`/admin/home-sections/${id}/pins/${itemId}`, { method: 'DELETE' }),
    'Unpinned',
  );
  done(id);
  return r;
}

export async function saveRecoSettings(
  current: { personalised: boolean; historyDays: number },
  _: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const personalised = fd.get('personalised') === 'on';
  const raw = String(fd.get('historyDays') ?? '').trim();
  const days = /^\d{1,3}$/.test(raw) ? Number(raw) : NaN;
  if (!(days >= 1 && days <= 365)) return bad('Keep viewing history for 1 to 365 days.');
  const changes: Array<[string, unknown]> = [];
  if (personalised !== current.personalised)
    changes.push(['reco.personalisationEnabled', personalised]);
  if (days !== current.historyDays) changes.push(['reco.historyDays', days]);
  if (!changes.length) return { ok: true, message: 'Nothing changed', at: Date.now() };
  const r = await act(async () => {
    for (const [key, value] of changes)
      await api(`/admin/settings/${key}`, { method: 'PUT', body: { value } });
  }, 'Saved. Recorded in the audit log.');
  revalidatePath('/home-screen');
  return r;
}
