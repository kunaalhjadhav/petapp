'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, api, act, type ActionState } from '@/lib/api';

/** Erases the account now. It is still held back while an order, booking, refund or payout is in progress. */
export async function eraseNow(userId: string): Promise<ActionState> {
  try {
    const r = await api<{ status: string; reasons?: string[] }>(
      `/admin/privacy/deletions/${userId}/erase`,
      { method: 'POST' },
    );
    revalidatePath('/privacy');
    if (r.status === 'deferred')
      return {
        ok: false,
        message: `Not erased yet: ${(r.reasons ?? []).join('; ')}.`,
        at: Date.now(),
      };
    if (r.status !== 'erased')
      return {
        ok: false,
        message: 'Nothing to erase: the account is no longer waiting.',
        at: Date.now(),
      };
    return { ok: true, message: 'Erased. Recorded in the audit log.', at: Date.now() };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, message: e.message, at: Date.now() };
    throw e;
  }
}

export async function cancelDeletion(userId: string): Promise<ActionState> {
  const r = await act(
    () => api(`/admin/privacy/deletions/${userId}/cancel`, { method: 'POST' }),
    'Deletion cancelled. The account is active again.',
  );
  revalidatePath('/privacy');
  return r;
}
