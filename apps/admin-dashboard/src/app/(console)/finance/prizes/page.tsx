import Link from 'next/link';
import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { api } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatPhone } from '@/lib/format';
import { PRIZE_STATUS, type PrizeRow } from '@/lib/finance';
import { Empty, NoAccess, PageHeader, Panel, Tag } from '@/components/ui';
import { ActionDialog } from '@/components/forms';
import { Amount, StatusOf, Tabs } from '@/components/finance';
import { Table, Td } from '@/components/table';
import { approvePrize } from '../actions';

export const metadata: Metadata = { title: 'Prizes' };
const TABS = [
  { key: 'PENDING', label: 'Waiting for approval' },
  { key: 'APPROVED', label: 'Approved, not yet paid' },
  { key: 'PAID', label: 'Paid' },
];

export default async function PrizesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!can(me, PERMISSIONS.FINANCE_READ)) return <NoAccess what="prizes" />;
  const manage = can(me, PERMISSIONS.FINANCE_MANAGE);
  const status = TABS.some((t) => t.key === sp.status) ? sp.status! : 'PENDING';
  const prizes = await api<PrizeRow[]>('/admin/finance/prizes', { query: { status } });
  const total = prizes.reduce((a, p) => a + p.amountPaise, 0);

  return (
    <>
      <PageHeader
        title="Cash prizes"
        description="Cash prizes awarded in contests. Finance approves each one: TDS on winnings is deducted where it applies, and the rest is owed to the winner and paid in the next payout batch once they’ve added a bank account or UPI ID."
      />
      <Panel
        actions={
          prizes.length > 0 && (
            <span className="text-sm text-muted">
              {prizes.length} prize{prizes.length === 1 ? '' : 's'} ·{' '}
              <Amount paise={total} strong />
            </span>
          )
        }
        title={TABS.find((t) => t.key === status)!.label}
      >
        <Tabs
          label="Status"
          tabs={TABS}
          current={status}
          href={(k) => `/finance/prizes?status=${k}`}
        />
        {prizes.length === 0 ? (
          <Empty title="No prizes here" />
        ) : (
          <Table head={['Winner', 'Contest', 'Prize', 'Amount', 'Status', '']} numeric={[3]}>
            {prizes.map((p) => (
              <tr key={p.id} className="align-top">
                <Td>
                  <Link href={`/users/${p.winner.userId}`} className="font-medium hover:underline">
                    {p.winner.name ?? 'Winner'}
                  </Link>
                  <p className="text-xs text-muted">
                    with {p.winner.petName} · {formatPhone(p.winner.phone)}
                  </p>
                </Td>
                <Td>
                  <Link href={`/contests/${p.contest.id}`} className="hover:underline">
                    {p.contest.title}
                  </Link>
                </Td>
                <Td>
                  {p.title}
                  {p.rank !== null && <p className="text-xs text-muted">Rank {p.rank}</p>}
                </Td>
                <Td className="text-right">
                  <Amount paise={p.amountPaise} />
                </Td>
                <Td>
                  <StatusOf map={PRIZE_STATUS} status={p.payoutStatus} />
                  {p.payoutStatus !== 'PAID' && !p.winnerHasPayoutAccount && (
                    <p className="mt-1">
                      <Tag tone="warn">No payout account yet</Tag>
                    </p>
                  )}
                </Td>
                <Td>
                  {manage && p.payoutStatus === 'PENDING' && (
                    <ActionDialog
                      label="Approve"
                      size="sm"
                      variant="primary"
                      title="Approve this prize?"
                      description={
                        <>
                          <Amount paise={p.amountPaise} /> to {p.winner.name ?? 'the winner'} for “
                          {p.title}” in {p.contest.title}. TDS is deducted if the prize is above the
                          threshold in settings; the rest is paid in the next payout batch.
                        </>
                      }
                      submitLabel="Approve"
                      action={approvePrize.bind(null, p.id)}
                    />
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <p className="border-t border-line-soft px-4 py-3 text-xs text-muted">
          Shows the latest 200. Prizes are approved once a contest’s winners are declared.
        </p>
      </Panel>
    </>
  );
}
