'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, act, api, type ActionState } from '@/lib/api';

const fail = (e: unknown): ActionState => {
  if (e instanceof ApiError)
    return {
      ok: false,
      message: [e.message, ...e.errors.map((x) => x.message)].join(' '),
      at: Date.now(),
    };
  throw e;
};

/** Approve needs a decision on every document; reject and suspend need a reason the partner will see. */
export async function reviewPartner(
  id: string,
  decision: 'APPROVE' | 'REJECT' | 'SUSPEND' | 'REINSTATE',
  _: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const reason = String(fd.get('reason') ?? '').trim() || undefined;
  if ((decision === 'REJECT' || decision === 'SUSPEND') && !reason)
    return { ok: false, message: 'Give a reason. The partner will see it.', at: Date.now() };
  const documents: Array<{ id: string; status: string; note?: string }> = [];
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith('doc:')) continue;
    const docId = k.slice(4);
    const note = String(fd.get(`note:${docId}`) ?? '').trim();
    documents.push({ id: docId, status: String(v), ...(note ? { note } : {}) });
  }
  try {
    await api(`/admin/partners/${id}/review`, {
      method: 'POST',
      body: { decision, reason, ...(documents.length ? { documents } : {}) },
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/partners/${id}`);
  revalidatePath('/partners');
  return { ok: true, message: 'Saved', at: Date.now() };
}

export async function setCommission(
  id: string,
  _: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const raw = String(fd.get('pct') ?? '').trim();
  let commissionBps: number | null = null;
  if (raw) {
    if (!/^\d{1,2}(\.\d{1,2})?$/.test(raw) || Number(raw) > 50)
      return {
        ok: false,
        message:
          'Enter a percentage between 0 and 50, or leave it empty to use the category’s rate.',
      };
    commissionBps = Math.round(Number(raw) * 100);
  }
  const r = await act(
    () => api(`/admin/partners/${id}/commission`, { method: 'PATCH', body: { commissionBps } }),
    'Commission updated',
  );
  revalidatePath(`/partners/${id}`);
  return r;
}

export async function cancelBooking(
  id: string,
  _: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const reason = String(fd.get('reason') ?? '').trim();
  if (reason.length < 3)
    return { ok: false, message: 'Give a reason. The customer and partner will see it.' };
  const r = await act(
    () => api(`/admin/bookings/${id}/cancel`, { method: 'POST', body: { reason } }),
    'Booking cancelled; full refund queued',
  );
  revalidatePath('/bookings');
  return r;
}

export async function saveServiceCategory(
  id: string | null,
  _: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const name = String(fd.get('name') ?? '').trim();
  const pct = String(fd.get('pct') ?? '').trim();
  const isActive = fd.get('isActive') === null ? undefined : fd.get('isActive') === 'true';
  // The API's update takes the whole category, so key and name are always sent.
  const key =
    String(fd.get('key') ?? '').trim() ||
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  const body: Record<string, unknown> = { key, name, isActive };
  if (pct) {
    if (!/^\d{1,2}(\.\d{1,2})?$/.test(pct) || Number(pct) > 50)
      return { ok: false, message: 'Commission must be between 0 and 50%.' };
    body.commissionBps = Math.round(Number(pct) * 100);
  }
  const r = await act(
    () =>
      api(id ? `/admin/service-categories/${id}` : '/admin/service-categories', {
        method: id ? 'PATCH' : 'POST',
        body,
      }),
    id ? 'Saved' : `${name} added`,
  );
  revalidatePath('/service-categories');
  return r;
}
