'use server';

import { revalidatePath } from 'next/cache';
import { act, api, type ActionState } from '@/lib/api';

const RESOLUTIONS = ['DISMISSED', 'CONTENT_HIDDEN', 'CONTENT_REMOVED', 'USER_SUSPENDED'] as const;

export async function resolveCase(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const resolution = String(fd.get('resolution') ?? '');
  const note = String(fd.get('note') ?? '').trim();
  if (!RESOLUTIONS.includes(resolution as (typeof RESOLUTIONS)[number]))
    return { ok: false, message: 'Choose a decision.' };
  if (note.length < 3)
    return {
      ok: false,
      message: 'Explain the decision in a few words. It is saved in the audit log.',
    };
  const res = await act(
    () =>
      api(`/admin/moderation/cases/${id}/resolve`, { method: 'POST', body: { resolution, note } }),
    'Case resolved',
  );
  revalidatePath(`/moderation/${id}`);
  revalidatePath('/moderation');
  return res;
}
