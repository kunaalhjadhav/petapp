'use server';

import { revalidatePath } from 'next/cache';
import { act, api, type ActionState } from '@/lib/api';

export async function setPetVerified(
  id: string,
  isVerified: boolean,
  _: ActionState,
): Promise<ActionState> {
  const res = await act(
    () => api(`/admin/pets/${id}/verify`, { method: 'PATCH', body: { isVerified } }),
    isVerified ? 'Marked as verified' : 'Verification removed',
  );
  revalidatePath(`/pets/${id}`);
  return res;
}

export async function setPetStatus(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const status = String(fd.get('status'));
  const reason = String(fd.get('reason') ?? '').trim();
  if (!['ACTIVE', 'HIDDEN', 'REMOVED'].includes(status))
    return { ok: false, message: 'Choose a status.' };
  if (reason.length < 3)
    return {
      ok: false,
      message: 'Give a reason of at least 3 characters. It is saved in the history.',
    };
  const res = await act(
    () => api(`/admin/pets/${id}/status`, { method: 'PATCH', body: { status, reason } }),
    'Pet status updated',
  );
  revalidatePath(`/pets/${id}`);
  return res;
}
