import Link from 'next/link';
import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { apiPage } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatPhone, timeAgo } from '@/lib/format';
import { RISK_SIGNALS } from '@/lib/labels';
import type { RiskRow } from '@/lib/types';
import { Empty, NoAccess, PageHeader, Panel, StatusTag, Tag } from '@/components/ui';
import { Pagination, Table, Td } from '@/components/table';

export const metadata: Metadata = { title: 'Account risk' };

const TABS = [
  { key: 'to_review', label: 'To review' },
  { key: 'reviewed', label: 'Reviewed' },
  { key: 'all', label: 'All scored accounts' },
];
const LEVEL_TONE = { HIGH: 'danger', MEDIUM: 'warn', LOW: 'neutral' } as const;

export default async function RiskPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!can(me, PERMISSIONS.USERS_READ)) return <NoAccess what="account risk" />;
  const state = TABS.some((t) => t.key === sp.state) ? sp.state! : 'to_review';
  const { items, meta } = await apiPage<RiskRow>('/admin/risk', {
    state,
    page: sp.page,
    limit: 25,
  });

  return (
    <>
      <PageHeader
        title="Account risk"
        description="Accounts scored from signals such as new accounts voting in bursts, many accounts on one network, copied photos and payment problems. A high score only means someone should look: nobody is blocked or banned automatically. Votes from accounts waiting here are held until reviewed."
      />
      <Panel>
        <nav
          aria-label="Accounts"
          className="flex flex-wrap gap-1 border-b border-line-soft px-4 py-2"
        >
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/trust/risk?state=${t.key}`}
              aria-current={state === t.key ? 'page' : undefined}
              className={`rounded px-3 py-1.5 text-sm ${state === t.key ? 'bg-teal-wash font-medium text-teal' : 'text-muted hover:text-ink'}`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        {items.length === 0 ? (
          <Empty title={state === 'to_review' ? 'No accounts waiting for review' : 'Nothing here'}>
            {state === 'to_review'
              ? 'High-risk accounts appear here as they are scored.'
              : undefined}
          </Empty>
        ) : (
          <Table head={['Person', 'Score', 'Why', 'Account', 'Scored']}>
            {items.map((r) => (
              <tr key={r.userId} className="align-top hover:bg-paper">
                <Td>
                  <Link href={`/trust/risk/${r.userId}`} className="font-medium hover:underline">
                    {r.user.name ?? 'No name'}
                  </Link>
                  <p className="text-xs text-muted">
                    {formatPhone(r.user.phone) !== '—'
                      ? formatPhone(r.user.phone)
                      : (r.user.email ?? '')}
                  </p>
                </Td>
                <Td className="whitespace-nowrap">
                  <Tag tone={LEVEL_TONE[r.level]}>
                    {r.score} · {r.level.toLowerCase()}
                  </Tag>
                </Td>
                <Td>
                  <span className="flex flex-wrap gap-1">
                    {r.signals.slice(0, 3).map((s) => (
                      <Tag key={s.signal}>{RISK_SIGNALS[s.signal] ?? s.signal}</Tag>
                    ))}
                  </span>
                  {r.reviewNote && (
                    <p className="mt-1 max-w-sm text-xs text-muted">Reviewed: {r.reviewNote}</p>
                  )}
                </Td>
                <Td>
                  <StatusTag status={r.user.status} />
                  <p className="mt-1 text-xs text-muted">joined {timeAgo(r.user.createdAt)}</p>
                </Td>
                <Td className="whitespace-nowrap text-muted">{timeAgo(r.computedAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
        <Pagination meta={meta} basePath="/trust/risk" params={{ ...sp, state }} />
      </Panel>
    </>
  );
}
