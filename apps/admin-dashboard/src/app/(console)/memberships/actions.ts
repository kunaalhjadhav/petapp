'use server';

import { revalidatePath } from 'next/cache';
import { act, api, type ActionState } from '@/lib/api';
import { rupeesToPaise } from '@/lib/money';

const text = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const int = (fd: FormData, k: string) => {
  const v = text(fd, k);
  return v === '' ? undefined : Number(v);
};
const on = (fd: FormData, k: string) => fd.get(k) === 'on' || fd.get(k) === 'true';

function planBody(fd: FormData) {
  const price = rupeesToPaise(text(fd, 'price').replace(/[₹,\s]/g, '') || '0');
  return {
    name: text(fd, 'name'),
    description: text(fd, 'description'),
    pricePaise: price ?? -1,
    periodDays: int(fd, 'periodDays'),
    rank: int(fd, 'rank'),
    exclusiveContests: on(fd, 'exclusiveContests'),
    premiumChallenges: on(fd, 'premiumChallenges'),
    memberDiscounts: on(fd, 'memberDiscounts'),
    priorityDays: int(fd, 'priorityDays') ?? 0,
    badge: on(fd, 'badge'),
    isActive: on(fd, 'isActive'),
  };
}

export async function createPlan(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await act(
    () =>
      api('/admin/memberships/plans', {
        method: 'POST',
        body: { key: text(fd, 'key').toUpperCase(), ...planBody(fd) },
      }),
    'Plan added.',
  );
  revalidatePath('/memberships');
  return r;
}

export async function savePlan(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await act(
    () => api(`/admin/memberships/plans/${id}`, { method: 'PATCH', body: planBody(fd) }),
    'Saved. New prices apply to new purchases only.',
  );
  revalidatePath('/memberships');
  return r;
}

export async function grantMembership(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await act(
    () =>
      api('/admin/memberships/grant', {
        method: 'POST',
        body: {
          userId: text(fd, 'userId'),
          planId: text(fd, 'planId'),
          days: int(fd, 'days'),
          reason: text(fd, 'reason'),
        },
      }),
    'Membership given. They’ve been told.',
  );
  revalidatePath('/memberships/members');
  revalidatePath('/memberships');
  return r;
}

export async function revokeMembership(
  id: string,
  _: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const r = await act(
    () =>
      api(`/admin/memberships/${id}/revoke`, {
        method: 'POST',
        body: { reason: text(fd, 'reason') },
      }),
    'Membership ended. They’ve been told.',
  );
  revalidatePath('/memberships/members');
  revalidatePath('/memberships');
  return r;
}
