import Link from 'next/link';
import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { apiPage } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatDate } from '@/lib/format';
import { formatPaise } from '@/lib/money';
import { Empty, NoAccess, PageHeader, Panel, Tag, buttonClass } from '@/components/ui';
import { Pagination, Table, Td } from '@/components/table';
import { KIND, STATUS } from './labels';

export const metadata: Metadata = { title: 'Challenges' };

interface Row {
  id: string;
  title: string;
  kind: string;
  feePaise: number;
  status: string;
  startsAt: string;
  endsAt: string;
  requiredCheckIns: number;
  participants: number;
  badge: { name: string } | null;
}

export default async function ChallengesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!can(me, PERMISSIONS.CONTESTS_READ)) return <NoAccess what="challenges" />;
  const { items, meta } = await apiPage<Row>('/admin/challenges', { page: sp.page, limit: 25 });
  const manage = can(me, PERMISSIONS.CHALLENGES_MANAGE);
  return (
    <>
      <PageHeader
        title="Challenges"
        description="Daily habits with streaks, points and badges: 7 days walking, 30 days training."
        actions={
          manage && (
            <>
              <Link href="/challenges/badges" className={buttonClass('secondary')}>
                Badges
              </Link>
              <Link href="/challenges/new" className={buttonClass('primary')}>
                New challenge
              </Link>
            </>
          )
        }
      />
      <Panel>
        {items.length === 0 ? (
          <Empty title="No challenges yet">
            {manage ? 'Create the first one with New challenge.' : undefined}
          </Empty>
        ) : (
          <Table head={['Challenge', 'Status', 'Who', 'Check-ins', 'Runs', 'Joined']}>
            {items.map((c) => (
              <tr key={c.id} className="hover:bg-paper">
                <Td>
                  <Link href={`/challenges/${c.id}`} className="font-medium hover:underline">
                    {c.title}
                  </Link>
                  {c.badge && (
                    <span className="block text-xs text-muted">Badge: {c.badge.name}</span>
                  )}
                </Td>
                <Td>
                  <Tag tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Tag>
                </Td>
                <Td>
                  {KIND[c.kind]}
                  {c.kind === 'PAID' ? ` · ${formatPaise(c.feePaise)}` : ''}
                </Td>
                <Td>{c.requiredCheckIns}</Td>
                <Td className="whitespace-nowrap text-muted">
                  {formatDate(c.startsAt)} – {formatDate(c.endsAt)}
                </Td>
                <Td>{c.participants}</Td>
              </tr>
            ))}
          </Table>
        )}
        <Pagination meta={meta} basePath="/challenges" params={sp} />
      </Panel>
    </>
  );
}
