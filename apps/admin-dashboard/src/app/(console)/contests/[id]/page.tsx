import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PERMISSIONS } from '@petapp/types';
import { ApiError, api } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatDateTime, timeAgo } from '@/lib/format';
import { formatPaise } from '@/lib/money';
import type { ContestDetail, FinanceBreakdown, FlaggedVote, LeaderboardRowView } from '@/lib/types';
import {
  Facts,
  NoAccess,
  PageHeader,
  Panel,
  Select,
  StatusTag,
  Tag,
  buttonClass,
  inputClass,
} from '@/components/ui';
import { ActionDialog } from '@/components/forms';
import { Table, Td } from '@/components/table';
import { Trail } from '@/components/trail';
import {
  awardSpecial,
  declareWinners,
  freeze,
  legalApprove,
  reviewVote,
  setEntryStatus,
  transition,
} from '../actions';
import { CONTEST_STATUS, NEXT } from '../labels';

export const metadata: Metadata = { title: 'Contest' };

// Mirrors the API's lifecycle; the API enforces it.
const TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['REVIEW', 'CANCELLED'],
  REVIEW: ['DRAFT', 'SCHEDULED', 'CANCELLED'],
  SCHEDULED: ['LIVE', 'CANCELLED'],
  LIVE: ['VOTING', 'CANCELLED'],
  VOTING: ['EVALUATION', 'CANCELLED'],
  EVALUATION: ['WINNER_DECLARATION', 'CANCELLED'],
  WINNER_DECLARATION: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};
const REASONS: Record<string, string> = {
  account_under_24h: 'Account under a day old',
  joined_after_contest_opened: 'Joined after the contest opened',
  many_votes_same_network: 'Many votes from one network',
  several_votes_same_network: 'Several votes from one network',
};

function MoneyTable({ columns }: { columns: Array<[string, FinanceBreakdown]> }) {
  const lines: Array<[string, keyof FinanceBreakdown]> = [
    ['Collected', 'grossPaise'],
    ['Prize pool', 'prizePoolPaise'],
    ['Platform fee', 'platformFeePaise'],
    ['GST on platform fee', 'gstPaise'],
    ['Payment gateway', 'gatewayPaise'],
    ['Promotion', 'promotionPaise'],
    ['Refund reserve', 'refundReservePaise'],
    ['Judge fees', 'judgeFeesPaise'],
    ['Unallocated', 'unallocatedPaise'],
  ];
  return (
    <Table head={['', ...columns.map(([h]) => h)]}>
      {lines.map(([label, key]) => (
        <tr key={key}>
          <Td
            className={
              key === 'grossPaise' || key === 'unallocatedPaise' ? 'font-medium' : 'text-muted'
            }
          >
            {label}
          </Td>
          {columns.map(([h, f]) => (
            <Td
              key={h}
              className={
                key === 'unallocatedPaise' && (f[key] as number) < 0
                  ? 'font-medium text-danger'
                  : key === 'grossPaise'
                    ? 'font-medium'
                    : ''
              }
            >
              {formatPaise(f[key] as number)}
            </Td>
          ))}
        </tr>
      ))}
    </Table>
  );
}

export default async function ContestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ n?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const me = await getMe();
  if (!can(me, PERMISSIONS.CONTESTS_READ)) return <NoAccess what="contests" />;
  let c: ContestDetail;
  try {
    c = await api<ContestDetail>(`/admin/contests/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
  const manage = can(me, PERMISSIONS.CONTESTS_MANAGE);
  const paid = c.feePaise > 0;
  const started = ['LIVE', 'VOTING', 'EVALUATION', 'WINNER_DECLARATION', 'COMPLETED'].includes(
    c.status,
  );
  const scoring = ['VOTING', 'EVALUATION', 'WINNER_DECLARATION', 'COMPLETED'].includes(c.status);
  const whatIf =
    sp.n && /^\d{1,7}$/.test(sp.n)
      ? await api<FinanceBreakdown>(`/admin/contests/${id}/finance/${sp.n}`)
      : null;
  const [board, flagged] = await Promise.all([
    started
      ? api<{ frozen: boolean; rows: LeaderboardRowView[] }>(`/admin/contests/${id}/leaderboard`)
      : null,
    scoring ? api<FlaggedVote[]>(`/admin/contests/${id}/flagged-votes`) : [],
  ]);
  const totalEntries = Object.entries(c.entries)
    .filter(([k]) => !['PENDING_PAYMENT', 'WITHDRAWN'].includes(k))
    .reduce((a, [, n]) => a + (n ?? 0), 0);
  const unassignedRanked = c.prizes.some((p) => p.rank !== null && !p.participantId);
  const status = CONTEST_STATUS[c.status];

  return (
    <>
      <PageHeader
        back={{ href: '/contests', label: 'Contests' }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {c.title} <Tag tone={status.tone}>{status.label}</Tag>
          </span>
        }
        description={`${paid ? `${formatPaise(c.feePaise)} entry` : 'Free entry'} · ${totalEntries} entr${totalEntries === 1 ? 'y' : 'ies'}${c.maxParticipants ? ` of ${c.maxParticipants}` : ''}${c.category ? ` · ${c.category.name}` : ''}`}
        actions={
          manage && (
            <>
              {(c.status === 'DRAFT' || c.status === 'REVIEW') && (
                <Link href={`/contests/${id}/edit`} className={buttonClass('secondary')}>
                  Edit
                </Link>
              )}
              {TRANSITIONS[c.status].map((to) => (
                <ActionDialog
                  key={to}
                  label={NEXT[to].label}
                  variant={to === 'CANCELLED' ? 'quiet' : to === 'DRAFT' ? 'secondary' : 'primary'}
                  danger={to === 'CANCELLED'}
                  title={`${NEXT[to].label}?`}
                  description={NEXT[to].explain}
                  action={transition.bind(null, id, to)}
                  submitLabel={NEXT[to].label}
                >
                  {to === 'CANCELLED' && (
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="reason" className="text-sm font-medium">
                        Reason (shown to participants)
                      </label>
                      <textarea
                        id="reason"
                        name="reason"
                        required
                        minLength={3}
                        maxLength={500}
                        rows={3}
                        className={`${inputClass} h-auto py-2`}
                      />
                    </div>
                  )}
                </ActionDialog>
              ))}
            </>
          )
        }
      />

      <div className="grid gap-8 lg:grid-cols-[1fr_18rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {c.status === 'CANCELLED' && c.cancelReason && (
            <p className="rounded-md border border-danger/30 bg-danger-wash px-4 py-3 text-sm text-danger">
              Cancelled: {c.cancelReason}
            </p>
          )}

          {(c.status === 'DRAFT' || c.status === 'REVIEW') && c.readiness.length > 0 && (
            <Panel title="Before this can be scheduled">
              <ul className="list-disc space-y-1 py-3 pl-9 pr-4 text-sm">
                {c.readiness.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </Panel>
          )}

          {paid && !['COMPLETED', 'CANCELLED'].includes(c.status) && (
            <Panel title="Legal review">
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                {c.legalReviewApprovedAt ? (
                  <span>
                    <Tag tone="good">Recorded</Tag>{' '}
                    <span className="text-muted">{formatDateTime(c.legalReviewApprovedAt)}</span> —{' '}
                    {c.legalReviewNote}
                  </span>
                ) : (
                  <span className="text-warn">
                    Not recorded. This paid contest can’t go live until it is.
                  </span>
                )}
                {!c.legalReviewApprovedAt &&
                  can(me, PERMISSIONS.CONTESTS_LEGAL_APPROVE) &&
                  ['DRAFT', 'REVIEW', 'SCHEDULED'].includes(c.status) && (
                    <ActionDialog
                      label="Record legal review"
                      variant="primary"
                      title="Record the legal review"
                      description="Confirm counsel has reviewed this contest’s structure (game of skill), GST treatment, TDS on prizes, and its terms for the states it runs in."
                      action={legalApprove.bind(null, id)}
                      submitLabel="Record review"
                    >
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor="note" className="text-sm font-medium">
                          Reviewer and reference
                        </label>
                        <textarea
                          id="note"
                          name="note"
                          required
                          minLength={10}
                          maxLength={1000}
                          rows={3}
                          className={`${inputClass} h-auto py-2`}
                          placeholder="e.g. Reviewed by our counsel, opinion ref LGL-2026-014"
                        />
                      </div>
                    </ActionDialog>
                  )}
              </div>
            </Panel>
          )}

          <Panel title="Setup">
            <Facts
              items={[
                [
                  'Registration',
                  `${formatDateTime(c.registrationOpensAt)} – ${formatDateTime(c.registrationClosesAt)}`,
                ],
                ['Submissions close', formatDateTime(c.submissionClosesAt)],
                ['Voting closes', formatDateTime(c.votingClosesAt)],
                ['Score', `Public votes ${c.publicWeight}% · Judges ${100 - c.publicWeight}%`],
                [
                  'Voting rules',
                  `${c.votesPerUserPerDay} vote${c.votesPerUserPerDay === 1 ? '' : 's'} a day${c.minAccountAgeDays ? `, accounts ${c.minAccountAgeDays}+ days old` : ''}`,
                ],
                [
                  'Entries',
                  `minimum ${c.minParticipants}${c.maxParticipants ? `, maximum ${c.maxParticipants}` : ''}`,
                ],
                [
                  'Tasks',
                  c.tasks.map((t) => `${t.title}${t.required ? '' : ' (optional)'}`).join('; ') ||
                    '—',
                ],
                ['Judging', c.criteria.map((x) => `${x.name} ${x.weight}%`).join(', ') || '—'],
                ['Judges', c.judges.map((j) => j.user.name ?? 'No name').join(', ') || '—'],
              ]}
            />
          </Panel>

          {paid && (
            <Panel title="Money">
              <p className="px-4 pt-3 text-sm">
                <span className="font-medium">{formatPaise(c.money.collectedPaise)}</span> collected
                from {c.money.paidEntries} paid entr{c.money.paidEntries === 1 ? 'y' : 'ies'}.
                {c.status === 'CANCELLED' && ' All of it is queued for refund.'}
              </p>
              <MoneyTable
                columns={[
                  ...(c.money.actual && c.money.paidEntries
                    ? [['So far', c.money.actual] as [string, FinanceBreakdown]]
                    : []),
                  ...(c.money.atMinimum
                    ? [
                        [`At minimum (${c.minParticipants})`, c.money.atMinimum] as [
                          string,
                          FinanceBreakdown,
                        ],
                      ]
                    : []),
                  ...(c.money.atMaximum
                    ? [
                        [`At maximum (${c.maxParticipants})`, c.money.atMaximum] as [
                          string,
                          FinanceBreakdown,
                        ],
                      ]
                    : []),
                  ...(whatIf
                    ? [[`If ${whatIf.participants} enter`, whatIf] as [string, FinanceBreakdown]]
                    : []),
                ]}
              />
              <form className="flex items-center gap-2 border-t border-line-soft px-4 py-3 text-sm">
                <label htmlFor="n">What if</label>
                <input
                  id="n"
                  name="n"
                  type="number"
                  min={0}
                  max={1000000}
                  defaultValue={sp.n}
                  className={`${inputClass} w-28`}
                />
                <span>people enter?</span>
                <button className={buttonClass('secondary', 'sm')}>Show</button>
              </form>
            </Panel>
          )}

          {board && (
            <Panel
              title={board.frozen ? 'Final leaderboard (frozen)' : 'Leaderboard (live)'}
              actions={
                manage && c.status === 'EVALUATION' && !board.frozen ? (
                  <ActionDialog
                    label="Freeze leaderboard"
                    variant="primary"
                    title="Freeze the leaderboard?"
                    description="Judging closes and this ranking becomes final. Winners are declared from it."
                    action={freeze.bind(null, id)}
                    submitLabel="Freeze"
                  />
                ) : manage && c.status === 'WINNER_DECLARATION' && unassignedRanked ? (
                  <ActionDialog
                    label="Declare winners"
                    variant="primary"
                    title="Declare winners?"
                    description="Ranked prizes go to the top of the frozen leaderboard. Prize payouts start as pending."
                    action={declareWinners.bind(null, id)}
                    submitLabel="Declare winners"
                  />
                ) : undefined
              }
            >
              {board.rows.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted">No entries yet.</p>
              ) : (
                <Table
                  head={['#', 'Pet', 'Owner', 'Votes', 'Public', 'Judges', 'Score', 'Status', '']}
                >
                  {board.rows.map((r) => (
                    <tr key={r.entryId}>
                      <Td className="font-semibold">{r.rank}</Td>
                      <Td>
                        {r.pet ? (
                          <Link className="hover:underline" href={`/pets/${r.pet.id}`}>
                            {r.pet.name}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </Td>
                      <Td>
                        {r.owner ? (
                          <Link className="hover:underline" href={`/users/${r.owner.id}`}>
                            {r.owner.name ?? 'No name'}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </Td>
                      <Td>{r.votes}</Td>
                      <Td className="text-muted">{r.voteScore}</Td>
                      <Td className="text-muted">{r.judgeScore}</Td>
                      <Td className="font-semibold">{r.combined}</Td>
                      <Td>{r.status && <StatusTag status={r.status} />}</Td>
                      <Td>
                        {manage && !board.frozen && (
                          <ActionDialog
                            label="Decide"
                            size="sm"
                            variant="quiet"
                            title={`Entry: ${r.pet?.name ?? ''}`}
                            description="Disqualified entries leave the leaderboard. Everything is recorded in the history."
                            action={setEntryStatus.bind(null, id, r.entryId)}
                            submitLabel="Save"
                          >
                            <div className="flex flex-col gap-1.5">
                              <label htmlFor={`s-${r.entryId}`} className="text-sm font-medium">
                                Status
                              </label>
                              <Select id={`s-${r.entryId}`} name="status" defaultValue="QUALIFIED">
                                <option value="QUALIFIED">Qualified</option>
                                <option value="FINALIST">Finalist</option>
                                <option value="DISQUALIFIED">Disqualified</option>
                              </Select>
                            </div>
                            <div className="flex flex-col gap-1.5">
                              <label htmlFor={`r-${r.entryId}`} className="text-sm font-medium">
                                Reason
                              </label>
                              <textarea
                                id={`r-${r.entryId}`}
                                name="reason"
                                required
                                minLength={3}
                                rows={2}
                                className={`${inputClass} h-auto py-2`}
                              />
                            </div>
                          </ActionDialog>
                        )}
                      </Td>
                    </tr>
                  ))}
                </Table>
              )}
            </Panel>
          )}

          {flagged.length > 0 && (
            <Panel title={`Votes held for review (${flagged.length})`}>
              <p className="px-4 pt-3 text-xs text-muted">
                These votes don’t count until you approve them. Voters aren’t told their vote was
                held.
              </p>
              <Table head={['Voter', 'For', 'Why it was held', 'When', '']}>
                {flagged.map((v) => (
                  <tr key={v.id}>
                    <Td>
                      <Link className="hover:underline" href={`/users/${v.voter.id}`}>
                        {v.voter.name ?? 'No name'}
                      </Link>
                      <span className="block text-xs text-muted">
                        joined {timeAgo(v.voter.createdAt)}
                      </span>
                    </Td>
                    <Td>{v.entry.pet}</Td>
                    <Td className="text-sm">
                      {v.riskReasons.map((r) => REASONS[r] ?? r).join(', ')}{' '}
                      <span className="text-muted">({v.riskScore})</span>
                    </Td>
                    <Td className="whitespace-nowrap text-muted">{timeAgo(v.createdAt)}</Td>
                    <Td>
                      {manage && (
                        <span className="flex gap-1">
                          <ActionDialog
                            label="Count it"
                            size="sm"
                            variant="quiet"
                            title="Count this vote?"
                            action={reviewVote.bind(null, id, v.id, true)}
                            submitLabel="Count it"
                          />
                          <ActionDialog
                            label="Exclude"
                            size="sm"
                            variant="quiet"
                            danger
                            title="Keep this vote excluded?"
                            action={reviewVote.bind(null, id, v.id, false)}
                            submitLabel="Exclude"
                          />
                        </span>
                      )}
                    </Td>
                  </tr>
                ))}
              </Table>
            </Panel>
          )}

          <Panel title="Prizes">
            <ul className="divide-y divide-line-soft">
              {c.prizes.map((p) => {
                const winner = board?.rows.find((r) => r.entryId === p.participantId);
                return (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm"
                  >
                    <span>
                      <span className="font-medium">
                        {p.rank ? `#${p.rank} ` : ''}
                        {p.title}
                      </span>{' '}
                      <span className="text-muted">
                        {p.kind.toLowerCase()}
                        {p.amountPaise ? `, ${formatPaise(p.amountPaise)}` : ''}
                      </span>
                    </span>
                    {p.participantId ? (
                      <span>
                        {winner?.pet?.name ?? 'Awarded'}{' '}
                        <Tag tone="warn">Payout {p.payoutStatus.toLowerCase()}</Tag>
                      </span>
                    ) : p.rank === null && manage && c.status === 'WINNER_DECLARATION' && board ? (
                      <ActionDialog
                        label="Give award"
                        size="sm"
                        variant="quiet"
                        title={`Give “${p.title}”`}
                        action={awardSpecial.bind(null, id, p.id)}
                        submitLabel="Give award"
                      >
                        <Select name="participantId" aria-label="Entry" defaultValue="">
                          <option value="" disabled>
                            Choose an entry
                          </option>
                          {board.rows.map((r) => (
                            <option key={r.entryId} value={r.entryId}>
                              #{r.rank} {r.pet?.name}
                            </option>
                          ))}
                        </Select>
                      </ActionDialog>
                    ) : (
                      <span className="text-muted">
                        {p.rank ? 'Goes to the frozen leaderboard' : 'Chosen at winner declaration'}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>
        <Trail entityType="Contest" entityId={c.id} />
      </div>
    </>
  );
}
