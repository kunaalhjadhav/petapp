// Pure challenge rules. A "day" is a calendar day in India (Asia/Kolkata, UTC+5:30, no DST).

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** The India calendar day of an instant, as a UTC-midnight Date (what Postgres DATE stores). */
export function indiaDay(at: Date): Date {
  const shifted = new Date(at.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

export interface StreakState {
  checkIns: number;
  points: number;
  currentStreak: number;
  longestStreak: number;
  lastCheckInDay: Date | null;
}

export interface ChallengeScoring {
  requiredCheckIns: number;
  pointsPerCheckIn: number;
  streakBonusEvery: number;
  streakBonusPoints: number;
}

export type CheckInOutcome =
  | { already: true }
  | { already: false; next: StreakState; earned: number; bonus: number; completedNow: boolean };

/** One check-in per India day. Consecutive days build the streak; a missed day resets it to 1. */
export function applyCheckIn(s: StreakState, today: Date, c: ChallengeScoring): CheckInOutcome {
  const last = s.lastCheckInDay?.getTime();
  if (last === today.getTime()) return { already: true };
  const streak = last === today.getTime() - DAY_MS ? s.currentStreak + 1 : 1;
  const bonus = c.streakBonusEvery > 0 && streak % c.streakBonusEvery === 0 ? c.streakBonusPoints : 0;
  const earned = c.pointsPerCheckIn + bonus;
  const checkIns = s.checkIns + 1;
  return {
    already: false,
    earned,
    bonus,
    completedNow: s.checkIns < c.requiredCheckIns && checkIns >= c.requiredCheckIns,
    next: { checkIns, points: s.points + earned, currentStreak: streak, longestStreak: Math.max(s.longestStreak, streak), lastCheckInDay: today },
  };
}

/** The streak as shown today: it is broken if neither today nor yesterday has a check-in. */
export function liveStreak(s: Pick<StreakState, 'currentStreak' | 'lastCheckInDay'>, today: Date): number {
  if (!s.lastCheckInDay) return 0;
  const gap = (today.getTime() - s.lastCheckInDay.getTime()) / DAY_MS;
  return gap <= 1 ? s.currentStreak : 0;
}
