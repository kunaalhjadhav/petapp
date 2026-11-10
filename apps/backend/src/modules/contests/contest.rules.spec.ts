import { financeBreakdown, financeProblems, rankEntries, readinessProblems, voteRisk, weightedScore, type ReadinessInput } from './contest.rules';

const plan = { prizePoolPct: 60, platformFeePct: 20, gatewayPct: 2, gstOnPlatformFeePct: 18, promotionPct: 4.4, refundReservePct: 5, judgeFeesPaise: 500_00 };

describe('financeBreakdown', () => {
  it('reproduces the spec example: 100 × ₹100 = ₹10,000, every rupee accounted for', () => {
    const f = financeBreakdown(100_00, 100, plan);
    expect(f.grossPaise).toBe(10_000_00);
    expect(f).toMatchObject({
      prizePoolPaise: 6000_00, platformFeePaise: 2000_00, gatewayPaise: 200_00, gstPaise: 360_00,
      promotionPaise: 440_00, refundReservePaise: 500_00, judgeFeesPaise: 500_00, unallocatedPaise: 0, balanced: true,
    });
  });
  it('scales to 1000 entries and flags fixed costs that don’t fit small contests', () => {
    expect(financeBreakdown(100_00, 1000, plan).prizePoolPaise).toBe(60_000_00);
    const small = financeBreakdown(100_00, 5, plan);
    expect(small.balanced).toBe(false); // ₹500 judge fees can't come out of ₹500 gross with the rest
  });
  it('never invents paise: rounding remainders stay unallocated', () => {
    const f = financeBreakdown(99_99, 7, { ...plan, judgeFeesPaise: 0 });
    const lines = f.prizePoolPaise + f.platformFeePaise + f.gstPaise + f.gatewayPaise + f.promotionPaise + f.refundReservePaise;
    expect(lines + f.unallocatedPaise).toBe(f.grossPaise);
    expect(f.unallocatedPaise).toBeGreaterThanOrEqual(0);
  });
  it('rejects splits over 100%', () => {
    expect(financeProblems(plan)).toEqual([]);
    expect(financeProblems({ ...plan, prizePoolPct: 80 })[0]).toMatch(/more than 100%/);
  });
});

describe('scoring', () => {
  it('weights criteria', () => {
    const w = new Map([['creativity', 60], ['skill', 40]]);
    expect(weightedScore([{ criterionId: 'creativity', score: 10 }, { criterionId: 'skill', score: 5 }], w)).toBe(8);
    expect(weightedScore([], w)).toBeNull();
  });
  it('combines public votes and judges by the configured share, ties to earlier registration', () => {
    const t = (n: number) => new Date(2026, 9, n);
    const rows = rankEntries(
      [
        { participantId: 'a', votes: 100, judgeAverage: 5, registeredAt: t(2) }, // 40*1 + 60*0.5 = 70
        { participantId: 'b', votes: 50, judgeAverage: 9, registeredAt: t(3) }, // 40*0.5 + 60*0.9 = 74
        { participantId: 'c', votes: 50, judgeAverage: 9, registeredAt: t(1) }, // tie with b, registered earlier
        { participantId: 'd', votes: 0, judgeAverage: null, registeredAt: t(1) },
      ],
      40,
    );
    expect(rows.map((r) => [r.participantId, r.rank, r.combined])).toEqual([['c', 1, 74], ['b', 2, 74], ['a', 3, 70], ['d', 4, 0]]);
    expect(rankEntries([{ participantId: 'x', votes: 0, judgeAverage: null, registeredAt: t(1) }], 100)[0].voteScore).toBe(0);
  });
});

describe('voteRisk', () => {
  it('passes ordinary votes and explains flagged ones', () => {
    expect(voteRisk({ accountAgeHours: 500, joinedAfterContestOpened: false, sameNetworkVotesToday: 0 })).toEqual({ score: 0, reasons: [], flagged: false });
    const r = voteRisk({ accountAgeHours: 2, joinedAfterContestOpened: true, sameNetworkVotesToday: 0 });
    expect(r).toMatchObject({ score: 55, flagged: true });
    expect(r.reasons).toEqual(['account_under_24h', 'joined_after_contest_opened']);
    expect(voteRisk({ accountAgeHours: 500, joinedAfterContestOpened: false, sameNetworkVotesToday: 6 }).flagged).toBe(false); // one signal alone isn't enough
  });
  it('holds votes from an account waiting for a risk review (it counts once approved)', () => {
    expect(voteRisk({ accountAgeHours: 500, joinedAfterContestOpened: false, sameNetworkVotesToday: 0, accountUnderReview: true })).toEqual({ score: 50, reasons: ['account_under_review'], flagged: true });
  });
});

describe('readinessProblems', () => {
  const ok: ReadinessInput = {
    title: 'Monsoon Glam', feePaise: 199_00, minParticipants: 10, maxParticipants: 500, publicWeight: 40,
    registrationOpensAt: new Date('2026-10-05'), registrationClosesAt: new Date('2026-10-15'), submissionClosesAt: new Date('2026-10-20'), votingClosesAt: new Date('2026-10-31'),
    finance: plan, tasks: 2, criteriaWeights: [50, 30, 20], judges: 2, prizes: 3,
  };
  it('accepts a complete contest', () => expect(readinessProblems(ok)).toEqual([]));
  it('lists everything missing', () => {
    const p = readinessProblems({ ...ok, tasks: 0, judges: 0, criteriaWeights: [50, 30], votingClosesAt: new Date('2026-10-01'), finance: { ...plan, prizePoolPct: 0 } });
    expect(p).toEqual(expect.arrayContaining([
      'Add at least one task.',
      'Judges decide part of the score: assign at least one judge.',
      'Judging criteria weights add up to 80; they must add up to 100.',
      expect.stringMatching(/Dates must run in order/),
      'Paid contests need a prize pool share.',
    ]));
  });
  it('a public-vote-only contest needs no judges', () => expect(readinessProblems({ ...ok, publicWeight: 100, judges: 0, criteriaWeights: [] })).toEqual([]));
});
