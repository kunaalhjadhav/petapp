'use server';

import { revalidatePath } from 'next/cache';
import { act, api, type ActionState } from '@/lib/api';

/** Hide a review (it stops counting towards the rating) or show it again. */
export async function setReviewStatus(
  kind: 'PRODUCT' | 'SERVICE',
  id: string,
  status: 'VISIBLE' | 'HIDDEN',
  _: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const note = String(fd.get('note') ?? '').trim();
  if (status === 'HIDDEN' && note.length < 3) return { ok: false, message: 'Say why in a few words. It is saved in the audit log.' };
  const res = await act(
    () =>
      api(`/admin/${kind === 'PRODUCT' ? 'product' : 'service'}-reviews/${id}/status`, {
        method: 'POST',
        body: { status, ...(note ? { note } : {}) },
      }),
    status === 'HIDDEN' ? 'Review hidden' : 'Review shown again',
  );
  revalidatePath('/reviews');
  return res;
}
