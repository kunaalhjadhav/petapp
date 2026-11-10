'use server';

import { revalidatePath } from 'next/cache';
import { act, api, type ActionState } from '@/lib/api';

export async function updateRole(key: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const body = {
    name: String(fd.get('name') ?? '').trim() || undefined,
    description: String(fd.get('description') ?? '').trim(),
    isStaff: fd.get('isStaff') === 'on',
    permissionKeys: fd.getAll('permissions').map(String),
  };
  const res = await act(() => api(`/admin/roles/${key}`, { method: 'PATCH', body }), 'Role saved');
  revalidatePath('/access');
  return res;
}

export async function createRole(_: ActionState, fd: FormData): Promise<ActionState> {
  const name = String(fd.get('name') ?? '').trim();
  const key =
    String(fd.get('key') ?? '')
      .trim()
      .toUpperCase() ||
    name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
  if (!name) return { ok: false, message: 'Enter a role name.' };
  const res = await act(
    () =>
      api('/admin/roles', {
        method: 'POST',
        body: {
          key,
          name,
          description: String(fd.get('description') ?? '').trim() || undefined,
          isStaff: fd.get('isStaff') === 'on',
          permissionKeys: fd.getAll('permissions').map(String),
        },
      }),
    `${name} created`,
  );
  revalidatePath('/access');
  return res;
}

export async function deleteRole(key: string, _: ActionState): Promise<ActionState> {
  const res = await act(() => api(`/admin/roles/${key}`, { method: 'DELETE' }), 'Role deleted');
  revalidatePath('/access');
  return res;
}
