'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, act, api, type ActionState } from '@/lib/api';

const bad = (message: string): ActionState => ({ ok: false, message, at: Date.now() });
const done = (id?: string) => {
  revalidatePath('/legal');
  if (id) revalidatePath(`/legal/${id}`);
};

/** Starts a new version of a document (a copy of the latest) and opens it. */
export async function newVersion(slug: string): Promise<ActionState> {
  let id: string;
  try {
    id = (await api<{ id: string }>('/admin/legal', { method: 'POST', body: { slug } })).id;
  } catch (e) {
    if (e instanceof ApiError) return bad(e.message);
    throw e;
  }
  done();
  redirect(`/legal/${id}`);
}

export async function saveDraft(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const title = String(fd.get('title') ?? '').trim();
  const body = String(fd.get('body') ?? '').replace(/\r\n/g, '\n');
  const changeSummary = String(fd.get('changeSummary') ?? '').trim();
  const requiresAcceptance = fd.get('requiresAcceptance') === 'on';
  if (title.length < 2) return bad('Give the document a title.');
  if (body.trim().length < 20) return bad('The document is too short.');
  if (body.length > 100_000) return bad('The document is too long (100,000 characters at most).');
  const r = await act(
    () =>
      api(`/admin/legal/${id}`, {
        method: 'PATCH',
        body: { title, body, changeSummary, requiresAcceptance },
      }),
    'Draft saved',
  );
  done(id);
  return r;
}

export async function publishDraft(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const day = String(fd.get('effectiveAt') ?? '').trim();
  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return bad('Choose a valid date.');
  try {
    // A date means midnight India time on that day.
    await api(`/admin/legal/${id}/publish`, {
      method: 'POST',
      body: day ? { effectiveAt: `${day}T00:00:00+05:30` } : {},
    });
  } catch (e) {
    if (e instanceof ApiError) {
      const more = e.errors.map((x) => x.message);
      return bad(
        more.length
          ? `${e.message} ${more.slice(0, 6).join('; ')}${more.length > 6 ? '…' : ''}`
          : e.message,
      );
    }
    throw e;
  }
  done(id);
  return { ok: true, message: 'Published. Recorded in the audit log.', at: Date.now() };
}

export async function deleteDraft(id: string): Promise<ActionState> {
  const r = await act(() => api(`/admin/legal/${id}`, { method: 'DELETE' }), 'Draft deleted');
  if (!r?.ok) return r;
  done();
  redirect('/legal');
}
