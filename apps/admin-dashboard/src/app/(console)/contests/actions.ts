'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, act, api, type ActionState } from '@/lib/api';

const refresh = (id?: string) => {
  revalidatePath('/contests');
  if (id) revalidatePath(`/contests/${id}`);
};

/** Builder submit. Returns the contest id on success so the form can navigate. */
export async function saveContest(
  id: string | null,
  payload: Record<string, unknown>,
): Promise<ActionState & { id?: string }> {
  try {
    const c = await api<{ id: string }>(id ? `/admin/contests/${id}` : '/admin/contests', {
      method: id ? 'PATCH' : 'POST',
      body: payload,
    });
    refresh(c.id);
    return { ok: true, message: id ? 'Saved' : 'Draft created', id: c.id, at: Date.now() };
  } catch (e) {
    if (e instanceof ApiError)
      return {
        ok: false,
        message: e.errors.length ? e.errors.map((x) => x.message).join(' ') : e.message,
        at: Date.now(),
      };
    throw e;
  }
}

export async function transition(
  id: string,
  to: string,
  _: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const reason = String(fd.get('reason') ?? '').trim() || undefined;
  try {
    await api(`/admin/contests/${id}/transition`, { method: 'POST', body: { to, reason } });
    refresh(id);
    return { ok: true, message: 'Status updated', at: Date.now() };
  } catch (e) {
    // Readiness problems come back as a list; show them all.
    if (e instanceof ApiError)
      return {
        ok: false,
        message: [e.message, ...e.errors.map((x) => x.message)].join(' '),
        at: Date.now(),
      };
    throw e;
  }
}

export async function legalApprove(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const note = String(fd.get('note') ?? '').trim();
  if (note.length < 10)
    return {
      ok: false,
      message: 'Record who reviewed it and the reference (at least 10 characters).',
    };
  const r = await act(
    () => api(`/admin/contests/${id}/legal-approval`, { method: 'POST', body: { note } }),
    'Legal review recorded',
  );
  refresh(id);
  return r;
}

export async function freeze(id: string, _: ActionState): Promise<ActionState> {
  const r = await act(
    () => api(`/admin/contests/${id}/freeze`, { method: 'POST' }),
    'Leaderboard frozen',
  );
  refresh(id);
  return r;
}

export async function declareWinners(id: string, _: ActionState): Promise<ActionState> {
  const r = await act(
    () => api(`/admin/contests/${id}/winners`, { method: 'POST' }),
    'Winners declared',
  );
  refresh(id);
  return r;
}

export async function reviewVote(
  contestId: string,
  voteId: string,
  valid: boolean,
  _: ActionState,
): Promise<ActionState> {
  const r = await act(
    () => api(`/admin/contest-votes/${voteId}/review`, { method: 'POST', body: { valid } }),
    valid ? 'Vote counted' : 'Vote excluded',
  );
  refresh(contestId);
  return r;
}

export async function setEntryStatus(
  contestId: string,
  entryId: string,
  _: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const status = String(fd.get('status'));
  const reason = String(fd.get('reason') ?? '').trim();
  if (reason.length < 3)
    return { ok: false, message: 'Give a reason. It is saved in the history.' };
  const r = await act(
    () =>
      api(`/admin/contest-entries/${entryId}/status`, {
        method: 'PATCH',
        body: { status, reason },
      }),
    'Entry updated',
  );
  refresh(contestId);
  return r;
}

export async function awardSpecial(
  contestId: string,
  prizeId: string,
  _: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const participantId = String(fd.get('participantId') ?? '');
  if (!participantId) return { ok: false, message: 'Choose an entry.' };
  const r = await act(
    () =>
      api(`/admin/contest-prizes/${prizeId}/award`, { method: 'POST', body: { participantId } }),
    'Award given',
  );
  refresh(contestId);
  return r;
}

export async function saveCategory(
  id: string | null,
  _: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const name = String(fd.get('name') ?? '').trim();
  const group = String(fd.get('group') ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z_]/g, '_');
  const key =
    String(fd.get('key') ?? '').trim() ||
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  const isActive = fd.get('isActive') === null ? undefined : fd.get('isActive') === 'true';
  const r = await act(
    () =>
      api(id ? `/admin/contest-categories/${id}` : '/admin/contest-categories', {
        method: id ? 'PATCH' : 'POST',
        body: { key, name, group, isActive },
      }),
    id ? 'Saved' : `${name} added`,
  );
  revalidatePath('/contests/categories');
  return r;
}
