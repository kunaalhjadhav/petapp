import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PERMISSIONS } from '@petapp/types';
import { ApiError, api } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatDateTime, timeAgo } from '@/lib/format';
import { REASON_LABELS, RESOLUTION_LABELS, TARGET_LABELS } from '@/lib/labels';
import type { CaseDetail, Resolution } from '@/lib/types';
import { NoAccess, PageHeader, Panel, StatusTag, Tag } from '@/components/ui';
import { Trail } from '@/components/trail';
import { TargetCard } from '../preview';
import { AiCheckView } from '../ai-check';
import { DecisionForm } from './decision-form';

export const metadata: Metadata = { title: 'Moderation case' };

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  if (!can(me, PERMISSIONS.CONTENT_READ)) return <NoAccess what="moderation" />;
  let c: CaseDetail;
  try {
    c = await api<CaseDetail>(`/admin/moderation/cases/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
  const options: Array<{ value: Resolution; label: string; hint: string }> = [
    {
      value: 'DISMISSED',
      label: 'Dismiss',
      hint: 'No rule was broken. Anything hidden automatically is restored.',
    },
    ...(c.targetType !== 'USER' && c.targetType !== 'CONTEST_ENTRY' && c.targetType !== 'SERVICE_PARTNER'
      ? [
          {
            value: 'CONTENT_HIDDEN' as const,
            label: 'Hide',
            hint:
              c.targetType === 'PRODUCT'
                ? 'The listing is blocked; the seller sees your note. Can be undone later.'
                : c.targetType === 'PRODUCT_REVIEW' || c.targetType === 'SERVICE_REVIEW'
                  ? 'The review stops showing and stops counting towards the rating. Can be undone from Reviews.'
                  : 'Only the owner can still see it. Can be undone later.',
          },
          {
            value: 'CONTENT_REMOVED' as const,
            label: 'Remove',
            hint:
              c.targetType === 'PRODUCT_REVIEW' || c.targetType === 'SERVICE_REVIEW'
                ? 'Reviews can only be hidden, so this hides it too.'
                : 'Gone for everyone, including the owner.',
          },
        ]
      : []),
    ...(can(me, PERMISSIONS.USERS_SUSPEND)
      ? [
          {
            value: 'USER_SUSPENDED' as const,
            label:
              c.targetType === 'USER'
                ? 'Suspend account'
                : c.targetType === 'CONTEST_ENTRY'
                  ? 'Suspend the entrant'
                  : c.targetType === 'SERVICE_PARTNER'
                    ? 'Suspend the owner’s account'
                    : 'Remove and suspend the owner',
            hint: 'Signs them out everywhere. For serious or repeated harm.',
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        back={{ href: '/moderation', label: 'Moderation' }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span>
              {c.reportCount ? 'Reported' : 'Flagged'} {TARGET_LABELS[c.targetType]?.toLowerCase()}
            </span>
            <StatusTag status={c.status} />
          </span>
        }
        description={`${c.reportCount ? `${c.reportCount} report${c.reportCount === 1 ? '' : 's'}` : 'No reports'}${c.ai ? `, flagged by AI moderation` : ''}; opened ${timeAgo(c.createdAt)}${c.previousCases ? `. ${c.previousCases} earlier case${c.previousCases === 1 ? '' : 's'} on the same thing` : ''}.`}
      />

      <div className="grid gap-8 lg:grid-cols-[1fr_18rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title={c.reportCount ? 'What was reported' : 'What was flagged'}>
            <div className="px-4 py-4">
              <TargetCard target={c.target} />
            </div>
          </Panel>

          {c.aiHistory.length > 0 && (
            <Panel title="AI moderation">
              <div className="flex flex-col gap-5 px-4 py-4">
                <p className="text-xs text-muted">
                  AI only suggests. Check the item yourself before deciding; it can be wrong,
                  especially with jokes, Indian languages and veterinary photos.
                </p>
                {c.aiHistory.slice(0, 1).map((a) => (
                  <AiCheckView key={a.id} check={a} />
                ))}
                {c.aiHistory.length > 1 && (
                  <details>
                    <summary className="cursor-pointer text-sm text-muted hover:text-ink">
                      Earlier checks ({c.aiHistory.length - 1})
                    </summary>
                    <div className="mt-3 flex flex-col gap-5">
                      {c.aiHistory.slice(1).map((a) => (
                        <AiCheckView key={a.id} check={a} />
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </Panel>
          )}

          {c.targetType === 'CONTEST_ENTRY' && c.target.contest && c.status === 'OPEN' && (
            <p className="text-sm text-muted">
              To disqualify this entry, use the{' '}
              <a href={`/contests/${c.target.contest.id}`} className="text-teal hover:underline">
                contest’s page
              </a>{' '}
              (it changes the leaderboard), then dismiss this case with a note.
            </p>
          )}

          {c.targetType === 'SERVICE_PARTNER' && c.status === 'OPEN' && (
            <p className="text-sm text-muted">
              To take this business off PetApp, suspend it on the{' '}
              <a href={`/partners/${c.targetId}`} className="text-teal hover:underline">
                partner’s page
              </a>{' '}
              (it affects bookings and payouts), then resolve this case with a note.
            </p>
          )}

          {c.status === 'OPEN' && can(me, PERMISSIONS.CONTENT_MODERATE) ? (
            <Panel title="Decision">
              <DecisionForm caseId={c.id} options={options} />
            </Panel>
          ) : c.status === 'RESOLVED' ? (
            <Panel title="Decision">
              <div className="px-4 py-4 text-sm">
                <p className="font-medium">
                  {RESOLUTION_LABELS[c.resolution ?? ''] ?? c.resolution}
                </p>
                {c.resolutionNote && <p className="mt-1 text-muted">“{c.resolutionNote}”</p>}
                <p className="mt-2 text-xs text-faint">
                  {c.resolvedBy?.name ?? c.resolvedBy?.email ?? 'Someone'},{' '}
                  {formatDateTime(c.resolvedAt)}
                </p>
              </div>
            </Panel>
          ) : (
            <p className="text-sm text-muted">Your role can view cases but not decide them.</p>
          )}

          {c.reports.length > 0 && (
            <Panel title={`Reports (${c.reports.length})`}>
              <ul className="divide-y divide-line-soft">
                {c.reports.map((r) => (
                  <li key={r.id} className="px-4 py-3">
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <Tag
                        tone={
                          r.reason === 'ANIMAL_WELFARE' || r.reason === 'VIOLENCE'
                            ? 'danger'
                            : 'neutral'
                        }
                      >
                        {REASON_LABELS[r.reason] ?? r.reason}
                      </Tag>
                      <span className="text-muted">
                        {r.reporter.name ?? 'Someone'}, {timeAgo(r.createdAt)}
                      </span>
                    </p>
                    {r.details && <p className="mt-1 max-w-[65ch] text-sm">{r.details}</p>}
                    {r.evidence.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2" aria-label="Evidence">
                        {r.evidence.map((m) => {
                          const src = m.images?.find((i) => i.width <= 640)?.url ?? m.images?.[0]?.url;
                          return src ? (
                            <a key={m.id} href={m.images?.at(-1)?.url ?? src} target="_blank" rel="noreferrer" className="block h-24 w-24 overflow-hidden rounded-md border border-line-soft bg-line-soft">
                              <img src={src} alt="Screenshot attached by the reporter" className="h-full w-full object-cover" />
                            </a>
                          ) : null;
                        })}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
        <Trail entityType={c.targetType} entityId={c.targetId} />
      </div>
    </>
  );
}
