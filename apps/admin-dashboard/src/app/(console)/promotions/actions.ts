'use server';

import { revalidatePath } from 'next/cache';
import { act, api, type ActionState } from '@/lib/api';

const text = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

/** "2026-10-21T18:00" typed in India time → an instant. Empty → now. */
const istInstant = (v: string) => (v ? new Date(`${v}:00+05:30`).toISOString() : undefined);

export async function createPromotion(_: ActionState, fd: FormData): Promise<ActionState> {
  const audience = text(fd, 'audience');
  const r = await act(
    () =>
      api('/admin/promotions', {
        method: 'POST',
        body: {
          title: text(fd, 'title'),
          body: text(fd, 'body'),
          link: text(fd, 'link') || undefined,
          audience,
          city: audience === 'CITY' ? text(fd, 'city') : undefined,
          sendAt: istInstant(text(fd, 'sendAt')),
        },
      }),
    'Queued. It goes out within a minute of its time, only to people who turned promotions on.',
  );
  revalidatePath('/promotions');
  return r;
}

export async function cancelPromotion(
  id: string,
  _: ActionState,
  _fd: FormData,
): Promise<ActionState> {
  const r = await act(
    () => api(`/admin/promotions/${id}/cancel`, { method: 'POST' }),
    'Cancelled.',
  );
  revalidatePath('/promotions');
  return r;
}
