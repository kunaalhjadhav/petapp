import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PERMISSIONS } from '@petapp/types';
import { ApiError, api } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatDateTime, formatPhone, timeAgo } from '@/lib/format';
import { formatPaise } from '@/lib/money';
import { SUPPORT_APPS, TICKET_PRIORITY, TICKET_STATUS } from '@/lib/labels';
import type { ChatMessage, SupportCategory, TicketDetail } from '@/lib/types';
import { Facts, NoAccess, PageHeader, Panel, Select, Tag, inputClass } from '@/components/ui';
import { InlineForm, SubmitButton } from '@/components/forms';
import { replyToTicket, updateTicket } from '../actions';
import { AutoRefresh } from './refresh';

export const metadata: Metadata = { title: 'Support ticket' };
export const dynamic = 'force-dynamic';

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  if (!can(me, PERMISSIONS.SUPPORT_READ)) return <NoAccess what="support tickets" />;
  let t: TicketDetail;
  try {
    t = await api<TicketDetail>(`/admin/support/tickets/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
  const manage = can(me, PERMISSIONS.SUPPORT_MANAGE);
  const [thread, categories, assignees] = await Promise.all([
    api<{ items: ChatMessage[] }>(`/admin/support/tickets/${id}/messages`, { query: { limit: 100 } }),
    api<SupportCategory[]>('/admin/support/categories'),
    manage ? api<Array<{ id: string; name: string | null; email: string | null }>>('/admin/support/assignees') : [],
  ]);
  const messages = [...thread.items].reverse();
  const closed = t.status === 'CLOSED';
  const status = TICKET_STATUS[t.status];
  const priority = TICKET_PRIORITY[t.priority];

  return (
    <>
      {!closed && <AutoRefresh />}
      <PageHeader
        back={{ href: '/support', label: 'Support tickets' }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {t.subject}
            <Tag tone={status.tone}>{status.label}</Tag>
            {t.priority !== 'NORMAL' && <Tag tone={priority.tone}>{priority.label} priority</Tag>}
          </span>
        }
        description={`${t.code} · ${t.category.name} · opened ${formatDateTime(t.createdAt)}${t.firstResponseAt ? ` · first reply ${timeAgo(t.firstResponseAt)}` : ' · no reply yet'}`}
      />

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="Conversation">
            <ol className="flex flex-col gap-3 px-4 py-4" aria-label="Messages">
              {messages.map((m) => (
                <Bubble key={m.id} m={m} personName={t.user.name} />
              ))}
            </ol>
            {t.seenByPersonAt && (
              <p className="border-t border-line-soft px-4 py-2 text-right text-xs text-muted">
                {t.user.name ?? 'They'} last read the conversation {timeAgo(t.seenByPersonAt)}
              </p>
            )}
          </Panel>

          {t.canReply ? (
            <Panel title="Reply">
              <InlineForm action={replyToTicket.bind(null, t.id)} resetOnSuccess className="flex flex-col gap-3 px-4 py-4">
                <label htmlFor="body" className="sr-only">
                  Message
                </label>
                <textarea
                  id="body"
                  name="body"
                  required
                  maxLength={2000}
                  rows={5}
                  placeholder={`Write to ${t.user.name ?? 'them'}…`}
                  className={`${inputClass} h-auto py-2`}
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="internal" className="h-4 w-4 accent-[var(--color-warn)]" />
                    Note for staff only (they won’t see it)
                  </label>
                  <span className="flex items-center gap-2">
                    <label htmlFor="then" className="text-sm text-muted">
                      Then
                    </label>
                    <Select id="then" name="status" defaultValue="" className="w-auto">
                      <option value="">Keep it {status.label.toLowerCase()}</option>
                      <option value="WAITING">Wait for their reply</option>
                      <option value="RESOLVED">Mark resolved</option>
                    </Select>
                    <SubmitButton>Send</SubmitButton>
                  </span>
                </div>
              </InlineForm>
            </Panel>
          ) : (
            <p className="text-sm text-muted">
              {closed ? 'This ticket is closed. If they still need help, they can open a new one.' : 'You can read this ticket but not reply.'}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <Panel title="Person">
            <Facts
              items={[
                ['Name', <Link key="n" href={`/users/${t.user.id}`} className="text-teal hover:underline">{t.user.name ?? 'No name'}</Link>],
                ['Contact', [t.user.phone ? formatPhone(t.user.phone) : null, t.user.email].filter(Boolean).join(' · ') || '—'],
                ['From', SUPPORT_APPS[t.app] ?? t.app],
                ...(t.user.partner ? [['Service partner', <Link key="p" href={`/partners/${t.user.partner.id}`} className="text-teal hover:underline">{t.user.partner.businessName}</Link>] as [string, React.ReactNode]] : []),
                ...(t.user.vendor ? [['Seller', <Link key="v" href={`/shop/vendors/${t.user.vendor.id}`} className="text-teal hover:underline">{t.user.vendor.businessName}</Link>] as [string, React.ReactNode]] : []),
                ...(t.user.status !== 'ACTIVE' ? [['Account', <Tag key="s" tone="warn">{t.user.status.toLowerCase().replace('_', ' ')}</Tag>] as [string, React.ReactNode]] : []),
              ]}
            />
          </Panel>

          {t.ref && (
            <Panel title={t.ref.type === 'BOOKING' ? 'About a booking' : 'About an order'}>
              <Facts
                items={[
                  ['Code', <code key="c">{t.ref.code}</code>],
                  ['Status', t.ref.status.toLowerCase().replace(/_/g, ' ')],
                  ['Amount', formatPaise(t.ref.amountPaise)],
                  [t.ref.type === 'BOOKING' ? 'Partner' : 'Seller', t.ref.business],
                  ...(t.ref.startsAt ? [['When', formatDateTime(t.ref.startsAt)] as [string, React.ReactNode]] : []),
                ]}
              />
            </Panel>
          )}

          {manage && !closed && (
            <Panel title="Handling">
              <div className="flex flex-col gap-4 px-4 py-4">
                <FieldForm label="Handled by" action={updateTicket.bind(null, t.id, 'assigneeId')}>
                  <Select name="assigneeId" defaultValue={t.assignee?.id ?? ''}>
                    <option value="">Nobody yet</option>
                    {assignees.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.id === me.id ? `Me (${a.name ?? a.email})` : (a.name ?? a.email)}
                      </option>
                    ))}
                  </Select>
                </FieldForm>
                <FieldForm label="Status" action={updateTicket.bind(null, t.id, 'status')}>
                  <Select name="status" defaultValue={t.status}>
                    {Object.entries(TICKET_STATUS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </Select>
                </FieldForm>
                <FieldForm label="Priority" action={updateTicket.bind(null, t.id, 'priority')}>
                  <Select name="priority" defaultValue={t.priority}>
                    {Object.entries(TICKET_PRIORITY).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </Select>
                </FieldForm>
                <FieldForm label="Topic" action={updateTicket.bind(null, t.id, 'categoryId')}>
                  <Select name="categoryId" defaultValue={t.category.id}>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </FieldForm>
              </div>
            </Panel>
          )}

          {t.otherTickets.length > 0 && (
            <Panel title="Their other tickets">
              <ul className="flex flex-col divide-y divide-line-soft">
                {t.otherTickets.map((o) => (
                  <li key={o.id} className="px-4 py-2.5 text-sm">
                    <Link href={`/support/${o.id}`} className="text-teal hover:underline">
                      {o.subject}
                    </Link>
                    <span className="block text-xs text-muted">
                      {o.code} · {TICKET_STATUS[o.status].label} · {timeAgo(o.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}

function FieldForm({ label, action, children }: { label: string; action: Parameters<typeof InlineForm>[0]['action']; children: React.ReactNode }) {
  return (
    <InlineForm action={action} className="flex flex-col gap-1.5">
      <span className="text-xs text-muted">{label}</span>
      <span className="flex gap-2">
        {children}
        <SubmitButton size="sm" variant="secondary">
          Save
        </SubmitButton>
      </span>
    </InlineForm>
  );
}

function Bubble({ m, personName }: { m: ChatMessage; personName: string | null }) {
  if (m.side === 'SYSTEM') {
    return (
      <li className="text-center text-xs text-muted">
        {m.body} · {timeAgo(m.createdAt)}
      </li>
    );
  }
  const staff = m.side === 'STAFF';
  const tone = m.internal ? 'border border-dashed border-warn/50 bg-warn-wash' : staff ? 'bg-teal-wash' : 'border border-line-soft bg-paper';
  const who = m.internal ? `Note · ${m.senderName ?? 'staff'}` : staff ? (m.senderName ?? 'Support') : (personName ?? 'Them');
  const img = m.media?.kind === 'IMAGE' ? (m.media.images?.find((i) => i.width <= 640)?.url ?? m.media.images?.[0]?.url) : null;
  return (
    <li className={`flex flex-col ${staff ? 'items-end' : 'items-start'}`}>
      <div className={`max-w-[80%] rounded-lg px-3 py-2 ${tone}`}>
        <p className="mb-0.5 text-xs font-medium text-muted">{who}</p>
        {m.removed ? (
          <p className="text-sm italic text-muted">Message removed by moderation</p>
        ) : (
          <>
            {m.body && <p className="whitespace-pre-wrap text-sm">{m.body}</p>}
            {img && (
              <a href={img} target="_blank" rel="noreferrer" className="mt-1 block">
                <img src={img} alt="Photo they attached" className="max-h-60 rounded-md" />
              </a>
            )}
            {m.media?.kind === 'DOCUMENT' && m.media.url && (
              <a href={m.media.url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm text-teal underline">
                PDF attachment{m.media.sizeBytes ? ` (${Math.max(1, Math.round(m.media.sizeBytes / 1024))} KB)` : ''}
              </a>
            )}
            {m.ref && (
              <p className="mt-1 rounded border border-line-soft bg-panel px-2 py-1 text-xs">
                {m.ref.type === 'BOOKING' ? 'Booking' : m.ref.type === 'ORDER' ? 'Order' : 'Product'} {m.ref.code ?? m.ref.title ?? ''}
                {m.ref.status ? ` · ${m.ref.status.toLowerCase().replace(/_/g, ' ')}` : ''}
              </p>
            )}
          </>
        )}
      </div>
      <time dateTime={m.createdAt} title={formatDateTime(m.createdAt)} className="mt-0.5 text-[11px] text-faint">
        {timeAgo(m.createdAt)}
      </time>
    </li>
  );
}
