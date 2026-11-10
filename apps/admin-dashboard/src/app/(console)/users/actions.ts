'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, act, api, type ActionState } from '@/lib/api';

const STATUS = ['ACTIVE', 'SUSPENDED', 'BLOCKED'] as const;

export async function setUserStatus(
  id: string,
  _: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const status = String(fd.get('status'));
  const reason = String(fd.get('reason') ?? '').trim();
  if (!STATUS.includes(status as (typeof STATUS)[number]))
    return { ok: false, message: 'Choose a status.' };
  if (reason.length < 3)
    return {
      ok: false,
      message: 'Give a reason of at least 3 characters. It is saved in the history.',
    };
  const res = await act(
    () => api(`/admin/users/${id}/status`, { method: 'PATCH', body: { status, reason } }),
    'Status updated',
  );
  revalidatePath(`/users/${id}`);
  return res;
}

export async function setUserRoles(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const roleKeys = fd.getAll('roles').map(String);
  if (!roleKeys.length)
    return { ok: false, message: 'Keep at least one role. Most people have Customer.' };
  const res = await act(
    () => api(`/admin/users/${id}/roles`, { method: 'PUT', body: { roleKeys } }),
    'Roles updated',
  );
  revalidatePath(`/users/${id}`);
  return res;
}

/** Emails a staff member a link to set a new password (Phase 9e). The link goes only to their own email. */
export async function sendPasswordReset(id: string, _: ActionState, _fd: FormData): Promise<ActionState> {
  try {
    const r = await api<{ message: string }>(`/admin/auth/staff/${id}/password-reset`, { method: 'POST' });
    return { ok: true, message: r.message, at: Date.now() };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, message: e.message };
    throw e;
  }
}

/** Turns off a staff member's two-factor sign-in after they lost their phone (Phase 10a). They set it up again. */
export async function resetMfa(id: string, _: ActionState, _fd: FormData): Promise<ActionState> {
  try {
    const r = await api<{ message: string }>(`/admin/auth/staff/${id}/mfa-reset`, { method: 'POST' });
    revalidatePath(`/users/${id}`);
    return { ok: true, message: r.message, at: Date.now() };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, message: e.message };
    throw e;
  }
}
