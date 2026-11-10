'use server';

import { ApiError, api, type ActionState } from '@/lib/api';

/** Asks the API to email a reset link. The answer is the same whether or not the address is a staff account. */
export async function requestReset(_: ActionState, fd: FormData): Promise<ActionState> {
  const email = String(fd.get('email') ?? '').trim();
  if (!email) return { ok: false, message: 'Enter your work email.' };
  try {
    const r = await api<{ message: string }>('/admin/auth/password/forgot', {
      method: 'POST',
      body: { email },
      anonymous: true,
    });
    return { ok: true, message: r.message, at: Date.now() };
  } catch (e) {
    if (e instanceof ApiError)
      return {
        ok: false,
        message: e.status === 429 ? 'Too many requests. Wait a minute and try again.' : e.message,
      };
    throw e;
  }
}

/** Sets the new password from the emailed link. */
export async function resetPassword(_: ActionState, fd: FormData): Promise<ActionState> {
  const token = String(fd.get('token') ?? '');
  const newPassword = String(fd.get('newPassword') ?? '');
  if (newPassword !== String(fd.get('confirm') ?? ''))
    return { ok: false, message: 'The two passwords don’t match.' };
  try {
    await api('/admin/auth/password/reset', {
      method: 'POST',
      body: { token, newPassword },
      anonymous: true,
    });
    return { ok: true, message: 'Password set. Sign in with it now.', at: Date.now() };
  } catch (e) {
    if (e instanceof ApiError)
      return {
        ok: false,
        message: e.status === 429 ? 'Too many attempts. Wait a minute and try again.' : e.message,
      };
    throw e;
  }
}
