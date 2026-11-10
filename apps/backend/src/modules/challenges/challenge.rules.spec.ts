import { applyCheckIn, indiaDay, liveStreak, type StreakState } from './challenge.rules';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const fresh: StreakState = { checkIns: 0, points: 0, currentStreak: 0, longestStreak: 0, lastCheckInDay: null };
const cfg = { requiredCheckIns: 7, pointsPerCheckIn: 10, streakBonusEvery: 3, streakBonusPoints: 25 };

describe('indiaDay', () => {
  it('uses the India calendar, not UTC', () => {
    expect(indiaDay(new Date('2026-10-04T18:29:00Z'))).toEqual(d('2026-10-04')); // 11:59 pm IST
    expect(indiaDay(new Date('2026-10-04T18:31:00Z'))).toEqual(d('2026-10-05')); // 12:01 am IST, same UTC date
    expect(indiaDay(new Date('2026-10-04T23:00:00Z'))).toEqual(d('2026-10-05'));
  });
});

describe('applyCheckIn', () => {
  const run = (days: string[]) => {
    let s = fresh;
    const outs = [];
    for (const day of days) {
      const o = applyCheckIn(s, d(day), cfg);
      outs.push(o);
      if (!o.already) s = o.next;
    }
    return { s, outs };
  };

  it('builds a streak on consecutive days with a bonus every 3rd day', () => {
    const { s, outs } = run(['2026-10-01', '2026-10-02', '2026-10-03']);
    expect(s).toMatchObject({ checkIns: 3, currentStreak: 3, longestStreak: 3, points: 10 + 10 + 35 });
    expect(outs.map((o) => (o.already ? 'x' : o.bonus))).toEqual([0, 0, 25]);
  });

  it('allows one check-in per day', () => {
    const { s, outs } = run(['2026-10-01', '2026-10-01']);
    expect(outs[1]).toEqual({ already: true });
    expect(s.checkIns).toBe(1);
  });

  it('resets the streak after a missed day but keeps the longest', () => {
    const { s } = run(['2026-10-01', '2026-10-02', '2026-10-04', '2026-10-05']);
    expect(s).toMatchObject({ checkIns: 4, currentStreak: 2, longestStreak: 2 });
  });

  it('completes exactly once, on the required check-in', () => {
    const days = Array.from({ length: 8 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
    const { outs } = run(days);
    expect(outs.map((o) => !o.already && o.completedNow)).toEqual([false, false, false, false, false, false, true, false]);
  });

  it('shows a broken streak as 0 once a whole day is missed', () => {
    const s = { currentStreak: 5, lastCheckInDay: d('2026-10-03') };
    expect(liveStreak(s, d('2026-10-03'))).toBe(5);
    expect(liveStreak(s, d('2026-10-04'))).toBe(5); // can still check in today
    expect(liveStreak(s, d('2026-10-05'))).toBe(0);
    expect(liveStreak({ currentStreak: 0, lastCheckInDay: null }, d('2026-10-05'))).toBe(0);
  });
});
