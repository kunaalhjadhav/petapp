import Link from 'next/link';
import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { api, apiPage } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatNumber, timeAgo } from '@/lib/format';
import { AI_LABELS, TARGET_LABELS, confidence } from '@/lib/labels';
import type { AiAssessmentRow, AiStatus } from '@/lib/types';
import { Empty, NoAccess, PageHeader, Panel, Tag, inputClass } from '@/components/ui';
import { InlineForm, SubmitButton } from '@/components/forms';
import { Pagination, Table, Td } from '@/components/table';
import { saveAiSettings } from './actions';

export const metadata: Metadata = { title: 'AI moderation' };

const VIEWS = [
  { key: 'FLAGGED', label: 'Flagged' },
  { key: 'ERROR', label: 'Failed checks' },
  { key: 'ALL', label: 'Everything checked' },
];
const ownerLink = (a: AiAssessmentRow) =>
  a.targetType === 'USER'
    ? `/users/${a.targetId}`
    : a.targetType === 'PET'
      ? `/pets/${a.targetId}`
      : a.ownerId
        ? `/users/${a.ownerId}`
        : null;

export default async function AiModerationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!can(me, PERMISSIONS.CONTENT_READ)) return <NoAccess what="AI moderation" />;
  const view = VIEWS.some((v) => v.key === sp.view) ? sp.view! : 'FLAGGED';
  const [status, { items, meta }] = await Promise.all([
    api<AiStatus>('/admin/ai/status'),
    apiPage<AiAssessmentRow>('/admin/ai/assessments', {
      verdict: view === 'ALL' ? undefined : view,
      page: sp.page,
      limit: 25,
    }),
  ]);
  const manage = can(me, PERMISSIONS.SETTINGS_MANAGE);
  const n = (k: 'CLEAR' | 'FLAGGED' | 'ERROR') => formatNumber(status.last24h[k] ?? 0);

  return (
    <>
      <PageHeader
        title="AI moderation"
        description="New posts, comments, profiles, product listings, reviews and contest entries are checked automatically. Confident results open a case in Moderation; a moderator always makes the decision."
        actions={
          <Link href="/moderation?source=ai" className="text-sm text-teal hover:underline">
            Cases flagged by AI
          </Link>
        }
      />

      <div className="mb-6 grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
        <Panel title="Status">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 px-4 py-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted">Checking</dt>
              <dd className="mt-0.5">
                {status.enabled ? <Tag tone="good">On</Tag> : <Tag tone="warn">Off</Tag>}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Checked by</dt>
              <dd className="mt-0.5">
                {status.usesModel ? `AI model (${status.provider})` : 'PetApp rules only'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Last 24 hours</dt>
              <dd className="mt-0.5 tabular-nums">
                {n('FLAGGED')} flagged · {n('CLEAR')} clear
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Failed checks (24 h)</dt>
              <dd className={`mt-0.5 tabular-nums ${status.last24h.ERROR ? 'text-danger' : ''}`}>
                {n('ERROR')}
              </dd>
            </div>
          </dl>
          {!status.usesModel && (
            <p className="border-t border-line-soft px-4 py-3 text-xs text-muted">
              Only PetApp’s built-in rules (obvious spam, abuse, scams, copied photos) are running.
              To use an AI model, set <code>AI_PROVIDER=anthropic</code> and{' '}
              <code>ANTHROPIC_API_KEY</code> on the API and worker.
            </p>
          )}
        </Panel>

        <Panel title="Settings">
          {manage ? (
            <InlineForm
              action={saveAiSettings.bind(null, {
                enabled: status.enabled,
                flagPct: status.flagPct,
                autoHidePct: status.autoHidePct,
              })}
              className="flex flex-col gap-4 px-4 py-4"
            >
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="enabled"
                  defaultChecked={status.enabled}
                  className="accent-[var(--color-teal)]"
                />
                Check new content
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium">
                Open a case at (%)
                <input
                  name="flagPct"
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={status.flagPct}
                  className={`${inputClass} w-24`}
                />
                <span className="text-xs font-normal text-muted">
                  How confident the check must be. Lower finds more, with more false alarms.
                </span>
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium">
                Hide while waiting at (%)
                <input
                  name="autoHidePct"
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={status.autoHidePct}
                  className={`${inputClass} w-24`}
                />
                <span className="text-xs font-normal text-muted">
                  0 = never hide. Hidden items come back if the moderator dismisses the case.
                </span>
              </label>
              <div>
                <SubmitButton>Save</SubmitButton>
              </div>
            </InlineForm>
          ) : (
            <p className="px-4 py-4 text-sm text-muted">
              Opens a case at {status.flagPct}% confidence;{' '}
              {status.autoHidePct
                ? `hides while waiting at ${status.autoHidePct}%`
                : 'never hides anything'}
              .
            </p>
          )}
        </Panel>
      </div>

      <Panel>
        <nav
          aria-label="Checks"
          className="flex flex-wrap gap-1 border-b border-line-soft px-4 py-2"
        >
          {VIEWS.map((v) => (
            <Link
              key={v.key}
              href={`/trust?view=${v.key}`}
              aria-current={view === v.key ? 'page' : undefined}
              className={`rounded px-3 py-1.5 text-sm ${view === v.key ? 'bg-teal-wash font-medium text-teal' : 'text-muted hover:text-ink'}`}
            >
              {v.label}
            </Link>
          ))}
        </nav>
        {items.length === 0 ? (
          <Empty title={view === 'FLAGGED' ? 'Nothing flagged' : 'Nothing here'} />
        ) : (
          <Table head={['When', 'Item', 'Result', 'Why', 'Model']}>
            {items.map((a) => {
              const href = ownerLink(a);
              return (
                <tr key={a.id} className="align-top">
                  <Td className="whitespace-nowrap text-muted">{timeAgo(a.createdAt)}</Td>
                  <Td className="whitespace-nowrap">
                    {TARGET_LABELS[a.targetType] ?? a.targetType}
                    {href && (
                      <Link href={href} className="block text-xs text-teal hover:underline">
                        {a.targetType === 'USER' || a.targetType === 'PET'
                          ? 'Open'
                          : 'Their account'}
                      </Link>
                    )}
                  </Td>
                  <Td>
                    {a.verdict === 'ERROR' ? (
                      <Tag tone="danger">Failed</Tag>
                    ) : a.topLabel ? (
                      <Tag tone={a.verdict === 'FLAGGED' ? 'warn' : 'neutral'}>
                        {AI_LABELS[a.topLabel] ?? a.topLabel} {confidence(a.confidence)}
                      </Tag>
                    ) : (
                      <Tag tone="good">Clear</Tag>
                    )}
                  </Td>
                  <Td className="max-w-md text-sm">{a.error ?? a.reason}</Td>
                  <Td className="whitespace-nowrap text-xs text-muted">
                    {a.model}
                    <span className="block">v{a.version}</span>
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
        <Pagination meta={meta} basePath="/trust" params={{ ...sp, view }} />
      </Panel>
    </>
  );
}
