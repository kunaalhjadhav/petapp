import { ageInMonths } from './pets.service';

describe('ageInMonths', () => {
  const now = new Date('2026-09-30T00:00:00Z');
  it('returns null without a birth date', () => expect(ageInMonths(null, now)).toBeNull());
  it('counts whole months', () => expect(ageInMonths(new Date('2023-08-14'), now)).toBe(37));
  it('does not count a month before its day', () => expect(ageInMonths(new Date('2026-08-31'), now)).toBe(0));
  it('never goes negative', () => expect(ageInMonths(new Date('2027-01-01'), now)).toBe(0));
});
