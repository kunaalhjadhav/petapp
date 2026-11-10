import { benefitLines, benefitsOf, currentOf, NO_BENEFITS, purchaseWindow, upcomingOf } from './memberships.rules';

const now = new Date('2026-10-20T10:00:00Z');
const d = (days: number) => new Date(now.getTime() + days * 86_400_000);
const plan = { id: 'plus', name: 'Plus', periodDays: 30, pricePaise: 14900, isActive: true };

describe('membership rules', () => {
  it('finds the current and upcoming memberships', () => {
    const list = [
      { id: 'a', planId: 'plus', status: 'ACTIVE', startsAt: d(-10), endsAt: d(20) },
      { id: 'b', planId: 'plus', status: 'ACTIVE', startsAt: d(20), endsAt: d(50) },
      { id: 'c', planId: 'plus', status: 'REVOKED', startsAt: d(-5), endsAt: d(60) },
      { id: 'e', planId: 'plus', status: 'ACTIVE', startsAt: d(-40), endsAt: d(-10) },
    ];
    expect(currentOf(list, now)?.id).toBe('a');
    expect(upcomingOf(list, now).map((m) => m.id)).toEqual(['b']);
    expect(currentOf([], now)).toBeNull();
  });

  it('combines benefits', () => {
    expect(benefitsOf([])).toEqual(NO_BENEFITS);
    expect(benefitsOf([{ ...NO_BENEFITS, badge: true, priorityDays: 7 }, { ...NO_BENEFITS, memberDiscounts: true, priorityDays: 30 }]))
      .toEqual({ ...NO_BENEFITS, badge: true, memberDiscounts: true, priorityDays: 30 });
    expect(benefitLines({ ...NO_BENEFITS, exclusiveContests: true, priorityDays: 30 })).toEqual(['Members-only contests', 'Book services up to 30 days earlier than everyone else']);
  });

  it('starts a new membership now, a renewal when the current one ends', () => {
    expect(purchaseWindow(plan, [], now, 2)).toEqual({ startsAt: now, endsAt: d(30) });
    const running = [{ id: 'a', planId: 'plus', status: 'ACTIVE', startsAt: d(-10), endsAt: d(20) }];
    expect(purchaseWindow(plan, running, now, 2)).toEqual({ startsAt: d(20), endsAt: d(50) });
    const twoAhead = [...running, { id: 'b', planId: 'plus', status: 'ACTIVE', startsAt: d(20), endsAt: d(50) }];
    expect(purchaseWindow(plan, twoAhead, now, 1)).toEqual({ problem: 'You’ve already paid one period ahead.' });
    expect(purchaseWindow(plan, twoAhead, now, 2)).toEqual({ startsAt: d(50), endsAt: d(80) });
  });

  it('refuses a switch, a free plan and a retired plan', () => {
    const premium = [{ id: 'p', planId: 'premium', status: 'ACTIVE', startsAt: d(-1), endsAt: d(29) }];
    expect(purchaseWindow(plan, premium, now, 2, 'Premium')).toEqual({ problem: 'Your Premium membership runs until 2026-11-18. You can switch plans when it ends.' });
    expect(purchaseWindow({ ...plan, pricePaise: 0 }, [], now, 2)).toHaveProperty('problem');
    expect(purchaseWindow({ ...plan, isActive: false }, [], now, 2)).toHaveProperty('problem');
    // A revoked or ended membership doesn't block anything.
    expect(purchaseWindow(plan, [{ id: 'x', planId: 'premium', status: 'REVOKED', startsAt: d(-1), endsAt: d(29) }], now, 2)).toEqual({ startsAt: now, endsAt: d(30) });
  });
});
