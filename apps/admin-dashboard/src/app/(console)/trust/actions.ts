'use server';

import { revalidatePath } from 'next/cache';
import { act, api, type ActionState } from '@/lib/api';

const bad = (message: string): ActionState => ({ ok: false, message, at: Date.now() });

/** Saves the AI moderation settings that changed. */
export async function saveAiSettings(
  current: { enabled: boolean; flagPct: number; autoHidePct: number },
  _: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const enabled = fd.get('enabled') === 'on';
  const pct = (k: string) => {
    const raw = String(fd.get(k) ?? '').trim();
    return /^\d{1,3}$/.test(raw) && Number(raw) <= 100 ? Number(raw) : null;
  };
  const flagPct = pct('flagPct');
  const autoHidePct = pct('autoHidePct');
  if (flagPct === null || autoHidePct === null) return bad('Enter percentages from 0 to 100.');
  if (autoHidePct > 0 && autoHidePct < flagPct)
    return bad(
      'Hiding should need at least as much confidence as flagging. Raise it, or set 0 to never hide.',
    );
  const changes: Array<[string, unknown]> = [];
  if (enabled !== current.enabled) changes.push(['ai.moderationEnabled', enabled]);
  if (flagPct !== current.flagPct) changes.push(['ai.flagPct', flagPct]);
  if (autoHidePct !== current.autoHidePct) changes.push(['ai.autoHidePct', autoHidePct]);
  if (!changes.length) return { ok: true, message: 'Nothing changed', at: Date.now() };
  const r = await act(async () => {
    for (const [key, value] of changes)
      await api(`/admin/settings/${key}`, { method: 'PUT', body: { value } });
  }, 'Saved. Recorded in the audit log.');
  revalidatePath('/trust');
  return r;
}

export async function reviewRisk(
  userId: string,
  _: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const note = String(fd.get('note') ?? '').trim();
  if (note.length < 3) return bad('Say what you found. It is kept with the account.');
  const r = await act(
    () => api(`/admin/risk/${userId}/review`, { method: 'POST', body: { note } }),
    'Review recorded',
  );
  revalidatePath(`/trust/risk/${userId}`);
  revalidatePath('/trust/risk');
  return r;
}

export async function recomputeRisk(userId: string): Promise<ActionState> {
  const r = await act(
    () => api(`/admin/risk/${userId}/recompute`, { method: 'POST' }),
    'Score updated',
  );
  revalidatePath(`/trust/risk/${userId}`);
  return r;
}
