import Link from 'next/link';
import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { api, apiPage } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatDateTime, formatNumber, timeAgo } from '@/lib/format';
import { REASON_LABELS, REPORT_STATUS, RESOLUTION_LABELS, TARGET_LABELS, targetPlural } from '@/lib/labels';
import type { ReportRow, ReportsSummary } from '@/lib/types';
import { Empty, Input, NoAccess, PageHeader, Panel, Select, StatusTag, Tag, buttonClass } from '@/components/ui';
import { Pagination, Table, Td } from '@/components/table';

export const metadata: Metadata = { title: 'Reports' };
export const dynamic = 'force-dynamic';

const VIEWS = [
  { key: 'OPEN', label: 'Open' },
  { key: 'ACTIONED', label: 'Action taken' },
  { key: 'DISMISSED', label: 'Dismissed' },
  { key: 'all', label: 'All' },
] as const;

/** Every report people sent from the apps, one row each (spec §59). Decisions are made on the case. */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!can(me, PERMISSIONS.CONTENT_READ)) return <NoAccess what="reports" />;
  const view = VIEWS.find((v) => v.key === sp.status) ?? VIEWS[0];
  const filters = { targetType: sp.targetType, reason: sp.reason, q: sp.q, from: sp.from, to: sp.to };
  const [summary, { items, meta }] = await Promise.all([
    api<ReportsSummary>('/admin/moderation/reports/summary'),
    apiPage<ReportRow>('/admin/moderation/reports', {
      status: view.key === 'all' ? undefined : view.key,
      ...filters,
      page: sp.page,
      limit: 25,
    }),
  ]);
  const qs = (extra: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...filters, ...extra })) if (v) q.set(k, v);
    return q.toString();
  };

  return (
    <>
      <PageHeader
        title="Reports"
        description="Every report people sent from the apps: what, why, who reported it and their screenshots. Reports about the same thing share one case; open it to decide."
        actions={
          <Link href="/moderation" className={buttonClass('secondary')}>
            Open cases
          </Link>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-5">
        {(
          [
            ['Open', summary.open, 'OPEN', summary.open > 0],
            ['Today', summary.today, 'all', false],
            ['Last 7 days', summary.last7Days, 'all', false],
            ['Action taken', summary.actioned, 'ACTIONED', false],
            ['Dismissed', summary.dismissed, 'DISMISSED', false],
          ] as const
        ).map(([label, n, status, hot]) => (
          <Link key={label} href={`/reports?status=${status}`} className="rounded-lg border border-line bg-panel px-4 py-3 hover:border-muted">
            <p className="text-xs text-muted">{label}</p>
            <p className={`mt-1 text-xl tabular-nums ${hot ? 'text-warn' : ''}`}>{formatNumber(n)}</p>
          </Link>
        ))}
      </div>

      {summary.openByType.length > 0 && (
        <p className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted">
          Open by type:
          {summary.openByType.map((t) => (
            <Link key={t.targetType} href={`/reports?${qs({ status: 'OPEN', targetType: t.targetType })}`} className="hover:underline">
              <Tag>
                {targetPlural(t.targetType)} {t.count}
              </Tag>
            </Link>
          ))}
        </p>
      )}

      <Panel>
        <nav aria-label="Report status" className="flex flex-wrap items-center gap-1 border-b border-line-soft px-4 py-2">
          {VIEWS.map((v) => (
            <Link
              key={v.key}
              href={`/reports?${qs({ status: v.key })}`}
              aria-current={view.key === v.key ? 'page' : undefined}
              className={`rounded px-3 py-1.5 text-sm ${view.key === v.key ? 'bg-teal-wash font-medium text-teal' : 'text-muted hover:text-ink'}`}
            >
              {v.label}
            </Link>
          ))}
        </nav>
        <form className="flex flex-wrap items-end gap-3 border-b border-line-soft px-4 py-3" role="search">
          <input type="hidden" name="status" value={view.key} />
          <div className="min-w-56 flex-1">
            <label htmlFor="q" className="sr-only">
              Search reports
            </label>
            <Input id="q" name="q" defaultValue={sp.q ?? ''} placeholder="Words in the details, or the reporter’s name or email" />
          </div>
          <div>
            <label htmlFor="targetType" className="sr-only">
              Type
            </label>
            <Select id="targetType" name="targetType" defaultValue={sp.targetType ?? ''}>
              <option value="">Every type</option>
              {Object.keys(TARGET_LABELS).map((k) => (
                <option key={k} value={k}>
                  {targetPlural(k)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="reason" className="sr-only">
              Reason
            </label>
            <Select id="reason" name="reason" defaultValue={sp.reason ?? ''}>
              <option value="">Any reason</option>
              {Object.entries(REASON_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="from" className="block text-xs text-muted">
              From
            </label>
            <Input id="from" name="from" type="date" defaultValue={sp.from ?? ''} />
          </div>
          <div>
            <label htmlFor="to" className="block text-xs text-muted">
              To
            </label>
            <Input id="to" name="to" type="date" defaultValue={sp.to ?? ''} />
          </div>
          <button className={buttonClass('secondary')}>Filter</button>
        </form>

        {items.length === 0 ? (
          <Empty title={view.key === 'OPEN' && !sp.q && !sp.targetType ? 'No open reports' : 'No reports match'}>
            {view.key === 'OPEN' ? 'Reports from the apps appear here as they come in.' : undefined}
          </Empty>
        ) : (
          <>
            <Table head={['Reported', 'Type', 'Reason', 'Reporter', 'Evidence', 'Status', 'Moderator', 'Resolution']}>
              {items.map((r) => (
                <tr key={r.id} className="align-top hover:bg-paper">
                  <Td className="max-w-[30ch]">
                    {r.case ? (
                      <Link href={`/moderation/${r.case.id}`} className="block font-medium text-teal hover:underline">
                        {r.entity.label}
                      </Link>
                    ) : (
                      <span className="font-medium">{r.entity.label}</span>
                    )}
                    <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                      {r.entity.owner && <span>by {r.entity.owner.name ?? 'no name'}</span>}
                      {r.entity.status && <StatusTag status={r.entity.status} />}
                      {!r.entity.exists && <span>deleted</span>}
                    </span>
                  </Td>
                  <Td className="whitespace-nowrap text-sm text-muted">{TARGET_LABELS[r.targetType] ?? r.targetType}</Td>
                  <Td className="max-w-[28ch] text-sm">
                    <Tag tone={r.reason === 'ANIMAL_WELFARE' || r.reason === 'VIOLENCE' ? 'danger' : 'neutral'}>
                      {REASON_LABELS[r.reason] ?? r.reason}
                    </Tag>
                    {r.details && <span className="mt-1 block text-xs text-muted">“{r.details}”</span>}
                  </Td>
                  <Td className="text-sm">
                    <Link href={`/users/${r.reporter.id}`} className="hover:underline">
                      {r.reporter.name ?? 'No name'}
                    </Link>
                    <span className="block whitespace-nowrap text-xs text-muted" title={formatDateTime(r.createdAt)}>
                      {timeAgo(r.createdAt)}
                    </span>
                  </Td>
                  <Td>
                    {r.evidence.length ? (
                      <span className="flex gap-1">
                        {r.evidence.map((m) => {
                          const src = m.images?.find((i) => i.width <= 640)?.url ?? m.images?.[0]?.url;
                          return src ? (
                            <a key={m.id} href={m.images?.at(-1)?.url ?? src} target="_blank" rel="noreferrer" className="block h-10 w-10 overflow-hidden rounded border border-line-soft bg-line-soft">
                              <img src={src} alt="Screenshot from the reporter" className="h-full w-full object-cover" />
                            </a>
                          ) : null;
                        })}
                      </span>
                    ) : (
                      <span className="text-sm text-muted">None</span>
                    )}
                  </Td>
                  <Td>
                    <Tag tone={REPORT_STATUS[r.status]?.tone ?? 'neutral'}>{REPORT_STATUS[r.status]?.label ?? r.status}</Tag>
                    {r.case && r.case.reportCount > 1 && (
                      <span className="mt-1 block text-xs text-muted">{r.case.reportCount} reports on this</span>
                    )}
                  </Td>
                  <Td className="text-sm">{r.case?.moderator?.name ?? <span className="text-muted">—</span>}</Td>
                  <Td className="max-w-[26ch] text-sm">
                    {r.case?.resolution ? (
                      <>
                        {RESOLUTION_LABELS[r.case.resolution] ?? r.case.resolution}
                        {r.case.resolutionNote && <span className="block text-xs text-muted">“{r.case.resolutionNote}”</span>}
                      </>
                    ) : (
                      <span className="text-muted">Waiting</span>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
            <Pagination meta={meta} basePath="/reports" params={{ status: view.key, ...filters }} />
          </>
        )}
      </Panel>
    </>
  );
}
