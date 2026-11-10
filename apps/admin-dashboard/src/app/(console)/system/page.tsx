import Link from 'next/link';
import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { api } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatNumber, timeAgo } from '@/lib/format';
import type { SystemCheck, SystemStatus } from '@/lib/types';
import { NoAccess, PageHeader, Panel, Tag } from '@/components/ui';
import { InlineForm, SubmitButton } from '@/components/forms';
import { Table, Td } from '@/components/table';
import { retryQueue } from './actions';

export const metadata: Metadata = { title: 'System health' };
export const dynamic = 'force-dynamic';

const QUEUE_LABELS: Record<string, string> = {
  media: 'Photos and videos',
  maintenance: 'Scheduled jobs (refunds, payouts, reconciliation, clean-up)',
  notifications: 'Notifications',
  trust: 'AI moderation and account risk',
};
const PROVIDER_LABELS: Record<string, string> = {
  payments: 'Payments',
  payouts: 'Payouts',
  sms: 'SMS',
  push: 'Push notifications',
  ai: 'AI',
  errorTracking: 'Error tracking',
  metrics: 'Metrics',
  mediaCdn: 'Media CDN',
};
/** Settings that mean "not for real use yet". */
const NOT_LIVE = new Set(['fake', 'console', 'none', 'no token', 'not set']);

const uptime = (s: number) =>
  s < 3600
    ? `${Math.floor(s / 60)} min`
    : s < 86_400
      ? `${Math.floor(s / 3600)} h`
      : `${Math.floor(s / 86_400)} days`;

function Check({ name, c }: { name: string; c: SystemCheck }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
      <span>{name}</span>
      {c.ok ? (
        <span className="flex items-center gap-2 tabular-nums text-muted">
          {c.ms} ms <Tag tone="good">OK</Tag>
        </span>
      ) : (
        <span className="flex items-center gap-2 text-danger">
          {c.error} <Tag tone="danger">Down</Tag>
        </span>
      )}
    </div>
  );
}

export default async function SystemPage() {
  const me = await getMe();
  if (!can(me, PERMISSIONS.SETTINGS_READ)) return <NoAccess what="system health" />;
  const s = await api<SystemStatus>('/admin/system');
  const manage = can(me, PERMISSIONS.SETTINGS_MANAGE);
  const money = [
    { label: 'Refunds that failed (7 days)', n: s.money.refundsFailed, href: '/finance/refunds' },
    { label: 'Refunds owed for over a day', n: s.money.refundsOverdue, href: '/finance/refunds' },
    { label: 'Payouts that failed (7 days)', n: s.money.payoutsFailed, href: '/finance/payouts' },
    {
      label: 'Payment webhooks not processed',
      n: s.money.webhooksUnprocessed,
      href: '/finance/reconciliation',
    },
  ];

  return (
    <>
      <PageHeader
        title="System health"
        description={`The API's dependencies, background jobs and the services it's connected to, right now. Environment: ${s.environment}${s.release ? `, release ${s.release}` : ''}. Up for ${uptime(s.uptimeSeconds)}. Detailed metrics go to your monitoring through /metrics.`}
      />

      <div className="mb-6 grid items-start gap-6 lg:grid-cols-3">
        <Panel title="Dependencies">
          <div className="divide-y divide-line-soft">
            <Check name="Database" c={s.checks.database} />
            <Check name="Redis (cache and job queues)" c={s.checks.redis} />
            <Check name="File storage" c={s.checks.storage} />
          </div>
        </Panel>
        <Panel title="Connected services">
          <dl className="divide-y divide-line-soft text-sm">
            {Object.entries(s.providers).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <dt>{PROVIDER_LABELS[k] ?? k}</dt>
                <dd>
                  {NOT_LIVE.has(v) ? (
                    <Tag tone={s.environment === 'production' ? 'danger' : 'neutral'}>{v}</Tag>
                  ) : (
                    <Tag tone="good">{v}</Tag>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </Panel>
        <Panel title="Money needing attention">
          <ul className="divide-y divide-line-soft text-sm">
            {money.map((m) => (
              <li key={m.label} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <Link href={m.href} className="hover:underline">
                  {m.label}
                </Link>
                <span
                  className={`tabular-nums ${m.n ? 'font-semibold text-danger' : 'text-muted'}`}
                >
                  {formatNumber(m.n)}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel title="Background jobs">
        <Table
          head={['Queue', 'Waiting', 'Running', 'Scheduled', 'Failed', 'Recent failures', '']}
          numeric={[1, 2, 3, 4]}
        >
          {s.queues.map((q) => (
            <tr key={q.name} className="align-top">
              <Td>
                <span className="font-medium">{QUEUE_LABELS[q.name] ?? q.name}</span>
                <span className="block text-xs text-muted">{q.name}</span>
              </Td>
              <Td className="text-right tabular-nums">{formatNumber(q.counts.waiting)}</Td>
              <Td className="text-right tabular-nums">{formatNumber(q.counts.active)}</Td>
              <Td className="text-right tabular-nums">{formatNumber(q.counts.delayed)}</Td>
              <Td className={`text-right tabular-nums ${q.counts.failed ? 'text-danger' : ''}`}>
                {formatNumber(q.counts.failed)}
              </Td>
              <Td className="max-w-md text-xs">
                {q.recentFailures.length === 0 ? (
                  <span className="text-muted">None</span>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {q.recentFailures.slice(0, 3).map((f) => (
                      <li key={f.id}>
                        <span className="font-medium">{f.job}</span>{' '}
                        {f.at && <span className="text-muted">{timeAgo(f.at)}</span>}
                        <span className="block break-words text-muted">{f.error}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Td>
              <Td>
                {manage && q.counts.failed > 0 && (
                  <InlineForm action={retryQueue.bind(null, q.name)}>
                    <SubmitButton size="sm" variant="secondary">
                      Retry failed
                    </SubmitButton>
                  </InlineForm>
                )}
              </Td>
            </tr>
          ))}
        </Table>
        <p className="border-t border-line-soft px-4 py-3 text-xs text-muted">
          Jobs retry on their own with backoff; failures listed here used up their retries. Fix the
          cause (it’s in the error and the logs) before retrying.
        </p>
      </Panel>
    </>
  );
}
