'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, api, type ActionState } from '@/lib/api';

export async function retryQueue(name: string): Promise<ActionState> {
  try {
    const r = await api<{ retried: number }>(`/admin/system/queues/${name}/retry`, {
      method: 'POST',
    });
    revalidatePath('/system');
    return {
      ok: true,
      message: r.retried
        ? `${r.retried} job${r.retried === 1 ? '' : 's'} queued to run again`
        : 'Nothing to retry',
      at: Date.now(),
    };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, message: e.message, at: Date.now() };
    throw e;
  }
}
