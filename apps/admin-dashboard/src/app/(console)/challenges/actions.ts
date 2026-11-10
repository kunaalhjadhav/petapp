'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, act, api, type ActionState } from '@/lib/api';
import { rupeesToPaise } from '@/lib/money';

const errorText = (e: ApiError) => [e.message, ...e.errors.map((x) => x.message)].join(' ');

export async function createChallenge(_: ActionState, fd: FormData): Promise<ActionState> {
  const s = (k: string) => String(fd.get(k) ?? '').trim();
  const kind = s('kind');
  const fee = kind === 'PAID' ? rupeesToPaise(s('fee')) : 0;
  if (fee === null) return { ok: false, message: 'Enter the fee in rupees.' };
  // datetime-local values carry no zone; the browser sends its local time and an offset field.
  const offset = Number(s('tzOffset') || '0');
  const toIso = (v: string) =>
    new Date(new Date(`${v}:00Z`).getTime() + offset * 60_000).toISOString();
  let id: string;
  try {
    const c = await api<{ id: string }>('/admin/challenges', {
      method: 'POST',
      body: {
        title: s('title'),
        description: s('description'),
        kind,
        feePaise: fee,
        contestId: s('contestId') || undefined,
        startsAt: toIso(s('startsAt')),
        endsAt: toIso(s('endsAt')),
        requiredCheckIns: Number(s('requiredCheckIns')),
        proof: s('proof'),
        pointsPerCheckIn: Number(s('pointsPerCheckIn') || 10),
        streakBonusEvery: Number(s('streakBonusEvery') || 0),
        streakBonusPoints: Number(s('streakBonusPoints') || 0),
        badgeId: s('badgeId') || undefined,
        membersOnly: fd.get('membersOnly') === 'on',
      },
    });
    id = c.id;
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, message: errorText(e), at: Date.now() };
    throw e;
  }
  revalidatePath('/challenges');
  redirect(`/challenges/${id}`);
}

export async function setChallengeStatus(
  id: string,
  to: string,
  _: ActionState,
): Promise<ActionState> {
  try {
    await api(`/admin/challenges/${id}/status`, { method: 'POST', body: { to } });
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, message: errorText(e), at: Date.now() };
    throw e;
  }
  revalidatePath(`/challenges/${id}`);
  revalidatePath('/challenges');
  return { ok: true, message: 'Updated', at: Date.now() };
}

export async function createBadge(_: ActionState, fd: FormData): Promise<ActionState> {
  const name = String(fd.get('name') ?? '').trim();
  const key = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .replace(/^(\d)/, 'b-$1');
  const r = await act(
    () =>
      api('/admin/badges', {
        method: 'POST',
        body: { key, name, description: String(fd.get('description') ?? '').trim() },
      }),
    `${name} added`,
  );
  revalidatePath('/challenges/badges');
  return r;
}
