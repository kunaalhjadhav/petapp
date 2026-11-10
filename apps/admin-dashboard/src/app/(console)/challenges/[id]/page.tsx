import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PERMISSIONS } from '@petapp/types';
import { ApiError, api } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatDateTime } from '@/lib/format';
import { formatPaise } from '@/lib/money';
import { Facts, NoAccess, PageHeader, Panel, Tag } from '@/components/ui';
import { ActionDialog } from '@/components/forms';
import { Table, Td } from '@/components/table';
import { Trail } from '@/components/trail';
import { setChallengeStatus } from '../actions';
import { KIND, STATUS } from '../labels';

export const metadata: Metadata = { title: 'Challenge' };

interface Detail {
  id: string;
  title: string;
  description: string;
  kind: string;
  feePaise: number;
  status: string;
  startsAt: string;
  endsAt: string;
  requiredCheckIns: number;
  proof: string;
  pointsPerCheckIn: number;
  streakBonusEvery: number;
  streakBonusPoints: number;
  badge: { name: string } | null;
  readiness: string[];
  participants: Record<string, number>;
  collectedPaise: number;
}
interface Board {
  rows: Array<{
    rank: number;
    user: { id: string; name: string | null };
    points: number;
    checkIns: number;
    streak: number;
    completed: boolean;
  }>;
}
const MOVES: Record<string, Array<[string, string, string]>> = {
  DRAFT: [
    ['PUBLISHED', 'Publish', 'It appears in the app and people can join.'],
    ['CANCELLED', 'Cancel', 'It won’t run.'],
  ],
  PUBLISHED: [
    ['ENDED', 'End now', 'Check-ins stop; rankings stay visible.'],
    ['CANCELLED', 'Cancel', 'Everyone is withdrawn and paid fees are queued for refund.'],
  ],
};

export default async function ChallengePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  if (!can(me, PERMISSIONS.CONTESTS_READ)) return <NoAccess what="challenges" />;
  let c: Detail;
  try {
    c = await api<Detail>(`/admin/challenges/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
  const board =
    c.status === 'DRAFT' || c.status === 'CANCELLED'
      ? null
      : await api<Board>(`/admin/challenges/${id}/leaderboard`);
  const manage = can(me, PERMISSIONS.CHALLENGES_MANAGE);
  return (
    <>
      <PageHeader
        back={{ href: '/challenges', label: 'Challenges' }}
        title={
          <span className="flex items-center gap-3">
            {c.title} <Tag tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Tag>
          </span>
        }
        description={c.description}
        actions={
          manage &&
          (MOVES[c.status] ?? []).map(([to, label, explain]) => (
            <ActionDialog
              key={to}
              label={label}
              variant={to === 'PUBLISHED' ? 'primary' : 'quiet'}
              danger={to === 'CANCELLED'}
              title={`${label}?`}
              description={explain}
              action={setChallengeStatus.bind(null, id, to)}
              submitLabel={label}
            />
          ))
        }
      />
      <div className="grid gap-8 lg:grid-cols-[1fr_18rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {c.status === 'DRAFT' && c.readiness.length > 0 && (
            <Panel title="Before publishing">
              <ul className="list-disc space-y-1 py-3 pl-9 pr-4 text-sm">
                {c.readiness.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </Panel>
          )}
          <Panel title="Setup">
            <Facts
              items={[
                [
                  'Who can join',
                  `${KIND[c.kind]}${c.kind === 'PAID' ? ` · ${formatPaise(c.feePaise)}` : ''}`,
                ],
                ['Runs', `${formatDateTime(c.startsAt)} – ${formatDateTime(c.endsAt)}`],
                ['To complete', `${c.requiredCheckIns} check-ins (one per day, India time)`],
                [
                  'Proof',
                  { NONE: 'None', POST: 'A post', TEXT: 'A short note' }[c.proof] ?? c.proof,
                ],
                [
                  'Points',
                  `${c.pointsPerCheckIn} per check-in${c.streakBonusEvery ? `, +${c.streakBonusPoints} every ${c.streakBonusEvery} days in a row` : ''}`,
                ],
                ['Badge', c.badge?.name ?? '—'],
                [
                  'Participants',
                  Object.entries(c.participants)
                    .map(([k, n]) => `${n} ${k.toLowerCase().replace('_', ' ')}`)
                    .join(', ') || 'none yet',
                ],
                ...(c.kind === 'PAID'
                  ? [['Collected', formatPaise(c.collectedPaise)] as [string, string]]
                  : []),
              ]}
            />
          </Panel>
          {board && (
            <Panel title="Rankings">
              {board.rows.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted">No one has joined yet.</p>
              ) : (
                <Table head={['#', 'Person', 'Points', 'Check-ins', 'Streak', '']}>
                  {board.rows.map((r) => (
                    <tr key={r.user.id}>
                      <Td className="font-semibold">{r.rank}</Td>
                      <Td>{r.user.name ?? 'No name'}</Td>
                      <Td className="font-semibold">{r.points}</Td>
                      <Td>
                        {r.checkIns} / {c.requiredCheckIns}
                      </Td>
                      <Td>{r.streak ? `${r.streak} days` : '—'}</Td>
                      <Td>{r.completed && <Tag tone="good">Completed</Tag>}</Td>
                    </tr>
                  ))}
                </Table>
              )}
            </Panel>
          )}
        </div>
        <Trail entityId={c.id} />
      </div>
    </>
  );
}
