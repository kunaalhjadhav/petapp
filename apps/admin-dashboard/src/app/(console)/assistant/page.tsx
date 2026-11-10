import Link from 'next/link';
import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { api, apiPage } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatNumber, timeAgo } from '@/lib/format';
import type { AssistantFeedback, AssistantStatus } from '@/lib/types';
import { Empty, NoAccess, PageHeader, Panel, Tag, inputClass } from '@/components/ui';
import { InlineForm, SubmitButton } from '@/components/forms';
import { Pagination, Table, Td } from '@/components/table';
import { saveAssistantSettings } from './actions';

export const metadata: Metadata = { title: 'PetApp Assistant' };

const VIEWS = [
  { key: 'DOWN', label: 'Thumbs down' },
  { key: 'UP', label: 'Thumbs up' },
];
const SAFETY: Record<string, { label: string; tone: 'danger' | 'warn' } | undefined> = {
  URGENT: { label: 'Emergency', tone: 'danger' },
  GENERAL_INFO: { label: 'Health info', tone: 'warn' },
};
const PROVIDERS: Record<string, string> = {
  safety: 'Fixed safety answer',
  rules: 'Built-in answers',
  anthropic: 'AI model',
};

export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!can(me, PERMISSIONS.SETTINGS_READ)) return <NoAccess what="the PetApp Assistant" />;
  const view = sp.view === 'UP' ? 'UP' : 'DOWN';
  const status = await api<AssistantStatus>('/admin/assistant/status');
  const canFeedback = can(me, PERMISSIONS.CONTENT_READ);
  const fb = canFeedback
    ? await apiPage<AssistantFeedback>('/admin/assistant/feedback', {
        rating: view,
        page: sp.page,
        limit: 20,
      })
    : null;
  const d = status.last24h;
  const stat = (label: string, value: string, tone = '') => (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`mt-0.5 tabular-nums ${tone}`}>{value}</dd>
    </div>
  );

  return (
    <>
      <PageHeader
        title="PetApp Assistant"
        description="The in-app assistant helps people find services, products, contests and challenges, explains contest rules and how the app works, and shares general pet-care tips. Emergencies and medicine-dose questions always get a fixed answer that sends people to a vet; it never diagnoses."
        actions={
          <Link href="/settings" className="text-sm text-teal hover:underline">
            Switch it on or off
          </Link>
        }
      />

      <div className="mb-6 grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
        <Panel title="Status">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 px-4 py-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted">In the app</dt>
              <dd className="mt-0.5">
                {status.enabled ? <Tag tone="good">On</Tag> : <Tag tone="warn">Off</Tag>}
              </dd>
            </div>
            {stat(
              'Answered by',
              status.usesModel ? `AI model (${status.model})` : 'Built-in answers only',
            )}
            {stat('Answers (24 h)', formatNumber(d.answers))}
            {stat('Emergencies (24 h)', formatNumber(d.urgent), d.urgent ? 'text-danger' : '')}
            {stat('Health questions (24 h)', formatNumber(d.healthInfo))}
            {stat(
              'Model failures (24 h)',
              formatNumber(d.modelFailures),
              d.modelFailures ? 'text-danger' : '',
            )}
            {stat(
              'Average answer time',
              d.answers ? `${(d.avgLatencyMs / 1000).toFixed(1)} s` : '—',
            )}
            {stat(
              'Ratings (30 days)',
              `${status.ratings30d.up} up · ${status.ratings30d.down} down`,
            )}
            {status.usesModel &&
              stat(
                'Tokens (24 h)',
                `${formatNumber(d.inputTokens)} in · ${formatNumber(d.outputTokens)} out`,
              )}
          </dl>
          {!status.usesModel && (
            <p className="border-t border-line-soft px-4 py-3 text-xs text-muted">
              Without an AI model the assistant understands common questions by keywords and answers
              from templates. To use Claude, set <code>AI_PROVIDER=anthropic</code> and{' '}
              <code>ANTHROPIC_API_KEY</code> on the API (and optionally{' '}
              <code>AI_ASSISTANT_MODEL</code>).
            </p>
          )}
        </Panel>

        <Panel title="Limits">
          {can(me, PERMISSIONS.SETTINGS_MANAGE) ? (
            <InlineForm
              action={saveAssistantSettings.bind(null, {
                dailyLimit: status.dailyLimit,
                historyDays: status.historyDays,
              })}
              className="flex flex-col gap-4 px-4 py-4"
            >
              <label className="flex flex-col gap-1 text-sm font-medium">
                Questions per person per day
                <input
                  name="dailyLimit"
                  type="number"
                  min={1}
                  max={500}
                  defaultValue={status.dailyLimit}
                  className={`${inputClass} max-w-24`}
                />
                <span className="text-xs font-normal text-muted">
                  Keeps AI costs predictable and stops abuse.
                </span>
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium">
                Keep conversations for (days)
                <input
                  name="historyDays"
                  type="number"
                  min={1}
                  max={365}
                  defaultValue={status.historyDays}
                  className={`${inputClass} max-w-24`}
                />
                <span className="text-xs font-normal text-muted">
                  Older ones are deleted every night. People can delete theirs at any time.
                </span>
              </label>
              <div>
                <SubmitButton>Save</SubmitButton>
              </div>
            </InlineForm>
          ) : (
            <p className="px-4 py-4 text-sm text-muted">
              {status.dailyLimit} questions a day; conversations kept for {status.historyDays} days.
            </p>
          )}
        </Panel>
      </div>

      {fb && (
        <Panel>
          <nav
            aria-label="Ratings"
            className="flex flex-wrap items-center gap-1 border-b border-line-soft px-4 py-2"
          >
            {VIEWS.map((v) => (
              <Link
                key={v.key}
                href={`/assistant?view=${v.key}`}
                aria-current={view === v.key ? 'page' : undefined}
                className={`rounded px-3 py-1.5 text-sm ${view === v.key ? 'bg-teal-wash font-medium text-teal' : 'text-muted hover:text-ink'}`}
              >
                {v.label}
              </Link>
            ))}
            <span className="ml-auto text-xs text-muted">
              Only answers people chose to rate are shown here. Other conversations stay private.
            </span>
          </nav>
          {fb.items.length === 0 ? (
            <Empty
              title={view === 'DOWN' ? 'No thumbs-down answers' : 'No thumbs-up answers yet'}
            />
          ) : (
            <Table head={['Rated', 'Question', 'Answer', 'Their note', 'Answered by']}>
              {fb.items.map((f) => (
                <tr key={f.id} className="align-top">
                  <Td className="whitespace-nowrap text-muted">{timeAgo(f.ratedAt)}</Td>
                  <Td className="max-w-56 text-sm">{f.question ?? '—'}</Td>
                  <Td className="max-w-md text-sm">
                    {SAFETY[f.safety] && (
                      <span className="mb-1 block">
                        <Tag tone={SAFETY[f.safety]!.tone}>{SAFETY[f.safety]!.label}</Tag>
                      </span>
                    )}
                    <span className="line-clamp-4 whitespace-pre-line">{f.answer}</span>
                    {f.cards.length > 0 && (
                      <span className="mt-1 block text-xs text-muted">
                        Showed: {f.cards.map((c) => c.toLowerCase()).join(', ')}
                      </span>
                    )}
                  </Td>
                  <Td className="max-w-56 text-sm">{f.note ?? '—'}</Td>
                  <Td className="whitespace-nowrap text-xs text-muted">
                    {PROVIDERS[f.provider ?? ''] ?? f.provider}
                    <span className="block">{f.model}</span>
                    {f.error && (
                      <span className="block text-danger">Model failed; built-in answer used</span>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
          <Pagination meta={fb.meta} basePath="/assistant" params={{ ...sp, view }} />
        </Panel>
      )}
    </>
  );
}
