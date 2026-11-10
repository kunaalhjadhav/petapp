// Pure trust & safety rules: AI moderation labels, flag decisions, photo fingerprints and account risk.
// No I/O; unit-tested (trust.rules.spec.ts).

/** What AI moderation can say about a piece of content (spec §33). Moderators decide; nothing is removed automatically. */
export const AI_LABELS = ['SPAM', 'UNSAFE', 'ABUSE', 'INAPPROPRIATE', 'FAKE_PROFILE', 'DUPLICATE', 'SUSPICIOUS_ENTRY'] as const;
export type AiLabel = (typeof AI_LABELS)[number];

export const AI_LABEL_TEXT: Record<AiLabel, string> = {
  SPAM: 'Spam or unwanted promotion',
  UNSAFE: 'Unsafe: harm to animals or people, dangerous advice',
  ABUSE: 'Abusive, hateful or harassing',
  INAPPROPRIATE: 'Sexual, graphic or otherwise inappropriate',
  FAKE_PROFILE: 'Looks like a fake or impersonating profile',
  DUPLICATE: 'Same photo or text as someone else’s',
  SUSPICIOUS_ENTRY: 'Suspicious contest entry',
};

export interface LabelScore {
  label: AiLabel;
  /** 0–1 */
  score: number;
}

/** Keeps known labels, clamps scores to 0–1, merges duplicates (highest wins) and sorts highest first. */
export function normaliseLabels(input: Array<{ label: string; score: number }>): LabelScore[] {
  const best = new Map<AiLabel, number>();
  for (const x of input) {
    const label = String(x.label).toUpperCase() as AiLabel;
    if (!AI_LABELS.includes(label)) continue;
    const score = Number.isFinite(x.score) ? Math.min(1, Math.max(0, x.score)) : 0;
    best.set(label, Math.max(best.get(label) ?? 0, score));
  }
  return [...best.entries()].map(([label, score]) => ({ label, score: Math.round(score * 1000) / 1000 })).sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
}

/** Flagged when the highest score reaches the threshold (a percentage, from settings). */
export function decide(labels: LabelScore[], flagPct: number): { flagged: boolean; topLabel: AiLabel | null; confidence: number } {
  const top = labels[0];
  if (!top) return { flagged: false, topLabel: null, confidence: 0 };
  return { flagged: flagPct > 0 && top.score * 100 >= flagPct, topLabel: top.label, confidence: top.score };
}

// ───────────── photo fingerprints ─────────────

/**
 * 64-bit difference hash from a 9×8 greyscale thumbnail (row-major, 72 bytes): each bit says whether a pixel is
 * brighter than its right-hand neighbour. Survives resizing and recompression; 16 hex characters.
 */
export function dHash(grey9x8: Uint8Array | number[]): string {
  if (grey9x8.length !== 72) throw new Error('dHash needs a 9×8 greyscale image (72 values)');
  let bits = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits = (bits << 1n) | (grey9x8[y * 9 + x] > grey9x8[y * 9 + x + 1] ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, '0');
}

export function hamming(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

/** Two photos are "the same" at this distance or less (out of 64 bits). */
export const SAME_PHOTO_DISTANCE = 6;

/** A flat photo (one colour, mostly blank) hashes to almost all zeros or ones: too generic to call a copy. */
export const isGenericHash = (h: string) => {
  const ones = hamming(h, '0000000000000000');
  return ones <= 4 || ones >= 60;
};

// ───────────── text checks (the rules provider, and duplicate text) ─────────────

/** Lower-cased words, no links, punctuation or repeated spaces: what counts as "the same text". */
export const normaliseText = (s: string) =>
  s
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// ───────────── account risk (spec §14) ─────────────

export interface RiskSignals {
  accountAgeHours: number;
  phoneVerified: boolean;
  /** Other accounts that signed in from the same network in the last 7 days. */
  sharedNetworkAccounts: number;
  /** This account's contest votes held for review in the last 30 days. */
  flaggedVotes30d: number;
  /** Votes cast in the last 24 hours, all contests. */
  votes24h: number;
  /** Payments with an invalid signature or a wrong amount in the last 30 days. */
  paymentAnomalies30d: number;
  /** Photos uploaded in the last 30 days that match someone else's. */
  copiedPhotos30d: number;
  /** Content flagged by AI moderation in the last 30 days. */
  aiFlags30d: number;
  /** Open moderation cases about this account or its content. */
  openCases: number;
}

export interface RiskSignal {
  signal: string;
  points: number;
  detail: string;
}

/**
 * A 0–100 score from automated signals, with the reasons. It only decides who staff look at first: nobody is banned or
 * blocked from it (spec §14). Weights are deliberately moderate where honest users can trip them (shared Wi-Fi).
 */
export function accountRisk(s: RiskSignals, reviewScore: number, mediumScore: number): { score: number; level: 'LOW' | 'MEDIUM' | 'HIGH'; signals: RiskSignal[] } {
  const out: RiskSignal[] = [];
  const add = (signal: string, points: number, detail: string) => out.push({ signal, points, detail });
  if (s.accountAgeHours < 24) add('new_account', 15, 'Account is less than a day old');
  else if (s.accountAgeHours < 72) add('new_account', 5, 'Account is less than three days old');
  if (!s.phoneVerified) add('unverified_phone', 10, 'Mobile number not verified');
  if (s.sharedNetworkAccounts >= 10) add('shared_network', 35, `${s.sharedNetworkAccounts} other accounts signed in from the same network this week`);
  else if (s.sharedNetworkAccounts >= 3) add('shared_network', 15, `${s.sharedNetworkAccounts} other accounts signed in from the same network this week`);
  if (s.flaggedVotes30d >= 10) add('held_votes', 30, `${s.flaggedVotes30d} contest votes held for review this month`);
  else if (s.flaggedVotes30d >= 3) add('held_votes', 15, `${s.flaggedVotes30d} contest votes held for review this month`);
  if (s.votes24h >= 30) add('vote_burst', 15, `${s.votes24h} votes in the last 24 hours`);
  if (s.paymentAnomalies30d >= 1) add('payment_anomaly', s.paymentAnomalies30d >= 3 ? 35 : 20, `${s.paymentAnomalies30d} payment${s.paymentAnomalies30d === 1 ? '' : 's'} with a bad signature or wrong amount`);
  if (s.copiedPhotos30d >= 3) add('copied_photos', 30, `${s.copiedPhotos30d} photos match other people’s`);
  else if (s.copiedPhotos30d >= 1) add('copied_photos', 15, `${s.copiedPhotos30d} photo${s.copiedPhotos30d === 1 ? '' : 's'} match other people’s`);
  if (s.aiFlags30d >= 3) add('ai_flags', 20, `${s.aiFlags30d} posts or comments flagged by AI moderation this month`);
  else if (s.aiFlags30d >= 1) add('ai_flags', 5, `${s.aiFlags30d} item${s.aiFlags30d === 1 ? '' : 's'} flagged by AI moderation this month`);
  if (s.openCases >= 2) add('open_cases', 15, `${s.openCases} open moderation cases`);
  else if (s.openCases === 1) add('open_cases', 5, 'One open moderation case');
  const score = Math.min(100, out.reduce((a, x) => a + x.points, 0));
  const level = score >= reviewScore ? 'HIGH' : score >= mediumScore ? 'MEDIUM' : 'LOW';
  return { score, level, signals: out.sort((a, b) => b.points - a.points) };
}

/** A staff review covers the score it saw; a clearly higher score later (by 10+) needs another look. */
export const needsReview = (level: string, score: number, reviewedScore: number | null) => level === 'HIGH' && (reviewedScore === null || score >= reviewedScore + 10);
