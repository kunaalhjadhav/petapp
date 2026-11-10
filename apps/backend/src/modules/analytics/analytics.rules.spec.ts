import { addDays, change, eachDay, fillSeries, istDay, istStart, parseRange, pct, previousRange, ratio, retention } from './analytics.rules';

describe('analytics rules', () => {
  const now = new Date('2026-10-20T20:00:00.000Z'); // 21 Oct, 01:30 India time

  it('uses India-time days', () => {
    expect(istDay(now)).toBe('2026-10-21');
    expect(istDay(new Date('2026-10-20T18:29:59.000Z'))).toBe('2026-10-20');
    expect(istStart('2026-10-21').toISOString()).toBe('2026-10-20T18:30:00.000Z');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('parses ranges', () => {
    const r = parseRange(undefined, undefined, now);
    expect(r).toMatchObject({ from: '2026-09-22', to: '2026-10-21', days: 30 });
    expect(parseRange('2026-10-01', '2026-12-01', now)).toMatchObject({ to: '2026-10-21', days: 21 });
    expect(parseRange('2026-10-05', '2026-10-01', now)).toEqual({ problem: 'The start date is after the end date.' });
    expect(parseRange('2026-13-01', undefined, now)).toHaveProperty('problem');
    expect(parseRange('2026-02-30', undefined, now)).toHaveProperty('problem');
    expect(parseRange('2024-01-01', '2026-10-01', now)).toEqual({ problem: 'Choose at most 366 days.' });
    const one = parseRange('2026-10-10', '2026-10-10', now);
    expect(one).toMatchObject({ days: 1 });
    if ('days' in one) {
      expect(one.end.getTime() - one.start.getTime()).toBe(86_400_000);
      expect(previousRange(one)).toMatchObject({ from: '2026-10-09', to: '2026-10-09' });
    }
  });

  it('fills series and computes ratios', () => {
    expect(eachDay({ from: '2026-10-30', days: 3 })).toEqual(['2026-10-30', '2026-10-31', '2026-11-01']);
    expect(fillSeries({ from: '2026-10-01', days: 3 }, [{ day: new Date('2026-10-02T00:00:00Z'), value: BigInt(4) }])).toEqual([
      { day: '2026-10-01', value: 0 }, { day: '2026-10-02', value: 4 }, { day: '2026-10-03', value: 0 },
    ]);
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(1, 0)).toBeNull();
    expect(ratio(1000, 3)).toBe(333);
    expect(change(150, 100)).toBe(50);
    expect(change(5, 0)).toBeNull();
  });

  it('counts retention only for cohorts old enough', () => {
    const cohorts: Array<{ day: string; joined: number; back: Record<number, number> }> = [
      { day: '2026-10-01', joined: 10, back: { 1: 5, 7: 2 } },
      { day: '2026-10-18', joined: 10, back: { 1: 1 } },
    ];
    expect(retention(cohorts, 1, '2026-10-20')).toBe(30);
    expect(retention(cohorts, 7, '2026-10-20')).toBe(20);
    expect(retention(cohorts, 30, '2026-10-20')).toBeNull();
  });
});
