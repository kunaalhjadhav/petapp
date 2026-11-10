import Link from 'next/link';
import { api } from '@/lib/api';
import { describeAction, formatDate, formatNumber, timeAgo } from '@/lib/format';
import type { Overview } from '@/lib/types';
import { Empty, PageHeader, Panel } from '@/components/ui';

function Figure({
  value,
  label,
  href,
  tone,
}: {
  value: number;
  label: string;
  href?: string;
  tone?: 'warn' | 'danger';
}) {
  const color =
    tone === 'danger' && value > 0
      ? 'text-danger'
      : tone === 'warn' && value > 0
        ? 'text-warn'
        : 'text-ink';
  const body = (
    <>
      <span className={`block text-2xl font-semibold leading-8 ${color}`}>
        {formatNumber(value)}
      </span>
      <span className="text-sm text-muted">{label}</span>
    </>
  );
  return href ? (
    <Link href={href} className="block rounded-md px-4 py-3 hover:bg-paper">
      {body}
    </Link>
  ) : (
    <div className="px-4 py-3">{body}</div>
  );
}

function Signups({ days }: { days: Array<{ day: string; count: number }> }) {
  const max = Math.max(1, ...days.map((d) => d.count));
  const total = days.reduce((n, d) => n + d.count, 0);
  const w = 100 / days.length;
  return (
    <figure className="px-4 pb-4 pt-3">
      <svg
        viewBox="0 0 100 40"
        preserveAspectRatio="none"
        className="h-28 w-full"
        role="img"
        aria-label={`${total} sign-ups in the last 14 days`}
      >
        {days.map((d, i) => {
          const h = d.count ? Math.max(2, (d.count / max) * 38) : 0.6;
          return (
            <rect
              key={d.day}
              x={i * w + w * 0.18}
              y={40 - h}
              width={w * 0.64}
              height={h}
              rx={0.6}
              fill={d.count ? 'var(--color-teal)' : 'var(--color-line)'}
            >
              <title>{`${formatDate(d.day)}: ${d.count}`}</title>
            </rect>
          );
        })}
      </svg>
      <figcaption className="mt-2 flex justify-between text-xs text-faint">
        <span>{formatDate(days[0]?.day)}</span>
        <span>Today</span>
      </figcaption>
    </figure>
  );
}

export default async function OverviewPage() {
  const o = await api<Overview>('/admin/overview');
  const attention = (o.users?.suspended ?? 0) + (o.users?.blocked ?? 0) + (o.pets?.hidden ?? 0);

  return (
    <>
      <PageHeader
        title="Overview"
        description={
          attention > 0
            ? `${formatNumber(attention)} account${attention === 1 ? ' or pet is' : 's or pets are'} currently restricted.`
            : 'Nothing is restricted right now.'
        }
      />

      {!o.users && !o.pets && !o.recentAudit && (
        <Panel>
          <Empty title="Nothing to show yet">
            Your role doesn’t include any of the overview sections. Ask a super admin if you need
            access.
          </Empty>
        </Panel>
      )}

      {o.moderation && o.moderation.openCases > 0 && (
        <Link
          href="/moderation"
          className="mb-6 flex items-center justify-between gap-4 rounded-lg border border-warn/30 bg-warn-wash px-4 py-3 text-sm text-warn hover:border-warn/60"
        >
          <span>
            <span className="font-semibold">
              {formatNumber(o.moderation.openCases)} report case
              {o.moderation.openCases === 1 ? '' : 's'} waiting for review
            </span>
            {o.moderation.oldestOpenAt && (
              <span>, oldest from {timeAgo(o.moderation.oldestOpenAt)}</span>
            )}
          </span>
          <span className="font-medium">Review</span>
        </Link>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {o.users && (
            <Panel title="People">
              <div className="grid grid-cols-2 divide-line-soft px-1 py-1 sm:grid-cols-4 sm:divide-x">
                <Figure value={o.users.total} label="Accounts" href="/users" />
                <Figure value={o.users.newLast7d} label="New this week" />
                <Figure value={o.users.signedInLast30d} label="Signed in, 30 days" />
                <Figure
                  value={o.users.suspended + o.users.blocked}
                  label="Suspended or blocked"
                  href="/users?status=SUSPENDED"
                  tone="warn"
                />
              </div>
              <div className="border-t border-line-soft">
                <p className="px-4 pt-3 text-sm font-medium">Sign-ups, last 14 days</p>
                <Signups days={o.users.signupsByDay} />
              </div>
            </Panel>
          )}

          {o.pets && (
            <Panel title="Pets">
              <div className="grid grid-cols-2 px-1 py-1 sm:grid-cols-4 sm:divide-x sm:divide-line-soft">
                <Figure value={o.pets.total} label="Profiles" href="/pets" />
                <Figure value={o.pets.newLast7d} label="New this week" />
                <Figure value={o.pets.verified} label="Verified" href="/pets?verified=1" />
                <Figure
                  value={o.pets.hidden}
                  label="Hidden by moderators"
                  href="/pets?status=HIDDEN"
                  tone="warn"
                />
              </div>
              {o.pets.bySpecies.length > 0 && (
                <ul className="flex flex-col gap-2 border-t border-line-soft px-4 py-4">
                  {o.pets.bySpecies.map((s) => (
                    <li
                      key={s.species}
                      className="grid grid-cols-[7rem_1fr_3rem] items-center gap-3 text-sm"
                    >
                      <span className="truncate">{s.species}</span>
                      <span className="h-2 rounded-full bg-line-soft">
                        <span
                          className="block h-2 rounded-full bg-teal"
                          style={{ width: `${(s.count / o.pets!.total) * 100}%` }}
                        />
                      </span>
                      <span className="text-right text-muted">{formatNumber(s.count)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </div>

        {o.recentAudit && (
          <Panel
            title="Latest activity"
            actions={
              <Link href="/audit" className="text-sm text-teal hover:underline">
                Audit log
              </Link>
            }
          >
            {o.recentAudit.length === 0 ? (
              <Empty title="No activity yet" />
            ) : (
              <ul className="divide-y divide-line-soft">
                {o.recentAudit.map((a) => (
                  <li key={a.id} className="px-4 py-2.5">
                    <p className="text-sm">{describeAction(a.action)}</p>
                    <p className="text-xs text-faint">
                      {a.actor?.name ?? a.actor?.email ?? 'System'}, {timeAgo(a.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
      </div>
    </>
  );
}
