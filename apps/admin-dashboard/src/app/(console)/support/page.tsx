import Link from 'next/link';
import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { api, apiPage } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatNumber, timeAgo } from '@/lib/format';
import { SUPPORT_APPS, TICKET_PRIORITY, TICKET_STATUS } from '@/lib/labels';
import type { SupportCategory, SupportSummary, TicketRow } from '@/lib/types';
import { Empty, Input, NoAccess, PageHeader, Panel, Select, Tag, buttonClass } from '@/components/ui';
import { Pagination, Table, Td } from '@/components/table';

export const metadata: Metadata = { title: 'Support tickets' };
export const dynamic = 'force-dynamic';

const VIEWS = [
  { key: 'active', label: 'Active', query: { status: 'active' } },
  { key: 'mine', label: 'Mine', query: { status: 'active', assignee: 'me' } },
  { key: 'unassigned', label: 'Unassigned', query: { status: 'active', assignee: 'none' } },
  { key: 'waiting', label: 'Waiting for them', query: { status: 'WAITING' } },
  { key: 'resolved', label: 'Resolved', query: { status: 'RESOLVED' } },
  { key: 'closed', label: 'Closed', query: { status: 'CLOSED' } },
] as const;

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!can(me, PERMISSIONS.SUPPORT_READ)) return <NoAccess what="support tickets" />;
  const view = VIEWS.find((v) => v.key === sp.view) ?? VIEWS[0];
  const [summary, categories, { items, meta }] = await Promise.all([
    api<SupportSummary>('/admin/support/summary'),
    api<SupportCategory[]>('/admin/support/categories'),
    apiPage<TicketRow>('/admin/support/tickets', {
      ...view.query,
      q: sp.q,
      priority: sp.priority,
      categoryId: sp.categoryId,
      page: sp.page,
      limit: 25,
    }),
  ]);
  return (
    <>
      <PageHeader
        title="Support tickets"
        description="Questions and problems people sent from the apps, and conversations staff started. Replies reach them in the app with a notification. Notes stay between staff."
        actions={
          <>
            <Link href="/support/faqs" className={buttonClass('secondary')}>
              Help center
            </Link>
            <Link href="/support/topics" className={buttonClass('secondary')}>
              Topics
            </Link>
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        {(
          [
            ['Need a reply', summary.needsReply, 'active', summary.needsReply > 0],
            ['Unassigned', summary.unassigned, 'unassigned', false],
            ['Assigned to me', summary.mine, 'mine', false],
            ['Urgent', summary.urgent, 'active', summary.urgent > 0],
          ] as const
        ).map(([label, n, v, hot]) => (
          <Link
            key={label}
            href={`/support?view=${v}${label === 'Urgent' ? '&priority=URGENT' : ''}`}
            className="rounded-lg border border-line bg-panel px-4 py-3 hover:border-muted"
          >
            <p className="text-xs text-muted">{label}</p>
            <p className={`mt-1 text-xl tabular-nums ${hot ? 'text-warn' : ''}`}>{formatNumber(n)}</p>
          </Link>
        ))}
      </div>

      <Panel>
        <nav aria-label="Ticket views" className="flex flex-wrap items-center gap-1 border-b border-line-soft px-4 py-2">
          {VIEWS.map((v) => (
            <Link
              key={v.key}
              href={`/support?view=${v.key}`}
              aria-current={view.key === v.key ? 'page' : undefined}
              className={`rounded px-3 py-1.5 text-sm ${view.key === v.key ? 'bg-teal-wash font-medium text-teal' : 'text-muted hover:text-ink'}`}
            >
              {v.label}
            </Link>
          ))}
        </nav>
        <form className="flex flex-wrap items-end gap-3 border-b border-line-soft px-4 py-3" role="search">
          <input type="hidden" name="view" value={view.key} />
          <div className="min-w-56 flex-1">
            <label htmlFor="q" className="sr-only">
              Search tickets
            </label>
            <Input id="q" name="q" defaultValue={sp.q ?? ''} placeholder="Ticket code, subject, name, phone or email" />
          </div>
          <div>
            <label htmlFor="priority" className="sr-only">
              Priority
            </label>
            <Select id="priority" name="priority" defaultValue={sp.priority ?? ''}>
              <option value="">Any priority</option>
              {Object.entries(TICKET_PRIORITY).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="categoryId" className="sr-only">
              Topic
            </label>
            <Select id="categoryId" name="categoryId" defaultValue={sp.categoryId ?? ''}>
              <option value="">Any topic</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <button className={buttonClass('secondary')}>Filter</button>
        </form>

        {items.length === 0 ? (
          <Empty title={sp.q ? 'No tickets match' : view.key === 'active' ? 'No open tickets' : 'Nothing here'}>
            {view.key === 'active' && !sp.q ? 'New tickets from the apps appear here.' : undefined}
          </Empty>
        ) : (
          <>
            <Table head={['Ticket', 'From', 'Topic', 'Priority', 'Status', 'Handled by', 'Updated']}>
              {items.map((t) => (
                <tr key={t.id} className="align-top hover:bg-paper">
                  <Td>
                    <Link href={`/support/${t.id}`} className="block max-w-[34ch]">
                      <span className="flex items-center gap-2">
                        <code className="text-xs text-muted">{t.code}</code>
                        {t.unread > 0 && (
                          <span className="rounded-full bg-teal px-1.5 text-[11px] font-semibold text-white" aria-label={`${t.unread} unread`}>
                            {t.unread}
                          </span>
                        )}
                      </span>
                      <span className="block font-medium text-teal hover:underline">{t.subject}</span>
                      {t.lastMessageText && <span className="block truncate text-xs text-muted">{t.lastMessageText}</span>}
                    </Link>
                  </Td>
                  <Td className="text-sm">
                    {t.user.name ?? 'No name'}
                    <span className="block text-xs text-muted">{SUPPORT_APPS[t.app] ?? t.app}</span>
                  </Td>
                  <Td className="text-sm text-muted">{t.category.name}</Td>
                  <Td>
                    <Tag tone={TICKET_PRIORITY[t.priority].tone}>{TICKET_PRIORITY[t.priority].label}</Tag>
                  </Td>
                  <Td>
                    <Tag tone={TICKET_STATUS[t.status].tone}>{TICKET_STATUS[t.status].label}</Tag>
                  </Td>
                  <Td className="text-sm">{t.assignee?.name ?? <span className="text-muted">Nobody yet</span>}</Td>
                  <Td className="whitespace-nowrap text-sm text-muted">{timeAgo(t.lastMessageAt ?? t.updatedAt)}</Td>
                </tr>
              ))}
            </Table>
            <Pagination meta={meta} basePath="/support" params={{ view: view.key, q: sp.q, priority: sp.priority, categoryId: sp.categoryId }} />
          </>
        )}
      </Panel>
    </>
  );
}
