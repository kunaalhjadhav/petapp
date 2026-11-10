import Link from 'next/link';
import type { Metadata } from 'next';
import type { PageMeta } from '@petapp/types';
import { PERMISSIONS } from '@petapp/types';
import { apiPage } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatDate, formatNumber, formatPhone } from '@/lib/format';
import type { DeletionMeta, DeletionRequest } from '@/lib/types';
import { Empty, NoAccess, PageHeader, Panel, Tag } from '@/components/ui';
import { ActionDialog } from '@/components/forms';
import { Pagination, Table, Td } from '@/components/table';
import { cancelDeletion, eraseNow } from './actions';

export const metadata: Metadata = { title: 'Privacy requests' };
export const dynamic = 'force-dynamic';

const VIEWS = [
  { key: 'scheduled', label: 'Waiting to be erased' },
  { key: 'deferred', label: 'Held back' },
  { key: 'erased', label: 'Erased' },
] as const;
type View = (typeof VIEWS)[number]['key'];

export default async function PrivacyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!can(me, PERMISSIONS.USERS_READ)) return <NoAccess what="privacy requests" />;
  const view: View = VIEWS.some((v) => v.key === sp.state) ? (sp.state as View) : 'scheduled';
  const { items, meta } = await apiPage<DeletionRequest>('/admin/privacy/deletions', {
    state: view,
    page: sp.page,
    limit: 20,
  });
  const m = meta as PageMeta & DeletionMeta;
  const manage = can(me, PERMISSIONS.PRIVACY_MANAGE);
  const ex = m.exports30d ?? {};

  return (
    <>
      <PageHeader
        title="Privacy requests"
        description={`People who asked to delete their account. Accounts are erased ${m.graceDays} days after the request by a nightly job; signing in before then cancels the deletion. Orders, payments, invoices and payouts are kept without the profile, as tax law requires. An account is held back while an order, booking, refund or payout is still in progress, or money is owed to them.`}
        actions={
          <Link href="/settings" className="text-sm text-teal hover:underline">
            Change the grace period
          </Link>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        {[
          ['Waiting', m.counts.scheduled],
          ['Held back', m.counts.deferred],
          ['Erased', m.counts.erased],
          ['Data copies (30 days)', (ex.READY ?? 0) + (ex.EXPIRED ?? 0) + (ex.PENDING ?? 0)],
        ].map(([label, n]) => (
          <div key={label} className="rounded-lg border border-line bg-panel px-4 py-3">
            <p className="text-xs text-muted">{label}</p>
            <p className="mt-1 text-xl tabular-nums">{formatNumber(Number(n))}</p>
          </div>
        ))}
      </div>
      {(ex.FAILED ?? 0) > 0 && (
        <p className="mb-6 text-sm text-danger">
          {ex.FAILED} data cop{ex.FAILED === 1 ? 'y' : 'ies'} failed in the last 30 days. Check the
          background jobs in{' '}
          <Link href="/system" className="underline">
            System health
          </Link>
          .
        </p>
      )}

      <Panel>
        <nav
          aria-label="Requests"
          className="flex flex-wrap items-center gap-1 border-b border-line-soft px-4 py-2"
        >
          {VIEWS.map((v) => (
            <Link
              key={v.key}
              href={`/privacy?state=${v.key}`}
              aria-current={view === v.key ? 'page' : undefined}
              className={`rounded px-3 py-1.5 text-sm ${view === v.key ? 'bg-teal-wash font-medium text-teal' : 'text-muted hover:text-ink'}`}
            >
              {v.label}
            </Link>
          ))}
        </nav>
        {items.length === 0 ? (
          <Empty
            title={
              view === 'erased'
                ? 'No accounts erased yet'
                : view === 'deferred'
                  ? 'Nothing held back'
                  : 'No deletion requests waiting'
            }
          />
        ) : (
          <>
            <Table
              head={
                view === 'erased'
                  ? ['Account', 'Asked on', 'Erased on']
                  : ['Person', 'Asked on', view === 'deferred' ? 'Waiting for' : 'Erased after', '']
              }
            >
              {items.map((u) => (
                <tr key={u.id} className="align-top">
                  <Td>
                    {view === 'erased' ? (
                      <span className="text-sm text-muted">
                        Erased account <code className="text-xs">{u.id.slice(0, 8)}</code>
                      </span>
                    ) : (
                      <Link href={`/users/${u.id}`} className="text-teal hover:underline">
                        {u.name ?? 'No name'}
                        <span className="block text-xs text-muted">
                          {u.phone ? formatPhone(u.phone) : (u.email ?? '')}
                        </span>
                      </Link>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-sm">{formatDate(u.requestedAt)}</Td>
                  {view === 'erased' ? (
                    <Td className="whitespace-nowrap text-sm">{formatDate(u.erasedAt)}</Td>
                  ) : (
                    <>
                      <Td className="text-sm">
                        {u.waitingFor.length ? (
                          <ul className="flex flex-col gap-0.5">
                            {u.waitingFor.map((w) => (
                              <li key={w}>
                                <Tag tone="warn">{w}</Tag>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          formatDate(u.eraseAfter)
                        )}
                      </Td>
                      <Td className="whitespace-nowrap text-right">
                        {manage && (
                          <span className="inline-flex flex-wrap justify-end gap-2">
                            <ActionDialog
                              label="Cancel deletion"
                              title={`Keep ${u.name ?? 'this'} account?`}
                              description="Only do this when the person asks you to. Their account becomes active again and they can sign in as usual."
                              action={cancelDeletion.bind(null, u.id)}
                              submitLabel="Keep the account"
                              size="sm"
                            />
                            <ActionDialog
                              label="Erase now"
                              title="Erase this account now?"
                              description="Their profile, sign-ins, pets’ private details, posts, photos, comments, follows, chats and history are erased permanently. Orders, payments, invoices and payouts are kept without the profile. This can’t be undone."
                              action={eraseNow.bind(null, u.id)}
                              submitLabel="Erase permanently"
                              variant="quiet"
                              size="sm"
                              danger
                            />
                          </span>
                        )}
                      </Td>
                    </>
                  )}
                </tr>
              ))}
            </Table>
            <Pagination meta={m} basePath="/privacy" params={{ state: view }} />
          </>
        )}
      </Panel>
    </>
  );
}
