import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PERMISSIONS } from '@petapp/types';
import { ApiError, api } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatDateTime, formatPhone, timeAgo } from '@/lib/format';
import { RISK_SIGNALS } from '@/lib/labels';
import type { RiskDetail } from '@/lib/types';
import { Facts, NoAccess, PageHeader, Panel, StatusTag, Tag, inputClass } from '@/components/ui';
import { InlineForm, SubmitButton } from '@/components/forms';
import { recomputeRisk, reviewRisk } from '../../actions';

export const metadata: Metadata = { title: 'Account risk' };
const LEVEL_TONE = { HIGH: 'danger', MEDIUM: 'warn', LOW: 'neutral' } as const;

export default async function RiskDetailPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const me = await getMe();
  if (!can(me, PERMISSIONS.USERS_READ)) return <NoAccess what="account risk" />;
  let r: RiskDetail;
  try {
    r = await api<RiskDetail>(`/admin/risk/${userId}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
  const canReview = can(me, PERMISSIONS.USERS_SUSPEND);

  return (
    <>
      <PageHeader
        back={{ href: '/trust/risk', label: 'Account risk' }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {r.user.name ?? 'No name'}
            <Tag tone={LEVEL_TONE[r.level]}>
              Risk {r.score} · {r.level.toLowerCase()}
            </Tag>
          </span>
        }
        description="A score from automated signals. It decides who staff look at first, never what happens to the account."
        actions={
          <Link href={`/users/${r.userId}`} className="text-sm text-teal hover:underline">
            Open their profile
          </Link>
        }
      />
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel
            title="Signals"
            actions={
              <InlineForm
                action={recomputeRisk.bind(null, r.userId)}
                className="flex items-center gap-2"
              >
                <SubmitButton size="sm" variant="secondary">
                  Score again
                </SubmitButton>
              </InlineForm>
            }
          >
            {r.signals.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted">No risk signals.</p>
            ) : (
              <ul className="divide-y divide-line-soft">
                {r.signals.map((s) => (
                  <li key={s.signal} className="flex items-start justify-between gap-4 px-4 py-3">
                    <span>
                      <span className="block text-sm font-medium">
                        {RISK_SIGNALS[s.signal] ?? s.signal}
                      </span>
                      <span className="block text-sm text-muted">{s.detail}</span>
                    </span>
                    <span className="whitespace-nowrap text-sm tabular-nums text-muted">
                      +{s.points}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="border-t border-line-soft px-4 py-3 text-xs text-muted">
              Scored {timeAgo(r.computedAt)}. Shared networks are common (offices, colleges, mobile
              data), so they only count with other signals.
            </p>
          </Panel>

          <Panel title="Review">
            {r.reviewedAt && (
              <div className="border-b border-line-soft px-4 py-3 text-sm">
                <p>“{r.reviewNote}”</p>
                <p className="mt-1 text-xs text-muted">
                  {r.reviewedBy?.name ?? r.reviewedBy?.email ?? 'Staff'},{' '}
                  {formatDateTime(r.reviewedAt)}, at score {r.reviewedScore}
                  {r.needsReview ? '. The score has risen since, so it needs another look.' : '.'}
                </p>
              </div>
            )}
            {canReview ? (
              <InlineForm
                action={reviewRisk.bind(null, r.userId)}
                className="flex flex-col gap-3 px-4 py-4"
                resetOnSuccess
              >
                <label htmlFor="note" className="text-sm font-medium">
                  What you found
                </label>
                <textarea
                  id="note"
                  name="note"
                  required
                  minLength={3}
                  maxLength={500}
                  rows={3}
                  className={`${inputClass} h-auto py-2`}
                  placeholder="e.g. Shared college Wi-Fi; votes look genuine"
                />
                <p className="text-xs text-muted">
                  Recording a review releases future votes from being held for this score. To
                  suspend the account, use their profile page.
                </p>
                <div>
                  <SubmitButton>Record review</SubmitButton>
                </div>
              </InlineForm>
            ) : (
              <p className="px-4 py-4 text-sm text-muted">
                Your role can view risk scores but not record reviews.
              </p>
            )}
          </Panel>
        </div>
        <Panel title="Account">
          <Facts
            items={[
              ['Status', <StatusTag key="s" status={r.user.status} />],
              ['Phone', formatPhone(r.user.phone)],
              ['Email', r.user.email ?? '—'],
              ['Joined', formatDateTime(r.user.createdAt)],
            ]}
          />
        </Panel>
      </div>
    </>
  );
}
