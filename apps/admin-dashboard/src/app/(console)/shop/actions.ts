'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, act, api, type ActionState } from '@/lib/api';
import { rupeesToPaise } from '@/lib/money';

const fail = (e: unknown): ActionState => {
  if (e instanceof ApiError)
    return {
      ok: false,
      message: [e.message, ...e.errors.map((x) => x.message)].join(' '),
      at: Date.now(),
    };
  throw e;
};

/** Approval needs a decision on each document; reject and suspend need a reason the vendor will see. */
export async function reviewVendor(
  id: string,
  decision: 'APPROVE' | 'REJECT' | 'SUSPEND' | 'REINSTATE',
  _: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const reason = String(fd.get('reason') ?? '').trim() || undefined;
  if ((decision === 'REJECT' || decision === 'SUSPEND') && !reason)
    return { ok: false, message: 'Give a reason. The vendor will see it.', at: Date.now() };
  const documents: Array<{ id: string; status: string; note?: string }> = [];
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith('doc:')) continue;
    const docId = k.slice(4);
    const note = String(fd.get(`note:${docId}`) ?? '').trim();
    documents.push({ id: docId, status: String(v), ...(note ? { note } : {}) });
  }
  try {
    await api(`/admin/vendors/${id}/review`, {
      method: 'POST',
      body: { decision, reason, ...(documents.length ? { documents } : {}) },
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/shop/vendors/${id}`);
  revalidatePath('/shop/vendors');
  return { ok: true, message: 'Saved', at: Date.now() };
}

export async function setVendorCommission(
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
          'Enter a percentage between 0 and 50, or leave it empty to use each category’s rate.',
      };
    commissionBps = Math.round(Number(raw) * 100);
  }
  const r = await act(
    () => api(`/admin/vendors/${id}/commission`, { method: 'PATCH', body: { commissionBps } }),
    'Commission updated',
  );
  revalidatePath(`/shop/vendors/${id}`);
  return r;
}

export async function blockProduct(
  id: string,
  blocked: boolean,
  _: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const reason = String(fd.get('reason') ?? '').trim() || undefined;
  if (blocked && !reason)
    return { ok: false, message: 'Give a reason. The vendor will see it.', at: Date.now() };
  const r = await act(
    () => api(`/admin/products/${id}/block`, { method: 'POST', body: { blocked, reason } }),
    blocked ? 'Product blocked' : 'Product unblocked',
  );
  revalidatePath('/shop/products');
  return r;
}

export async function saveCategory(
  id: string | null,
  _: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const name = String(fd.get('name') ?? '').trim();
  const pct = String(fd.get('pct') ?? '').trim();
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(pct) || Number(pct) > 50)
    return { ok: false, message: 'Commission: a percentage between 0 and 50.' };
  const key =
    String(fd.get('key') ?? '').trim() ||
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  const parentId = String(fd.get('parentId') ?? '') || undefined;
  const isActive = fd.get('isActive') === null ? undefined : fd.get('isActive') === 'true';
  const r = await act(
    () =>
      api(id ? `/admin/product-categories/${id}` : '/admin/product-categories', {
        method: id ? 'PATCH' : 'POST',
        body: { key, name, parentId, commissionBps: Math.round(Number(pct) * 100), isActive },
      }),
    id ? 'Saved' : `${name} added`,
  );
  revalidatePath('/shop/categories');
  return r;
}

/** Datetime-local inputs carry no zone: the form sends the browser's offset so times mean what the admin meant. */
export async function createCoupon(_: ActionState, fd: FormData): Promise<ActionState> {
  const s = (k: string) => String(fd.get(k) ?? '').trim();
  const kind = s('kind');
  const offset = Number(s('tzOffset') || '0');
  const iso = (v: string) =>
    new Date(new Date(`${v}:00Z`).getTime() + offset * 60_000).toISOString();
  let value: number | null;
  if (kind === 'PERCENT') {
    value =
      /^\d{1,2}(\.\d{1,2})?$/.test(s('value')) || s('value') === '100'
        ? Math.round(Number(s('value')) * 100)
        : null;
    if (!value) return { ok: false, message: 'Enter a percentage between 0.01 and 100.' };
  } else {
    value = rupeesToPaise(s('value'));
    if (!value) return { ok: false, message: 'Enter the discount in rupees.' };
  }
  const cap = s('max') ? rupeesToPaise(s('max')) : undefined;
  const min = s('min') ? rupeesToPaise(s('min')) : 0;
  if (cap === null || min === null)
    return { ok: false, message: 'Enter amounts in rupees, e.g. 100 or 99.50.' };
  const r = await act(
    () =>
      api('/admin/coupons', {
        method: 'POST',
        body: {
          code: s('code'),
          description: s('description') || undefined,
          kind,
          value,
          maxDiscountPaise: cap,
          minOrderPaise: min,
          startsAt: iso(s('startsAt')),
          endsAt: iso(s('endsAt')),
          usageLimit: s('usageLimit') ? Number(s('usageLimit')) : undefined,
          perUserLimit: Number(s('perUserLimit') || 1),
          membersOnly: fd.get('membersOnly') === 'on',
        },
      }),
    `${s('code').toUpperCase()} created`,
  );
  revalidatePath('/shop/coupons');
  return r;
}

export async function toggleCoupon(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await act(
    () =>
      api(`/admin/coupons/${id}`, {
        method: 'PATCH',
        body: { isActive: fd.get('isActive') === 'true' },
      }),
    'Saved',
  );
  revalidatePath('/shop/coupons');
  return r;
}
