// Pure contest rules: money, scoring, risk and readiness. No database here — unit tested directly.
import type { ContestStatus } from '../../generated/prisma/enums';

// ───────────── money ─────────────

/** Per-contest split. Percentages may have up to 2 decimals (e.g. 4.4). */
export interface FinanceConfig {
  prizePoolPct: number;
  platformFeePct: number;
  gatewayPct: number;
  /** GST charged on the platform fee, carved out of the gross. */
  gstOnPlatformFeePct: number;
  promotionPct: number;
  refundReservePct: number;
  judgeFeesPaise: number;
}

export const EMPTY_FINANCE: FinanceConfig = {
  prizePoolPct: 0, platformFeePct: 0, gatewayPct: 0, gstOnPlatformFeePct: 0, promotionPct: 0, refundReservePct: 0, judgeFeesPaise: 0,
};

const bp = (pct: number) => Math.round(pct * 100); // basis points: exact integer maths
const share = (amount: number, pct: number) => Math.floor((amount * bp(pct)) / 10_000);

export interface FinanceBreakdown {
  participants: number;
  grossPaise: number;
  prizePoolPaise: number;
  platformFeePaise: number;
  gstPaise: number;
  gatewayPaise: number;
  promotionPaise: number;
  refundReservePaise: number;
  judgeFeesPaise: number;
  /** What's left after every line; negative means the plan doesn't add up at this size. */
  unallocatedPaise: number;
  balanced: boolean;
}

/** Example: 100 entries × ₹100 = ₹10,000 gross, split by the contest's configuration. */
export function financeBreakdown(feePaise: number, participants: number, f: FinanceConfig): FinanceBreakdown {
  const gross = feePaise * participants;
  const platform = share(gross, f.platformFeePct);
  const lines = {
    prizePoolPaise: share(gross, f.prizePoolPct),
    platformFeePaise: platform,
    gstPaise: share(platform, f.gstOnPlatformFeePct),
    gatewayPaise: share(gross, f.gatewayPct),
    promotionPaise: share(gross, f.promotionPct),
    refundReservePaise: share(gross, f.refundReservePct),
    judgeFeesPaise: f.judgeFeesPaise,
  };
  const unallocated = gross - Object.values(lines).reduce((a, b) => a + b, 0);
  return { participants, grossPaise: gross, ...lines, unallocatedPaise: unallocated, balanced: unallocated >= 0 };
}

export function financeProblems(f: FinanceConfig): string[] {
  const p: string[] = [];
  const pcts = [f.prizePoolPct, f.platformFeePct, f.gatewayPct, f.promotionPct, f.refundReservePct, f.gstOnPlatformFeePct];
  if (pcts.some((x) => x < 0 || x > 100) || f.judgeFeesPaise < 0) p.push('Percentages must be between 0 and 100, and fees can’t be negative.');
  const ofGross = bp(f.prizePoolPct) + bp(f.platformFeePct) + bp(f.gatewayPct) + bp(f.promotionPct) + bp(f.refundReservePct)
    + Math.ceil((bp(f.platformFeePct) * bp(f.gstOnPlatformFeePct)) / 10_000);
  if (ofGross > 10_000) p.push(`The split adds up to ${(ofGross / 100).toFixed(2)}% of entry fees, more than 100%.`);
  return p;
}

// ───────────── scoring ─────────────

/** One judge's weighted average for one entry, 0–10. Weights are per criterion (sum 100). */
export function weightedScore(scores: Array<{ criterionId: string; score: number }>, weights: Map<string, number>): number | null {
  let total = 0;
  let w = 0;
  for (const s of scores) {
    const weight = weights.get(s.criterionId) ?? 0;
    total += s.score * weight;
    w += weight;
  }
  return w > 0 ? total / w : null;
}

export interface EntryTotals {
  participantId: string;
  votes: number;
  /** Average across judges of each judge's weighted score (0–10), or null if unjudged. */
  judgeAverage: number | null;
  registeredAt: Date;
}

export interface LeaderboardRow extends EntryTotals {
  rank: number;
  voteScore: number;
  judgeScore: number;
  combined: number;
}

/**
 * Combined score out of 100: votes are scaled against the entry with the most votes;
 * judge averages (0–10) are scaled ×10. publicWeight is the public share (0–100).
 * Ties go to the earlier registration.
 */
export function rankEntries(entries: EntryTotals[], publicWeight: number): LeaderboardRow[] {
  const maxVotes = Math.max(0, ...entries.map((e) => e.votes));
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return entries
    .map((e) => {
      const voteScore = maxVotes > 0 ? (e.votes / maxVotes) * 100 : 0;
      const judgeScore = (e.judgeAverage ?? 0) * 10;
      const combined = (publicWeight * voteScore + (100 - publicWeight) * judgeScore) / 100;
      return { ...e, voteScore: round2(voteScore), judgeScore: round2(judgeScore), combined: round2(combined), rank: 0 };
    })
    .sort((a, b) => b.combined - a.combined || a.registeredAt.getTime() - b.registeredAt.getTime())
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

// ───────────── vote risk ─────────────

export interface VoteSignals {
  accountAgeHours: number;
  joinedAfterContestOpened: boolean;
  /** Votes for the same entry from the same network today, by other accounts. */
  sameNetworkVotesToday: number;
  /** The voter's account is high-risk and waiting for a staff review (Phase 7a). Holds the vote; it counts once approved. */
  accountUnderReview?: boolean;
}

export const FLAG_AT = 50;

/** Explainable score. Flagged votes don't count until a moderator reviews them. Nobody is banned automatically. */
export function voteRisk(s: VoteSignals): { score: number; reasons: string[]; flagged: boolean } {
  const reasons: string[] = [];
  let score = 0;
  if (s.accountAgeHours < 24) {
    score += 40;
    reasons.push('account_under_24h');
  }
  if (s.joinedAfterContestOpened) {
    score += 15;
    reasons.push('joined_after_contest_opened');
  }
  if (s.sameNetworkVotesToday >= 5) {
    score += 40;
    reasons.push('many_votes_same_network');
  } else if (s.sameNetworkVotesToday >= 3) {
    score += 20;
    reasons.push('several_votes_same_network');
  }
  if (s.accountUnderReview) {
    score += 50;
    reasons.push('account_under_review');
  }
  return { score, reasons, flagged: score >= FLAG_AT };
}

// ───────────── lifecycle ─────────────

export const TRANSITIONS: Record<ContestStatus, ContestStatus[]> = {
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

export interface ReadinessInput {
  title: string;
  feePaise: number;
  minParticipants: number;
  maxParticipants: number | null;
  publicWeight: number;
  registrationOpensAt: Date;
  registrationClosesAt: Date;
  submissionClosesAt: Date;
  votingClosesAt: Date;
  finance: FinanceConfig;
  tasks: number;
  criteriaWeights: number[];
  judges: number;
  prizes: number;
}

/** Everything a contest needs before it can go to review. Empty list = ready. */
export function readinessProblems(c: ReadinessInput): string[] {
  const p: string[] = [];
  if (c.tasks < 1) p.push('Add at least one task.');
  if (c.prizes < 1) p.push('Add at least one prize.');
  if (c.publicWeight < 0 || c.publicWeight > 100) p.push('Public vote share must be between 0 and 100.');
  if (c.publicWeight < 100) {
    if (c.judges < 1) p.push('Judges decide part of the score: assign at least one judge.');
    const sum = c.criteriaWeights.reduce((a, b) => a + b, 0);
    if (!c.criteriaWeights.length) p.push('Add judging criteria.');
    else if (sum !== 100) p.push(`Judging criteria weights add up to ${sum}; they must add up to 100.`);
  }
  if (!(c.registrationOpensAt < c.registrationClosesAt && c.registrationClosesAt <= c.submissionClosesAt && c.submissionClosesAt <= c.votingClosesAt)) {
    p.push('Dates must run in order: registration opens → registration closes → submissions close → voting closes.');
  }
  if (c.maxParticipants !== null && c.maxParticipants < Math.max(1, c.minParticipants)) p.push('Maximum participants must be at least the minimum.');
  if (c.feePaise > 0) {
    p.push(...financeProblems(c.finance));
    if (c.finance.prizePoolPct <= 0) p.push('Paid contests need a prize pool share.');
  }
  return p;
}
