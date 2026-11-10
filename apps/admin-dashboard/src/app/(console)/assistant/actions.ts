'use server';

import { revalidatePath } from 'next/cache';
import { act, api, type ActionState } from '@/lib/api';

const bad = (message: string): ActionState => ({ ok: false, message, at: Date.now() });

export async function saveAssistantSettings(
  current: { dailyLimit: number; historyDays: number },
  _: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const num = (k: string) => {
    const raw = String(fd.get(k) ?? '').trim();
    return /^\d{1,3}$/.test(raw) ? Number(raw) : NaN;
  };
  const dailyLimit = num('dailyLimit');
  const historyDays = num('historyDays');
  if (!(dailyLimit >= 1 && dailyLimit <= 500)) return bad('Allow 1 to 500 questions a day.');
  if (!(historyDays >= 1 && historyDays <= 365))
    return bad('Keep conversations for 1 to 365 days.');
  const changes: Array<[string, number]> = [];
  if (dailyLimit !== current.dailyLimit) changes.push(['assistant.dailyMessages', dailyLimit]);
  if (historyDays !== current.historyDays) changes.push(['assistant.historyDays', historyDays]);
  if (!changes.length) return { ok: true, message: 'Nothing changed', at: Date.now() };
  const r = await act(async () => {
    for (const [key, value] of changes)
      await api(`/admin/settings/${key}`, { method: 'PUT', body: { value } });
  }, 'Saved. Recorded in the audit log.');
  revalidatePath('/assistant');
  return r;
}
