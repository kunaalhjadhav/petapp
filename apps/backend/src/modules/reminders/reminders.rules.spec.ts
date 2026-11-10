import { bookingDue, promotionProblem } from './reminders.rules';

const now = new Date('2026-10-20T10:00:00Z');
const h = (n: number) => new Date(now.getTime() + n * 3_600_000);

describe('reminder rules', () => {
  it('reminds of visits inside the window, not ones booked at the last minute', () => {
    expect(bookingDue({ startsAt: h(20), createdAt: h(-48) }, now, 24)).toBe(true);
    expect(bookingDue({ startsAt: h(30), createdAt: h(-48) }, now, 24)).toBe(false);
    expect(bookingDue({ startsAt: h(-1), createdAt: h(-48) }, now, 24)).toBe(false);
    expect(bookingDue({ startsAt: h(2), createdAt: h(0) }, now, 24)).toBe(false);
    expect(bookingDue({ startsAt: h(20), createdAt: h(-48) }, now, 0)).toBe(false);
  });

  it('checks promotions', () => {
    const ok = { title: 'Diwali offers', body: '20% off treats this week.', audience: 'ALL' };
    expect(promotionProblem(ok, now)).toBeNull();
    expect(promotionProblem({ ...ok, link: '/contest/summer-smiles' }, now)).toBeNull();
    expect(promotionProblem({ ...ok, link: 'https://evil.example' }, now)).toMatch(/page in the app/);
    expect(promotionProblem({ ...ok, link: '//evil.example' }, now)).toMatch(/page in the app/);
    expect(promotionProblem({ ...ok, audience: 'CITY' }, now)).toMatch(/city/);
    expect(promotionProblem({ ...ok, sendAt: h(24 * 40) }, now)).toMatch(/30 days/);
    expect(promotionProblem({ ...ok, title: 'Hi' }, now)).toMatch(/title/);
  });
});
