'use server';

import { revalidatePath } from 'next/cache';
import { act, api, type ActionState } from '@/lib/api';

export async function setFlag(key: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const enabled = fd.get('enabled') === 'true';
  const res = await act(
    () => api(`/admin/flags/${key}`, { method: 'PATCH', body: { enabled } }),
    enabled ? 'Turned on' : 'Turned off',
  );
  revalidatePath('/settings');
  return res;
}

export async function setSetting(
  key: string,
  kind: 'number' | 'string',
  _: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const raw = String(fd.get('value') ?? '').trim();
  let value: string | number = raw;
  if (kind === 'number') {
    value = Number(raw);
    if (!raw || !Number.isFinite(value) || value < 0)
      return { ok: false, message: 'Enter a number of 0 or more.' };
  } else if (!raw) {
    return { ok: false, message: 'Enter a value.' };
  }
  const res = await act(
    () => api(`/admin/settings/${key}`, { method: 'PUT', body: { value } }),
    'Saved',
  );
  revalidatePath('/settings');
  return res;
}
