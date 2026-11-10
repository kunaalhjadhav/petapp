import Link from 'next/link';
import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { apiPage } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { timeAgo } from '@/lib/format';
import {
  AI_LABELS,
  REASON_LABELS,
  RESOLUTION_LABELS,
  TARGET_LABELS,
  confidence,
  targetPlural,
} from '@/lib/labels';
import type { CaseRow } from '@/lib/types';
import { Empty, NoAccess, PageHeader, Panel, Select, Tag, buttonClass } from '@/components/ui';
import { Pagination, Table, Td } from '@/components/table';
import { TargetCard } from './preview';

export const metadata: Metadata = { title: 'Moderation' };

export default async function ModerationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!can(me, PERMISSIONS.CONTENT_READ)) return <NoAccess what="moderation" />;
  const status = sp.status === 'RESOLVED' ? 'RESOLVED' : 'OPEN';
  const source = sp.source === 'ai' || sp.source === 'reports' ? sp.source : undefined;
  const { items, meta } = await apiPage<CaseRow>('/admin/moderation/cases', {
    status,
    source,
    targetType: sp.targetType,
    page: sp.page,
    limit: 25,
  });

  return (
    <>
      <PageHeader
        title="Moderation"
        description="Reports from the community and items flagged by AI moderation, grouped so each thing is one case. AI only flags: a moderator always decides."
      />
      <Panel>
        <form className="flex flex-wrap items-end gap-3 border-b border-line-soft px-4 py-3">
          <div
            className="flex rounded-md border border-line bg-panel p-0.5"
            role="group"
            aria-label="Status"
          >
            {(['OPEN', 'RESOLVED'] as const).map((s) => (
              <Link
                key={s}
                href={`/moderation?status=${s}${sp.targetType ? `&targetType=${sp.targetType}` : ''}${source ? `&source=${source}` : ''}`}
                aria-current={status === s ? 'page' : undefined}
                className={`rounded px-3 py-1.5 text-sm ${status === s ? 'bg-teal-wash font-medium text-teal' : 'text-muted hover:text-ink'}`}
              >
                {s === 'OPEN' ? 'Open' : 'Resolved'}
              </Link>
            ))}
          </div>
          <input type="hidden" name="status" value={status} />
          <div>
            <label htmlFor="source" className="sr-only">
              Source
            </label>
            <Select id="source" name="source" defaultValue={source ?? ''}>
              <option value="">Reports and AI flags</option>
              <option value="reports">Reported by people</option>
              <option value="ai">Flagged by AI</option>
            </Select>
          </div>
          <div>
            <label htmlFor="targetType" className="sr-only">
              Type
            </label>
            <Select id="targetType" name="targetType" defaultValue={sp.targetType ?? ''}>
              <option value="">Everything</option>
              {Object.keys(TARGET_LABELS).map((k) => (
                <option key={k} value={k}>
                  {targetPlural(k)}
                </option>
              ))}
            </Select>
          </div>
          <button className={buttonClass('secondary')}>Apply</button>
        </form>

        {items.length === 0 ? (
          <Empty title={status === 'OPEN' ? 'Nothing waiting for review' : 'No resolved cases yet'}>
            {status === 'OPEN' ? 'New reports from the app and AI flags appear here.' : undefined}
          </Empty>
        ) : (
          <Table
            head={['Item', 'Type', 'Reasons', 'Reports', status === 'OPEN' ? 'Latest' : 'Decision']}
          >
            {items.map((c) => (
              <tr key={c.id} className="hover:bg-paper">
                <Td className="max-w-md">
                  <Link href={`/moderation/${c.id}`} className="block">
                    <TargetCard target={c.target} compact />
                  </Link>
                </Td>
                <Td className="whitespace-nowrap text-muted">{TARGET_LABELS[c.targetType]}</Td>
                <Td>
                  <span className="flex flex-wrap gap-1">
                    {c.ai && (
                      <Tag tone={c.ai.verdict === 'FLAGGED' ? 'warn' : 'neutral'}>
                        AI: {AI_LABELS[c.ai.topLabel ?? ''] ?? c.ai.topLabel ?? 'checked'}{' '}
                        {confidence(c.ai.confidence)}
                      </Tag>
                    )}
                    {c.reasons.map((r) => (
                      <Tag
                        key={r.reason}
                        tone={
                          r.reason === 'ANIMAL_WELFARE' || r.reason === 'VIOLENCE'
                            ? 'danger'
                            : 'neutral'
                        }
                      >
                        {REASON_LABELS[r.reason] ?? r.reason}
                        {r.count > 1 ? ` ×${r.count}` : ''}
                      </Tag>
                    ))}
                  </span>
                </Td>
                <Td className="font-medium">
                  {c.reportCount || <span className="font-normal text-muted">None</span>}
                </Td>
                <Td className="whitespace-nowrap text-muted">
                  {status === 'OPEN'
                    ? timeAgo(
                        c.aiFlaggedAt && c.aiFlaggedAt > c.lastReportedAt
                          ? c.aiFlaggedAt
                          : c.lastReportedAt,
                      )
                    : (RESOLUTION_LABELS[c.resolution ?? ''] ?? '—')}
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <Pagination meta={meta} basePath="/moderation" params={{ ...sp, status }} />
      </Panel>
    </>
  );
}
