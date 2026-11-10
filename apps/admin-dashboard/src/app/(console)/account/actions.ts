'use server';

import { revalidatePath } from 'next/cache';
import { act, api, type ActionState } from '@/lib/api';

export async function changePassword(_: ActionState, fd: FormData): Promise<ActionState> {
  const newPassword = String(fd.get('newPassword') ?? '');
  if (newPassword !== String(fd.get('confirm') ?? ''))
    return { ok: false, message: 'The two new passwords don’t match.' };
  const r = await act(
    () =>
      api('/admin/auth/password', {
        method: 'POST',
        body: { currentPassword: String(fd.get('currentPassword') ?? ''), newPassword },
      }),
    'Password changed. You’ve been signed out everywhere else.',
  );
  revalidatePath('/', 'layout');
  return r;
}
