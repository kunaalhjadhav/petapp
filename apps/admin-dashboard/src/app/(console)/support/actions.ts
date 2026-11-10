'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, act, api, type ActionState } from '@/lib/api';

const text = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const optional = (fd: FormData, k: string) => text(fd, k) || undefined;

/** A reply to the person, or a note for staff only. Optionally sets the status in the same step. */
export async function replyToTicket(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const internal = fd.get('internal') === 'on';
  const r = await act(
    () =>
      api(`/admin/support/tickets/${id}/messages`, {
        method: 'POST',
        body: { body: text(fd, 'body'), internal, status: internal ? undefined : optional(fd, 'status') },
      }),
    internal ? 'Note added. Only staff can see it.' : 'Reply sent. They’ll get a notification.',
  );
  revalidatePath(`/support/${id}`);
  return r;
}

/** One field at a time: status, priority, topic or who handles it. */
export async function updateTicket(id: string, field: 'status' | 'priority' | 'categoryId' | 'assigneeId', _: ActionState, fd: FormData): Promise<ActionState> {
  const raw = text(fd, field);
  const value = field === 'assigneeId' && raw === '' ? null : raw;
  const r = await act(
    () => api(`/admin/support/tickets/${id}`, { method: 'PATCH', body: { [field]: value } }),
    field === 'assigneeId' ? (value ? 'Assigned.' : 'Unassigned.') : 'Saved.',
  );
  revalidatePath(`/support/${id}`);
  revalidatePath('/support');
  return r;
}

export async function assignToMe(id: string, me: string): Promise<ActionState> {
  const r = await act(() => api(`/admin/support/tickets/${id}`, { method: 'PATCH', body: { assigneeId: me } }), 'Assigned to you.');
  revalidatePath(`/support/${id}`);
  return r;
}

/** Admin ↔ person: starts a ticket the person answers in their app, then opens it. */
export async function startTicket(userId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const t = await api<{ id: string }>('/admin/support/tickets', {
      method: 'POST',
      body: { userId, categoryId: text(fd, 'categoryId'), subject: text(fd, 'subject'), body: text(fd, 'body') },
    });
    id = t.id;
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, message: e.message, at: Date.now() };
    throw e;
  }
  redirect(`/support/${id}`);
}

// ───────────── help center ─────────────

function faqBody(fd: FormData) {
  return {
    question: text(fd, 'question'),
    answer: String(fd.get('answer') ?? ''),
    categoryId: text(fd, 'categoryId') || null,
    audience: text(fd, 'audience') || 'ALL',
    sortOrder: Number(text(fd, 'sortOrder') || 0),
    published: fd.get('published') === 'on',
  };
}

export async function createFaq(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    id = (await api<{ id: string }>('/admin/support/faqs', { method: 'POST', body: faqBody(fd) })).id;
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, message: e.message, at: Date.now() };
    throw e;
  }
  revalidatePath('/support/faqs');
  redirect(`/support/faqs/${id}`);
}

export async function saveFaq(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await act(() => api(`/admin/support/faqs/${id}`, { method: 'PATCH', body: faqBody(fd) }), 'Saved.');
  revalidatePath(`/support/faqs/${id}`);
  revalidatePath('/support/faqs');
  return r;
}

export async function setFaqPublished(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const published = fd.get('enabled') === 'true';
  const r = await act(() => api(`/admin/support/faqs/${id}`, { method: 'PATCH', body: { published } }), published ? 'Published.' : 'Unpublished.');
  revalidatePath('/support/faqs');
  return r;
}

export async function deleteFaq(id: string): Promise<ActionState> {
  try {
    await api(`/admin/support/faqs/${id}/delete`, { method: 'POST' });
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, message: e.message, at: Date.now() };
    throw e;
  }
  revalidatePath('/support/faqs');
  redirect('/support/faqs');
}

// ───────────── topics ─────────────

export async function createTopic(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await act(
    () =>
      api('/admin/support/categories', {
        method: 'POST',
        body: { key: text(fd, 'key'), name: text(fd, 'name'), audience: text(fd, 'audience') || 'ALL', sortOrder: Number(text(fd, 'sortOrder') || 0) },
      }),
    'Topic added.',
  );
  revalidatePath('/support/topics');
  return r;
}

export async function saveTopic(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await act(
    () =>
      api(`/admin/support/categories/${id}`, {
        method: 'PATCH',
        body: { name: text(fd, 'name'), audience: text(fd, 'audience'), sortOrder: Number(text(fd, 'sortOrder') || 0) },
      }),
    'Saved.',
  );
  revalidatePath('/support/topics');
  return r;
}

export async function setTopicActive(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const active = fd.get('enabled') === 'true';
  const r = await act(() => api(`/admin/support/categories/${id}`, { method: 'PATCH', body: { active } }), active ? 'Turned on.' : 'Turned off.');
  revalidatePath('/support/topics');
  return r;
}
